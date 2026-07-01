import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Schéma Drizzle du service Foyer (base dédiée). Montants stockés en **centimes
 * entiers** (`bigint`) pour rester fidèle à `Money` ; le nb de parts (quotient
 * familial, possiblement fractionnaire) en `double precision`.
 */

export const foyer = pgTable('foyer', {
  id: uuid('id').primaryKey().defaultRandom(),
  ressourcesMensuellesCentimes: bigint('ressources_mensuelles_centimes', {
    mode: 'number',
  }).notNull(),
  rfrCentimes: bigint('rfr_centimes', { mode: 'number' }).notNull(),
  nbEnfantsACharge: integer('nb_enfants_a_charge').notNull(),
  nbParts: doublePrecision('nb_parts').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const enfant = pgTable('enfant', {
  id: uuid('id').primaryKey().defaultRandom(),
  foyerId: uuid('foyer_id')
    .notNull()
    .references(() => foyer.id, { onDelete: 'cascade' }),
  prenom: varchar('prenom', { length: 200 }).notNull(),
  /** Date de naissance ISO `YYYY-MM-DD` (mode chaîne, sans fuseau). */
  dateNaissance: date('date_naissance').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * **Parent** d'un foyer (cf. `.claude/plans/parents-foyer-modelisation.md`).
 * Destinataire des notifications et — en option B — **identité de connexion** via
 * son e-mail. Table dédiée (pas des colonnes `email1/email2` sur `foyer`) : la
 * cardinalité est variable (1–2 parents, parfois plus) et l'entité a vocation à
 * porter plus tard l'abonnement web push. `prenom`/`nom` sont une identité douce
 * optionnelle ; `actif = false` = soft-delete (on conserve l'historique).
 *
 * Deux index d'unicité :
 * - `parent_email_unique_idx` : `lower(email)` **global** — l'e-mail est
 *   l'identifiant de login (option B), unique à l'échelle du système.
 * - `parent_principal_unique_idx` : index partiel garantissant **au plus un**
 *   parent `principal` par foyer (destinataire « À » par défaut).
 */
export const parent = pgTable(
  'parent',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    foyerId: uuid('foyer_id')
      .notNull()
      .references(() => foyer.id, { onDelete: 'cascade' }),
    prenom: varchar('prenom', { length: 200 }),
    nom: varchar('nom', { length: 200 }),
    email: varchar('email', { length: 320 }).notNull(),
    principal: boolean('principal').notNull().default(false),
    ordre: integer('ordre').notNull().default(0),
    actif: boolean('actif').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('parent_email_unique_idx').on(sql`lower(${table.email})`),
    uniqueIndex('parent_principal_unique_idx')
      .on(table.foyerId)
      .where(sql`${table.principal}`),
  ],
);

/**
 * **Préférence de notification** d'un parent : une ligne par triplet
 * `(parent, type, canal)` (cf. `.claude/plans/parent-profil-notifications.md`
 * §3.1). Table dédiée (pas des colonnes sur `parent`) : cardinalité type×canal
 * variable et extensible sans migration à chaque nouveau type. **L'absence de
 * ligne = valeur par défaut applicative** (on ne matérialise qu'un choix
 * explicite) ⇒ migration purement additive, aucun back-fill. `consentement_at`
 * (opt-in) / `desabonne_at` (opt-out) tracent le consentement RGPD ;
 * `source_dernier` note l'origine du dernier changement (écran / lien désabo).
 */
export const preferenceNotification = pgTable(
  'preference_notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id')
      .notNull()
      .references(() => parent.id, { onDelete: 'cascade' }),
    typeNotification: varchar('type_notification', { length: 64 }).notNull(),
    canal: varchar('canal', { length: 32 }).notNull(),
    actif: boolean('actif').notNull().default(true),
    consentementAt: timestamp('consentement_at', { withTimezone: true }),
    desabonneAt: timestamp('desabonne_at', { withTimezone: true }),
    sourceDernier: varchar('source_dernier', { length: 32 })
      .notNull()
      .default('DEFAUT'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('preference_notification_unique_idx').on(
      table.parentId,
      table.typeNotification,
      table.canal,
    ),
  ],
);

/**
 * Jeton de **désabonnement one-click** (RFC 8058, PR5). `jti` = identifiant du
 * jeton signé, `utilise_le` NULL tant qu'inutilisé (usage one-shot), `expire_le`
 * borne la validité. Créé ici (PR1) pour que le modèle soit complet et la
 * migration additive ; l'endpoint public qui l'exploite arrive en PR5.
 */
export const desabonnementToken = pgTable('desabonnement_token', {
  jti: uuid('jti').primaryKey(),
  parentId: uuid('parent_id')
    .notNull()
    .references(() => parent.id, { onDelete: 'cascade' }),
  typeNotification: varchar('type_notification', { length: 64 }).notNull(),
  canal: varchar('canal', { length: 32 }).notNull(),
  emisLe: timestamp('emis_le', { withTimezone: true }).notNull().defaultNow(),
  utiliseLe: timestamp('utilise_le', { withTimezone: true }),
  expireLe: timestamp('expire_le', { withTimezone: true }).notNull(),
});

/**
 * Outbox transactionnelle (doc 06 §8.4). L'événement est inséré **dans la même
 * transaction** que le changement d'état ; un relais le publie ensuite sur NATS
 * et renseigne `published_at`. `id` = identifiant d'enveloppe = **clé d'idempotence**.
 */
export const outbox = pgTable('outbox', {
  id: uuid('id').primaryKey(),
  type: varchar('type', { length: 200 }).notNull(),
  payload: jsonb('payload').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  traceId: varchar('trace_id', { length: 64 }).notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
});

export type FoyerRow = typeof foyer.$inferSelect;
export type EnfantRow = typeof enfant.$inferSelect;
export type ParentRow = typeof parent.$inferSelect;
export type PreferenceNotificationRow =
  typeof preferenceNotification.$inferSelect;
export type DesabonnementTokenRow = typeof desabonnementToken.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;
