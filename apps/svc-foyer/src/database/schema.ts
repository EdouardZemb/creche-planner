import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
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

/**
 * **Version des ressources** d'un foyer à une date d'effet (SFD 30, DV-03/D4). Les
 * ressources deviennent une **suite de versions contiguës** `[dateEffet → fin)` : la
 * fin est **dérivée** (veille de la date d'effet suivante, socle lot 1), jamais
 * stockée. La table `foyer` reste la projection de la version applicable
 * **aujourd'hui** (identité + FK enfants/parents inchangées). `nb_parts` en
 * `double precision` (quotient familial fractionnaire). Unique `(foyer_id, date_effet)` :
 * réécrire la même date = **correction** (tracée dans `correction_journal`).
 */
export const foyerVersion = pgTable(
  'foyer_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    foyerId: uuid('foyer_id')
      .notNull()
      .references(() => foyer.id, { onDelete: 'cascade' }),
    /** Date d'effet ISO `YYYY-MM-DD` (granularité jour, H1). */
    dateEffet: date('date_effet').notNull(),
    ressourcesMensuellesCentimes: bigint('ressources_mensuelles_centimes', {
      mode: 'number',
    }).notNull(),
    rfrCentimes: bigint('rfr_centimes', { mode: 'number' }).notNull(),
    nbEnfantsACharge: integer('nb_enfants_a_charge').notNull(),
    nbParts: doublePrecision('nb_parts').notNull(),
    /** Instant de saisie (traçabilité, D6). */
    saisiLe: timestamp('saisi_le', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Motif optionnel de la saisie/correction (D6). */
    motif: varchar('motif', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('foyer_version_foyer_date_uq').on(table.foyerId, table.dateEffet),
  ],
);

/**
 * Journal des **corrections rétroactives** d'une version de ressources (SFD 30, D6) :
 * réécrire une version existante (même date d'effet) écrit une ligne avant/après avec
 * un motif optionnel. Trace d'audit, jamais relue par le calcul.
 */
export const correctionJournal = pgTable('correction_journal', {
  id: uuid('id').primaryKey().defaultRandom(),
  foyerId: uuid('foyer_id')
    .notNull()
    .references(() => foyer.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id').notNull(),
  /** État de la version avant correction (jsonb). */
  avant: jsonb('avant').notNull(),
  /** État de la version après correction (jsonb). */
  apres: jsonb('apres').notNull(),
  motif: varchar('motif', { length: 500 }),
  creeLe: timestamp('cree_le', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Read-model du **barème de seuils de tranche** projeté depuis le stream
 * `REFERENTIEL` (`referentiel.BaremeTranchesPublie.v1`, SFD 30, D2). `svc-foyer`
 * devient consommateur (sa **première** infra de consommation) pour dériver la
 * tranche **à la date d'effet** d'une version. Versionné par période ; `seuils` =
 * liste ordonnée `[{niveau, rfrMaxCentimes|null}]`.
 */
export const baremeTranches = pgTable(
  'bareme_tranches',
  {
    id: uuid('id').primaryKey(),
    valideDu: varchar('valide_du', { length: 10 }).notNull(),
    valideAu: varchar('valide_au', { length: 10 }),
    seuils: jsonb('seuils').notNull(),
    eventId: uuid('event_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique('bareme_tranches_du_uq').on(table.valideDu)],
);

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
 * - `parent_email_par_foyer_actif_idx` : `(foyer_id, lower(email))` **partiel sur
 *   les parents actifs** (`WHERE actif`). L'e-mail n'est plus unique à l'échelle du
 *   système mais **par foyer** : un même e-mail peut être parent de 0..n foyers
 *   (familles recomposées, multi-clients) et redevient **réutilisable après un
 *   retrait** (soft-delete `actif = false`) — la réactivation ré-ajoute la ligne.
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
    uniqueIndex('parent_email_par_foyer_actif_idx')
      .on(table.foyerId, sql`lower(${table.email})`)
      .where(sql`${table.actif}`),
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

/**
 * Journal des événements déjà consommés (clé = `id` d'enveloppe) — idempotence de
 * consommation (SFD 30, D2 : svc-foyer devient consommateur du stream REFERENTIEL).
 * Copie structurelle du modèle svc-tarification.
 */
export const processedEvent = pgTable('processed_event', {
  id: uuid('id').primaryKey(),
  stream: varchar('stream', { length: 32 }).notNull(),
  type: varchar('type', { length: 200 }).notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Dead-letter (fondations backend, lot 1) : une ligne par message non traité. Copie
 * **structurelle** de `libs/nest-commons/.../dead-letter.options.ts` (le typecheck de
 * `ConsumerModule.forRoot({ tableDeadLetter })` échoue si le service dérive).
 */
export const deadLetter = pgTable('dead_letter', {
  id: uuid('id').primaryKey().defaultRandom(),
  envelopeId: uuid('envelope_id'),
  stream: varchar('stream', { length: 32 }).notNull(),
  sujet: varchar('sujet', { length: 200 }).notNull(),
  raison: varchar('raison', { length: 32 }).notNull(),
  payload: text('payload').notNull(),
  erreur: text('erreur'),
  livraisons: integer('livraisons').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type FoyerRow = typeof foyer.$inferSelect;
export type FoyerVersionRow = typeof foyerVersion.$inferSelect;
export type BaremeTranchesRow = typeof baremeTranches.$inferSelect;
export type CorrectionJournalRow = typeof correctionJournal.$inferSelect;
export type ProcessedEventRow = typeof processedEvent.$inferSelect;
export type DeadLetterRow = typeof deadLetter.$inferSelect;
export type EnfantRow = typeof enfant.$inferSelect;
export type ParentRow = typeof parent.$inferSelect;
export type PreferenceNotificationRow =
  typeof preferenceNotification.$inferSelect;
export type DesabonnementTokenRow = typeof desabonnementToken.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;
