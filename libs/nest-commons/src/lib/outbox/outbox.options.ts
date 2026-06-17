import { jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * Modèle structurel de la table outbox commune aux services (doc 06 §8.4). Sert
 * **uniquement de référence de type** : chaque service possède sa table `outbox`
 * dans son propre schéma Drizzle (et ses migrations), strictement identique à ce
 * modèle — le typecheck échoue si un service dérive.
 */
const modeleTableOutbox = pgTable('outbox', {
  id: uuid('id').primaryKey(),
  type: varchar('type', { length: 200 }).notNull(),
  payload: jsonb('payload').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  traceId: varchar('trace_id', { length: 64 }).notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
});

export type TableOutbox = typeof modeleTableOutbox;

/**
 * Contrainte **structurelle** sur la table fournie par le service : présence des
 * colonnes attendues, sans exiger l'identité de classe drizzle. Nécessaire car
 * les types drizzle vus par une app (CJS, résolution `require`) et par cette lib
 * (ESM, résolution `import`) ne s'unifient pas (TS2375) bien qu'identiques.
 */
export interface ColonnesOutbox {
  id: unknown;
  type: unknown;
  payload: unknown;
  occurredAt: unknown;
  traceId: unknown;
  publishedAt: unknown;
}

export const OPTIONS_OUTBOX = Symbol('OPTIONS_OUTBOX');

/** Points de variance du relais outbox, fournis par chaque service. */
export interface OptionsOutbox<TTable extends ColonnesOutbox = TableOutbox> {
  /** Source des enveloppes (ex. `FOYER_EVENT_SOURCE` du contrat du contexte). */
  source: string;
  /** Table outbox du schéma Drizzle du service (conforme au modèle ci-dessus). */
  table: TTable;
}
