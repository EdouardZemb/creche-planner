import {
  bigint,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  timestamp,
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
export type OutboxRow = typeof outbox.$inferSelect;
