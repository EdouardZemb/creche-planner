import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  DeltaModifs,
  SnapshotSemaine,
} from '../validation/validation.diff.js';

/**
 * Schéma Drizzle du service **Notifications** (base dédiée). Notifications est
 * d'abord un **consommateur** : il projette un read model des contrats (alimenté
 * par le stream `PLANIFICATION`) puis pilote la validation hebdomadaire du planning
 * et l'envoi de mails au service concerné.
 *
 * Lot 0 = scaffold : on ne pose que les **tables d'infra latentes** communes au
 * template (idempotence de consommation + outbox transactionnelle). Les tables
 * métier (`contrat`, `notification_hebdo`, `etablissement_destinataire`,
 * `envoi_etablissement`) arrivent aux lots suivants par migrations incrémentales.
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

// --- Read model : Parents du foyer (projeté depuis le stream FOYER) ----------

/**
 * Projection des **parents** d'un foyer (events `foyer.ParentAjoute.v1` /
 * `ParentModifie.v1` / `ParentRetire.v1`, stream `FOYER`, émis par `svc-foyer`).
 * Notifications projette ce read model pour **router le récap hebdomadaire vers les
 * bons destinataires** : à l'envoi, on résout les e-mails des parents **actifs** du
 * foyer (cf. `DestinatairesService`) plutôt que l'unique adresse globale
 * `NOTIF_EMAIL_PARENT` (conservée en repli, dépréciation progressive).
 *
 * `parent_id` est la clé (l'identité du parent côté svc-foyer). `Ajoute`/`Modifie`
 * portent l'état complet (upsert) ; `Retire` est un **soft-delete** (`actif = false`,
 * la ligne est conservée). Alimenté idempotemment via `processed_event`. On ne projette
 * pas `prenom`/`nom` : seul l'`email` (et `principal`, pour l'ordre des destinataires)
 * sert l'envoi.
 */
export const foyerParent = pgTable('foyer_parent', {
  /** Identité du parent amont (PK, = `parent.id` de svc-foyer). */
  parentId: uuid('parent_id').primaryKey(),
  /** Foyer de rattachement (filtre de résolution des destinataires). */
  foyerId: uuid('foyer_id').notNull(),
  /** Adresse e-mail destinataire du récap (PII). */
  email: varchar('email', { length: 320 }).notNull(),
  /** Destinataire « par défaut » du foyer (placé en tête de la liste `to`). */
  principal: boolean('principal').notNull().default(false),
  /** Parent actif (un parent retiré reste en base avec `actif = false`). */
  actif: boolean('actif').notNull().default(true),
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

// --- État de validation hebdomadaire ----------------------------------------

/**
 * Type métier (versionné implicitement) d'une notification hebdomadaire. Une seule
 * valeur au Lot 4 (`VALIDATION_HEBDO`) — la colonne `type` la matérialise pour
 * autoriser plus tard d'autres familles de rappels sans toucher la clé d'unicité.
 */
export const TYPE_VALIDATION_HEBDO = 'VALIDATION_HEBDO';

/**
 * Statut de la validation d'une semaine pour un contrat :
 * - `A_VALIDER` : notifiée, en attente de l'accusé du parent (indicateur in-app) ;
 * - `VALIDEE` : validée sans modification du planning depuis le snapshot ;
 * - `VALIDEE_AVEC_MODIFS` : validée alors que la relecture diffère du snapshot
 *   (le `delta_modifs` porte alors les jours changés).
 */
export const STATUTS_NOTIFICATION = [
  'A_VALIDER',
  'VALIDEE',
  'VALIDEE_AVEC_MODIFS',
] as const;
export type StatutNotification = (typeof STATUTS_NOTIFICATION)[number];

/**
 * État de la **validation hebdomadaire** du planning d'un contrat (cœur du Lot 4).
 * Le planning amont (`svc-planification`) est stocké **par mois** et **n'a aucune
 * notion de semaine ni de validation** : cette table porte donc, côté notifications,
 * le snapshot des jours de la semaine N+1 figé au moment de la notification du mardi
 * (Lot 5) et, à la validation, le `delta_modifs` issu du diff avec une relecture du
 * planning. La clé `UNIQUE(contrat_id, semaine_iso, type)` garantit l'idempotence du
 * scheduler (un seul enregistrement par semaine) et sert de clé d'indicateur in-app.
 */
export const notificationHebdo = pgTable(
  'notification_hebdo',
  {
    id: uuid('id').primaryKey(),
    /** Contrat concerné (read model `contrat`). */
    contratId: uuid('contrat_id').notNull(),
    /** Foyer du contrat (filtre de la liste « à valider » par foyer). */
    foyerId: uuid('foyer_id').notNull(),
    /** Semaine ISO 8601 concernée, format `YYYY-Www` (ex. `2026-W27`). */
    semaineIso: varchar('semaine_iso', { length: 8 }).notNull(),
    /** Famille de notification (`VALIDATION_HEBDO`, cf. `TYPE_VALIDATION_HEBDO`). */
    type: varchar('type', { length: 32 }).notNull(),
    /** Statut courant (cf. `STATUTS_NOTIFICATION`). */
    statut: varchar('statut', { length: 32 }).notNull(),
    /** Horodatage de la notification (création de la ligne). */
    notifieeLe: timestamp('notifiee_le', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Horodatage de la validation par le parent (`null` tant que `A_VALIDER`). */
    valideeLe: timestamp('validee_le', { withTimezone: true }),
    /** Snapshot des jours de la semaine au moment de la notification (diff de base). */
    snapshot: jsonb('snapshot').$type<SnapshotSemaine>().notNull(),
    /** Jours modifiés entre le snapshot et la relecture à la validation (si modifs). */
    deltaModifs: jsonb('delta_modifs').$type<DeltaModifs>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('notification_hebdo_contrat_semaine_type_uq').on(
      table.contratId,
      table.semaineIso,
      table.type,
    ),
  ],
);

// --- Journal des envois de mail au service (action sortante réelle) ----------

/**
 * Statut d'un envoi de récap au service :
 * - `EN_COURS` : ligne posée (slot réservé) avant l'appel au transport — un crash
 *   entre l'insert et l'update laisse cette trace plutôt qu'un envoi fantôme ;
 * - `ENVOYE` : transport SMTP réel sollicité, `message_id` renseigné ;
 * - `DRY_RUN` : envoi neutralisé par le garde-fou du mailer (bac à sable ou
 *   destinataire hors allowlist) — aucun SMTP réel, `message_id` nul ;
 * - `ECHEC` : le transport a levé — `erreur` porte le motif, rien n'est parti.
 */
export const STATUTS_ENVOI = [
  'EN_COURS',
  'ENVOYE',
  'ECHEC',
  'DRY_RUN',
] as const;
export type StatutEnvoi = (typeof STATUTS_ENVOI)[number];

/**
 * Journal de l'**action sortante réelle** : le mail récapitulatif **agrégé par
 * établissement** envoyé au service concerné (crèche / école ABCM) après relecture
 * humaine. Granularité de la feature d'édition hebdo (Phase 4) : **un seul mail par
 * établissement**, regroupant **tous les enfants du foyer** dont la semaine a été
 * validée avec modifications (remplace l'envoi par-contrat du Lot 6). C'est la
 * première I/O vers un tiers réel : la ligne en porte la **preuve** (`destinataire`
 * figé, `sujet`, `corps` rendu) et le **résultat** (`statut`, `message_id`/`erreur`).
 *
 * La clé `UNIQUE(foyer_id, semaine_iso, etablissement_cle)` garantit l'idempotence :
 * un second clic « Envoyer » (ou un rejeu) ne ré-émet pas le même récap — l'insert
 * `onConflictDoNothing` ne réserve le slot qu'une fois, et l'appelant renvoie alors
 * l'envoi déjà journalisé. `destinataire`/`sujet`/`corps` sont **figés** à l'insert :
 * ils prouvent ce qui a réellement été adressé, indépendamment d'une édition ultérieure
 * de l'annuaire ou du planning.
 */
export const envoiEtablissement = pgTable(
  'envoi_etablissement',
  {
    id: uuid('id').primaryKey(),
    /** Foyer concerné (regroupe tous les enfants du récap). */
    foyerId: uuid('foyer_id').notNull(),
    /** Semaine ISO 8601 du récap, format `YYYY-Www`. */
    semaineIso: varchar('semaine_iso', { length: 8 }).notNull(),
    /** Clé de l'établissement destinataire (`CRECHE_HIRONDELLES` | `ABCM`). */
    etablissementCle: varchar('etablissement_cle', { length: 32 }).notNull(),
    /** Adresse réellement visée, **figée** à l'insert (preuve, pas une jointure vive). */
    destinataire: varchar('destinataire', { length: 320 }).notNull(),
    /** Sujet du mail, figé. */
    sujet: varchar('sujet', { length: 300 }).notNull(),
    /** Corps rendu (HTML), figé — preuve du contenu adressé au service. */
    corps: text('corps').notNull(),
    /** Statut courant (cf. `STATUTS_ENVOI`). */
    statut: varchar('statut', { length: 16 }).notNull(),
    /** Identifiant de message SMTP (`null` en dry-run / avant complétion). */
    messageId: varchar('message_id', { length: 998 }),
    /** Motif de l'échec si `statut = ECHEC` (`null` sinon). */
    erreur: text('erreur'),
    /** Horodatage de complétion (`null` tant que `EN_COURS`). */
    envoyeLe: timestamp('envoye_le', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('envoi_etablissement_foyer_semaine_etab_uq').on(
      table.foyerId,
      table.semaineIso,
      table.etablissementCle,
    ),
  ],
);

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
export type FoyerParentRow = typeof foyerParent.$inferSelect;
export type EtablissementRow = typeof etablissementDestinataire.$inferSelect;
export type NotificationHebdoRow = typeof notificationHebdo.$inferSelect;
export type EnvoiEtablissementRow = typeof envoiEtablissement.$inferSelect;
export type ProcessedEventRow = typeof processedEvent.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;
