import {
  bigint,
  date,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Schéma Drizzle du **catalogue tarifaire** (Référentiel, base dédiée). Toutes les
 * grilles/barèmes sont **versionnés par période** (`valide_du`/`valide_au`, `au`
 * nullable = période ouverte). Montants en **centimes entiers** (`bigint`) pour
 * rester fidèles à `Money`. Owner des barèmes : un service = une base.
 */

/** Grille ABCM (cantine/péri/ALSH) d'une tranche, versionnée (doc 02 §4). */
export const grilleAbcm = pgTable('grille_abcm', {
  id: uuid('id').primaryKey().defaultRandom(),
  tranche: integer('tranche').notNull(),
  valideDu: date('valide_du').notNull(),
  valideAu: date('valide_au'),
  cantineTotalCentimes: bigint('cantine_total_centimes', {
    mode: 'number',
  }).notNull(),
  /** Part « garde » (cas PAI panier-repas) — connue surtout en T3 (doc 02 §4.4 bis). */
  cantinePartGardeCentimes: bigint('cantine_part_garde_centimes', {
    mode: 'number',
  }),
  periMatinCentimes: bigint('peri_matin_centimes', {
    mode: 'number',
  }).notNull(),
  periSoirCentimes: bigint('peri_soir_centimes', { mode: 'number' }).notNull(),
  alshJourneeCompleteCentimes: bigint('alsh_journee_complete_centimes', {
    mode: 'number',
  }).notNull(),
  alshDemiJourneeCentimes: bigint('alsh_demi_journee_centimes', {
    mode: 'number',
  }).notNull(),
  alshRepasCentimes: bigint('alsh_repas_centimes', {
    mode: 'number',
  }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Barème PSU/CNAF (taux d'effort par nb d'enfants + bornes), versionné (doc 02 §3.3). */
export const baremePsu = pgTable('bareme_psu', {
  id: uuid('id').primaryKey().defaultRandom(),
  valideDu: date('valide_du').notNull(),
  valideAu: date('valide_au'),
  /** Map `nbEnfantsACharge` → taux horaire (ex. `{ "1": 0.000619, "2": 0.000516 }`). */
  taux: jsonb('taux').notNull(),
  /** Bornes de ressources CNAF — optionnelles (doc 02 §3.1 ; l'oracle CT-01 ne les applique pas). */
  plancherCentimes: bigint('plancher_centimes', { mode: 'number' }),
  plafondCentimes: bigint('plafond_centimes', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Frais fixes annuels ABCM (cotisation + 1ère inscription), versionnés (doc 02 §4.4). */
export const fraisFixesAbcm = pgTable('frais_fixes_abcm', {
  id: uuid('id').primaryKey().defaultRandom(),
  valideDu: date('valide_du').notNull(),
  valideAu: date('valide_au'),
  cotisation1EnfantCentimes: bigint('cotisation_1_enfant_centimes', {
    mode: 'number',
  }).notNull(),
  premiereInscriptionCentimes: bigint('premiere_inscription_centimes', {
    mode: 'number',
  }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Jour non facturable : férié, fermeture crèche, vacances (doc 02 §7, INV-04). */
export const jourNonFacturable = pgTable('jour_non_facturable', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Date du jour, ISO `YYYY-MM-DD`. */
  jour: date('jour').notNull(),
  type: varchar('type', { length: 40 }).notNull(),
  libelle: varchar('libelle', { length: 200 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Outbox transactionnelle (doc 06 §8.4). L'événement est inséré **dans la même
 * transaction** que le changement d'état ; un relais le publie ensuite sur NATS et
 * renseigne `published_at`. `id` = identifiant d'enveloppe = **clé d'idempotence**.
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

export type GrilleAbcmRow = typeof grilleAbcm.$inferSelect;
export type BaremePsuRow = typeof baremePsu.$inferSelect;
export type FraisFixesAbcmRow = typeof fraisFixesAbcm.$inferSelect;
export type JourNonFacturableRow = typeof jourNonFacturable.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;
