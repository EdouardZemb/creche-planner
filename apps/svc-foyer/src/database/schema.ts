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
export type OutboxRow = typeof outbox.$inferSelect;
