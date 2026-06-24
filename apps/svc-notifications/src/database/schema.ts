import { jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * Schéma Drizzle du service **Notifications** (base dédiée). Notifications est
 * d'abord un **consommateur** : il projette un read model des contrats (alimenté
 * par le stream `PLANIFICATION`) puis pilote la validation hebdomadaire du planning
 * et l'envoi de mails au service concerné.
 *
 * Lot 0 = scaffold : on ne pose que les **tables d'infra latentes** communes au
 * template (idempotence de consommation + outbox transactionnelle). Les tables
 * métier (`contrat`, `notification_hebdo`, `etablissement_destinataire`,
 * `envoi_mail`) arrivent aux lots suivants par migrations incrémentales.
 */

// --- Idempotence de consommation --------------------------------------------

/**
 * Journal des événements déjà consommés (clé = `id` d'enveloppe `IntegrationEvent`).
 * Le consommateur (Lot 1) vérifie/insère cette ligne **dans la transaction** qui met
 * à jour le read model : rejouer un événement (livraison at-least-once JetStream) est
 * alors un **no-op**. `stream`/`type` sont conservés pour le diagnostic.
 */
export const processedEvent = pgTable('processed_event', {
  /** Identifiant d'enveloppe de l'événement (clé d'idempotence). */
  id: uuid('id').primaryKey(),
  /** Stream JetStream d'origine (ici `PLANIFICATION`). */
  stream: varchar('stream', { length: 32 }).notNull(),
  /** Type métier versionné de l'événement (ex. `planification.ContratCree.v1`). */
  type: varchar('type', { length: 200 }).notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Outbox (infra latente — pas d'émission au Lot 0) -----------------------

/**
 * Outbox transactionnelle (doc 06 §8.4) — **infra latente** conservée du template.
 * Notifications est d'abord un consommateur ; la définition de table est posée dès le
 * scaffold (pas de churn de migration) en prévision d'un futur événement émis (ex.
 * `notifications.MailEnvoye.v1`), qui serait inséré **dans la même transaction** que
 * la mise à jour de l'état, puis publié (stream `NOTIFICATIONS`, dédup
 * `Nats-Msg-Id` = `id`).
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

export type ProcessedEventRow = typeof processedEvent.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;
