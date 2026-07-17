import {
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { Abonnement } from './consumer.types.js';

/**
 * Modèle structurel de la table `dead_letter` commune aux services. Sert
 * **uniquement de référence de type** (comme `outbox.options.ts` pour l'outbox) :
 * chaque service possède sa table `dead_letter` dans son propre schéma Drizzle
 * (et ses migrations), strictement identique à ce modèle — le typecheck échoue si
 * un service dérive.
 *
 * Une ligne est écrite pour tout message que le consommateur JetStream ne peut
 * pas traiter : JSON illisible (`PARSE_KO`), enveloppe sans `type`
 * (`ENVELOPPE_INVALIDE`), type non géré (`TYPE_INCONNU`) ou livraisons épuisées
 * (`MAX_LIVRAISONS`). Pas d'index sur `created_at` (volumes faibles).
 */
const modeleTableDeadLetter = pgTable('dead_letter', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** `id` d'enveloppe s'il a pu être lu (null si le JSON est illisible). */
  envelopeId: uuid('envelope_id'),
  /** Stream JetStream d'origine (ex. `FOYER`). */
  stream: varchar('stream', { length: 32 }).notNull(),
  /** Sujet NATS du message (ex. `foyer.EnfantModifie.v1`). */
  sujet: varchar('sujet', { length: 200 }).notNull(),
  /** `PARSE_KO` | `ENVELOPPE_INVALIDE` | `TYPE_INCONNU` | `MAX_LIVRAISONS`. */
  raison: varchar('raison', { length: 32 }).notNull(),
  /** Données brutes du message (tronquées à 64 Ko), pour diagnostic/rejeu manuel. */
  payload: text('payload').notNull(),
  /** Message d'erreur éventuel (ex. cause du `PARSE_KO`). */
  erreur: text('erreur'),
  /** Nombre de livraisons au moment de l'enregistrement. */
  livraisons: integer('livraisons').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type TableDeadLetter = typeof modeleTableDeadLetter;

/**
 * Contrainte **structurelle** sur la table fournie par le service : présence des
 * colonnes attendues, sans exiger l'identité de classe drizzle. Nécessaire car
 * les types drizzle vus par une app (CJS, résolution `require`) et par cette lib
 * (ESM, résolution `import`) ne s'unifient pas (TS2375) bien qu'identiques.
 */
export interface ColonnesDeadLetter {
  id: unknown;
  envelopeId: unknown;
  stream: unknown;
  sujet: unknown;
  raison: unknown;
  payload: unknown;
  erreur: unknown;
  livraisons: unknown;
  createdAt: unknown;
}

export const OPTIONS_CONSUMER = Symbol('OPTIONS_CONSUMER');

/** Points de variance du consommateur mutualisé, fournis par chaque service. */
export interface OptionsConsumer<
  TTable extends ColonnesDeadLetter = TableDeadLetter,
> {
  /** Streams amont consommés et leurs consommateurs durables. */
  abonnements: readonly Abonnement[];
  /** Table `dead_letter` du schéma Drizzle du service (conforme au modèle). */
  tableDeadLetter: TTable;
}
