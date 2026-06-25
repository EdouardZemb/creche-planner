import {
  boolean,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

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

// --- Read model : Planification (projeté depuis le stream PLANIFICATION) ----

/**
 * Projection de l'**identité** d'un contrat de garde (events
 * `planification.ContratCree.v1` / `ContratModifie.v1` / `ContratSupprime.v1`,
 * stream `PLANIFICATION`). Notifications projette ce read model pour savoir, lors de
 * la validation hebdomadaire, **quels contrats actifs** notifier, à quel foyer ils
 * appartiennent et sur quelle **période de validité** (`valide_du`/`valide_au`) ils
 * portent. Le `mode` sert plus tard à résoudre l'établissement destinataire
 * (`CRECHE_PSU` → crèche ; `PERISCOLAIRE`/`CANTINE`/`ALSH` → ABCM). Alimenté
 * idempotemment via `processed_event` (cf. plus bas), une seule ligne par contrat.
 */
export const contrat = pgTable('contrat', {
  /** Identifiant du contrat amont (PK). */
  id: uuid('id').primaryKey(),
  foyerId: uuid('foyer_id').notNull(),
  /** Prénom de l'enfant du contrat (jointure faible avec le référentiel amont). */
  enfant: varchar('enfant', { length: 200 }).notNull(),
  /** Mode de garde (CRECHE_PSU | PERISCOLAIRE | CANTINE | ALSH). */
  mode: varchar('mode', { length: 32 }).notNull(),
  /** Début de validité ISO `YYYY-MM-DD` (inclus). */
  valideDu: varchar('valide_du', { length: 10 }).notNull(),
  /** Fin de validité ISO `YYYY-MM-DD` (incluse), `null` si période ouverte. */
  valideAu: varchar('valide_au', { length: 10 }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Annuaire des établissements destinataires ------------------------------

/**
 * Règle de **préavis** d'un établissement (Lot 3). Modélisée comme paramètre par
 * établissement plutôt qu'en constante « 3 jours ouvrés », car elle **diverge** :
 * 2 jours ouvrés côté crèche (RM-03) vs « jeudi 12h » côté ABCM (RM-07). Sert à
 * l'affichage et au garde-fou de la validation hebdo (le scheduler du mardi n'en
 * dépend pas). Union discriminée par `type` (état invalide irreprésentable).
 */
export type PreavisRegle =
  | { readonly type: 'JOURS_OUVRES'; readonly valeur: number }
  | {
      readonly type: 'JOUR_HEURE';
      readonly jour: string;
      readonly heure: string;
    };

/**
 * Annuaire de contacts **propre au domaine notifications** (ce n'est PAS le
 * référentiel tarifaire). Une ligne par établissement destinataire d'un mail de
 * service, identifiée par une `cle` stable (`CRECHE_HIRONDELLES` | `ABCM`). Le
 * mapping `mode → cle` (codé : `CRECHE_PSU → CRECHE_HIRONDELLES` ;
 * `PERISCOLAIRE`/`CANTINE`/`ALSH` → `ABCM`) résout l'établissement à partir du
 * mode du contrat — rappel : il n'existe pas de mode « ABCM ». Seedée des 2
 * établissements au démarrage ; éditable via `PUT /etablissements/:cle`.
 */
export const etablissementDestinataire = pgTable('etablissement_destinataire', {
  id: uuid('id').primaryKey(),
  /** Clé métier stable et unique (`CRECHE_HIRONDELLES` | `ABCM`). */
  cle: varchar('cle', { length: 32 }).notNull().unique(),
  /** Libellé lisible (ex. « Crèche Les Hirondelles »). */
  libelle: varchar('libelle', { length: 200 }).notNull(),
  /** Adresse e-mail du service destinataire des récapitulatifs. */
  emailService: varchar('email_service', { length: 320 }).notNull(),
  /** Règle de préavis propre à l'établissement (cf. `PreavisRegle`). */
  preavisRegle: jsonb('preavis_regle').$type<PreavisRegle>().notNull(),
  /** Établissement actif (un établissement inactif n'est plus notifié). */
  actif: boolean('actif').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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

export type ContratRow = typeof contrat.$inferSelect;
export type EtablissementRow = typeof etablissementDestinataire.$inferSelect;
export type ProcessedEventRow = typeof processedEvent.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;
