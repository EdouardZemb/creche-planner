import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  ModeContrat,
  PreavisRegle,
} from '@creche-planner/contracts-planification';

/**
 * Schéma Drizzle du service Planification (base dédiée). Persiste les contrats de
 * garde (crèche PSU / ABCM), le planning saisi par mois (réel ET simulé) et la
 * table `outbox` transactionnelle. Le domaine reste pur : la forme de la semaine
 * type et des saisies mensuelles est stockée en `jsonb` (déléguée au domaine pour
 * la génération des prestations).
 */

/**
 * Contrat de garde d'un enfant (doc 02 §3/§4/§7). Le mode discrimine la nature du
 * contrat ; les champs crèche (`heuresAnnuellesContractualisees`, `nbMensualites`,
 * `semaineType`) ne sont renseignés que pour `CRECHE_PSU`, la semaine type ABCM
 * (`semaineAbcm`) que pour les modes ABCM.
 */
export const contrat = pgTable('contrat', {
  id: uuid('id').primaryKey().defaultRandom(),
  foyerId: uuid('foyer_id').notNull(),
  /** Prénom de l'enfant concerné (ex. "Mia"/"Zoé"). */
  enfant: varchar('enfant', { length: 200 }).notNull(),
  /** Mode de garde : CRECHE_PSU | CANTINE | PERISCOLAIRE | ALSH. */
  mode: varchar('mode', { length: 32 }).notNull(),
  /** Début de validité ISO `YYYY-MM-DD` (inclus). */
  valideDu: varchar('valide_du', { length: 10 }).notNull(),
  /** Fin de validité ISO `YYYY-MM-DD` (incluse), `null` si période ouverte. */
  valideAu: varchar('valide_au', { length: 10 }),
  /**
   * Heures annuelles contractualisées (crèche PSU, doc 02 §7). Valeur
   * **fractionnaire** (ex. 885,5 / 831,5 h-an) → `double precision`, pas `integer`.
   */
  heuresAnnuellesContractualisees: doublePrecision(
    'heures_annuelles_contractualisees',
  ),
  /** Nombre de mensualités lissant l'année (crèche PSU, ici 7). */
  nbMensualites: integer('nb_mensualites'),
  /** Semaine type crèche : jour → plages horaires (minutes). */
  semaineType: jsonb('semaine_type'),
  /** Semaine type ABCM : jour d'école → inscriptions péri/cantine. */
  semaineAbcm: jsonb('semaine_abcm'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Planning saisi d'un mois pour un contrat. Un même contrat porte au plus une
 * ligne par `(mois, simule)` : `simule = false` est le planning **réel**,
 * `simule = true` le planning **simulé** (delta, doc 05 Phase 8). La `saisie`
 * (jsonb) porte les paramètres mensuels (complément, absences crèche ; PAI cantine ;
 * jours ALSH) transmis tels quels au domaine pour générer les prestations.
 */
export const planningMois = pgTable(
  'planning_mois',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contratId: uuid('contrat_id')
      .notNull()
      .references(() => contrat.id, { onDelete: 'cascade' }),
    /** Mois concerné ISO `YYYY-MM`. */
    mois: varchar('mois', { length: 7 }).notNull(),
    /** `true` = planning simulé, `false` = planning réel. */
    simule: boolean('simule').notNull().default(false),
    /** Paramètres mensuels de saisie (forme dépendante du mode). */
    saisie: jsonb('saisie').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('planning_mois_contrat_mois_simule_uq').on(
      table.contratId,
      table.mois,
      table.simule,
    ),
  ],
);

/**
 * **Établissement** d'accueil, entité libre **par foyer** (cf.
 * `.claude/plans/etablissements-entite-libre.md`). Remplace l'énumération fermée
 * codée en dur (« Crèche Les Hirondelles » / « École ABCM ») de `svc-notifications` :
 * créable / éditable / supprimable en nombre illimité. `svc-planification` en est
 * **propriétaire** (les contrats vivent ici → vraie FK `contrat.etablissement_id`
 * en P2) ; `svc-notifications` le **reçoit** par projection NATS (P3).
 *
 * Coordonnées modélisées en **colonnes plates** (`adresse`/`telephone`/`contact`)
 * plutôt qu'un `jsonb` opaque : petit ensemble fixe, requêtable, validation simple,
 * cohérent avec le reste du schéma. `types` (sous-ensemble de `MODES_CONTRAT`) reste
 * en `jsonb` (liste de longueur variable, purement informative). `UNIQUE(foyer_id,
 * nom)` dédoublonne la création à la volée (P2).
 */
export const etablissement = pgTable(
  'etablissement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Foyer propriétaire : portée par foyer (isolation inter-foyers). */
    foyerId: uuid('foyer_id').notNull(),
    /** Nom libre, unique par foyer. */
    nom: varchar('nom', { length: 200 }).notNull(),
    /** Destinataire des récaps de service (`null` tant que non renseigné). */
    emailService: varchar('email_service', { length: 320 }),
    /** Règle de préavis (union JOURS_OUVRES | JOUR_HEURE), `null` si non définie. */
    preavisRegle: jsonb('preavis_regle').$type<PreavisRegle>(),
    /** Sous-ensemble des modes proposés par l'établissement (informatif). */
    types: jsonb('types')
      .$type<ModeContrat[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Adresse postale (coordonnées/contact). */
    adresse: varchar('adresse', { length: 500 }),
    /** Téléphone de contact. */
    telephone: varchar('telephone', { length: 40 }),
    /** Personne référente. */
    contact: varchar('contact', { length: 200 }),
    /** Établissement actif (un établissement archivé n'est plus notifié). */
    actif: boolean('actif').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('etablissement_foyer_nom_uq').on(table.foyerId, table.nom),
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

export type ContratRow = typeof contrat.$inferSelect;
export type PlanningMoisRow = typeof planningMois.$inferSelect;
export type EtablissementRow = typeof etablissement.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;
