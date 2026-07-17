import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Schéma Drizzle du service **Tarification** (base dédiée). Contrairement aux
 * services émetteurs (Foyer/Référentiel/Planification), Tarification est d'abord un
 * **consommateur** : il maintient un **read model** distribué — la projection locale
 * de l'état nécessaire au calcul du coût — alimenté (stage B) par les événements des
 * streams `FOYER`/`REFERENTIEL`/`PLANIFICATION` (eventual consistency), avec un
 * **fallback synchrone** REST si une projection est froide/incomplète.
 *
 * Le domaine reste pur (`@creche-planner/tarification-domain`) : les formes de saisie
 * (semaine type, prestations, barèmes) sont stockées en `jsonb` et passées telles
 * quelles au domaine au moment de valoriser. Les montants voyagent en **centimes
 * entiers** (cohérent avec `Money`).
 *
 * Stage A = schéma + migration uniquement. Les consommateurs qui peuplent ces tables
 * (et l'API « coût du mois/an ») arrivent au stage B.
 */

// --- Read model : Foyer (projeté depuis le stream FOYER) --------------------

/**
 * Projection d'un foyer (event `foyer.FoyerMisAJour.v1`). Porte tout ce que le
 * domaine de consolidation a besoin de connaître côté foyer : ressources, RFR,
 * tranche ABCM dérivée, nombre de parts et d'enfants à charge. `event_id` /
 * `occurred_at` permettent d'ignorer un événement plus ancien que l'état courant
 * (idempotence + ordre).
 */
export const foyer = pgTable('foyer', {
  /** Identifiant du foyer (PK = clé d'agrégat amont). */
  id: uuid('id').primaryKey(),
  /** Ressources mensuelles en centimes (doc 02 §0). */
  ressourcesMensuellesCentimes: integer('ressources_mensuelles_centimes')
    .notNull()
    .default(0),
  /** Revenu fiscal de référence en centimes. */
  rfrCentimes: integer('rfr_centimes').notNull().default(0),
  /** Tranche RFR ABCM dérivée (1/2/3). */
  tranche: integer('tranche').notNull(),
  /** Nombre de parts fiscales (numeric : peut être fractionnaire). */
  nbParts: numeric('nb_parts').notNull().default('0'),
  /** Nombre d'enfants à charge. */
  nbEnfantsACharge: integer('nb_enfants_a_charge').notNull().default(0),
  /** Id du dernier événement appliqué (corrélation/diagnostic). */
  eventId: uuid('event_id'),
  /** Horodatage d'occurrence du dernier événement appliqué (ordre). */
  occurredAt: timestamp('occurred_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Projection d'un enfant rattaché à un foyer (event `foyer.EnfantAjoute.v1`).
 * `prenom` sert de jointure faible avec les contrats/prestations (qui portent le
 * prénom de l'enfant côté Planification).
 */
export const enfant = pgTable('enfant', {
  /** Identifiant de l'enfant (PK = clé d'agrégat amont). */
  id: uuid('id').primaryKey(),
  foyerId: uuid('foyer_id').notNull(),
  prenom: varchar('prenom', { length: 200 }).notNull(),
  /** Date de naissance ISO `YYYY-MM-DD`. */
  dateNaissance: varchar('date_naissance', { length: 10 }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Read model : Référentiel (projeté depuis le stream REFERENTIEL) --------

/**
 * Projection d'une grille/barème applicable (event `referentiel.GrillePubliee.v1`).
 * Versionnement par période de validité (`valide_du`/`valide_au`) ; le détail
 * tarifaire (barèmes ABCM par tranche, barème d'effort PSU, frais fixes) est stocké
 * en `jsonb` et passé au domaine. `mode` discrimine la nature
 * (CRECHE_PSU | CANTINE | PERISCOLAIRE | ALSH).
 */
export const grilleTarifaire = pgTable(
  'grille_tarifaire',
  {
    /** Identifiant de grille amont (PK). */
    id: uuid('id').primaryKey(),
    /** Mode de garde couvert (CRECHE_PSU | CANTINE | PERISCOLAIRE | ALSH). */
    mode: varchar('mode', { length: 32 }).notNull(),
    /** Tranche ABCM concernée (1/2/3), `null` pour un barème PSU non tranché. */
    tranche: integer('tranche'),
    /** Début de validité ISO `YYYY-MM-DD` (inclus). */
    valideDu: varchar('valide_du', { length: 10 }).notNull(),
    /** Fin de validité ISO `YYYY-MM-DD` (incluse), `null` si période ouverte. */
    valideAu: varchar('valide_au', { length: 10 }),
    /** Paramètres tarifaires bruts (barème, montants en centimes…), forme domaine. */
    parametres: jsonb('parametres').notNull(),
    eventId: uuid('event_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Une grille amont par (mode, tranche, début de validité) : republication idempotente.
    unique('grille_tarifaire_mode_tranche_du_uq').on(
      table.mode,
      table.tranche,
      table.valideDu,
    ),
  ],
);

// --- Read model : Planification (projeté depuis le stream PLANIFICATION) ----

/**
 * Projection des prestations d'un mois pour un contrat (events
 * `planification.ContratCree.v1` / `planification.PlanningModifie.v1`). On stocke à
 * la fois l'identité du contrat (foyer, enfant, mode) et les **prestations générées**
 * (quantités sans montant — la valorisation est faite ici par le domaine). Le couple
 * `(contrat_id, mois, simule)` est unique : planning réel et simulé cohabitent
 * (discriminant booléen `simule`, comme côté Planification).
 */
export const prestationMois = pgTable(
  'prestation_mois',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contratId: uuid('contrat_id').notNull(),
    foyerId: uuid('foyer_id').notNull(),
    /** Prénom de l'enfant (jointure faible avec `enfant.prenom`). */
    enfant: varchar('enfant', { length: 200 }).notNull(),
    /** Mode de garde du contrat (CRECHE_PSU | CANTINE | PERISCOLAIRE | ALSH). */
    mode: varchar('mode', { length: 32 }).notNull(),
    /** Mois concerné ISO `YYYY-MM`. */
    mois: varchar('mois', { length: 7 }).notNull(),
    /** `true` = prestations du planning simulé, `false` = planning réel. */
    simule: boolean('simule').notNull().default(false),
    /** Prestations générées (quantités, saisie mensuelle), forme domaine. */
    prestations: jsonb('prestations').notNull(),
    eventId: uuid('event_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('prestation_mois_contrat_mois_simule_uq').on(
      table.contratId,
      table.mois,
      table.simule,
    ),
  ],
);

/**
 * Projection de l'**identité** d'un contrat de garde (event
 * `planification.ContratCree.v1`). Le payload `ContratCree` porte foyer/enfant/mode
 * mais pas les quantités : on les mémorise ici pour pouvoir, à la réception d'un
 * `PlanningModifie` (qui ne porte que `{contratId, mois, simule}`), rattacher les
 * prestations du mois au bon foyer/enfant/mode.
 */
export const contrat = pgTable('contrat', {
  /** Identifiant du contrat amont (PK). */
  id: uuid('id').primaryKey(),
  foyerId: uuid('foyer_id').notNull(),
  /** Prénom de l'enfant du contrat (jointure faible avec `enfant.prenom`). */
  enfant: varchar('enfant', { length: 200 }).notNull(),
  /** Mode de garde (CRECHE_PSU | CANTINE | PERISCOLAIRE | ALSH). */
  mode: varchar('mode', { length: 32 }).notNull(),
  /**
   * Première année d'inscription de l'enfant à l'association ABCM (frais de
   * 1ʳᵉ inscription, doc 02 §4.4 — lot 4b). Projeté depuis les événements
   * `ContratCree`/`ContratModifie` (`payload.premiereInscription ?? false` :
   * un événement antérieur au lot 4a ne porte pas le champ).
   */
  premiereInscription: boolean('premiere_inscription').notNull().default(false),
  /**
   * Début de validité du contrat ISO `YYYY-MM-DD` — dérive l'année scolaire de
   * rattachement des frais de 1ʳᵉ inscription. NULLABLE : les contrats projetés
   * avant ce lot n'ont pas la date (elle se remplit au prochain événement).
   */
  valideDu: varchar('valide_du', { length: 10 }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Idempotence de consommation --------------------------------------------

/**
 * Journal des événements déjà consommés (clé = `id` d'enveloppe `IntegrationEvent`).
 * Le consommateur (stage B) vérifie/insère cette ligne **dans la transaction** qui
 * met à jour le read model : rejouer un événement (livraison at-least-once
 * JetStream) est alors un **no-op**. `stream`/`type` sont conservés pour le
 * diagnostic.
 */
export const processedEvent = pgTable('processed_event', {
  /** Identifiant d'enveloppe de l'événement (clé d'idempotence). */
  id: uuid('id').primaryKey(),
  /** Stream JetStream d'origine (FOYER | REFERENTIEL | PLANIFICATION). */
  stream: varchar('stream', { length: 32 }).notNull(),
  /** Type métier versionné de l'événement (ex. `foyer.FoyerMisAJour.v1`). */
  type: varchar('type', { length: 200 }).notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Outbox (infra latente — pas d'émission au stage B) ---------------------

/**
 * Outbox transactionnelle (doc 06 §8.4) — **infra latente** conservée du template.
 * Au stage B, Tarification est un pur consommateur : il n'émet **aucun** événement,
 * le relais (`OutboxRelay`) a donc été retiré pour ne pas faire tourner un timer sur
 * une table toujours vide. La définition de table est conservée (pas de churn de
 * migration) en prévision d'un futur `tarification.CoutRecalcule.v1` : l'event serait
 * alors inséré **dans la même transaction** que la mise à jour du read model, puis
 * publié (stream `TARIFICATION`, dédup `Nats-Msg-Id` = `id`).
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
 * Dead-letter (chantier « Fondations backend », lot 1). Une ligne par message
 * JetStream non traité : illisible (`PARSE_KO`), enveloppe sans `type`
 * (`ENVELOPPE_INVALIDE`), type non géré (`TYPE_INCONNU`) ou livraisons épuisées
 * (`MAX_LIVRAISONS`) — plus aucune perte silencieuse. Copie **structurelle** du
 * modèle `libs/nest-commons/src/lib/messaging/dead-letter.options.ts` (le typecheck
 * de `ConsumerModule.forRoot({ tableDeadLetter })` échoue si le service dérive).
 * Pas d'index sur `created_at` (volumes faibles).
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
export type EnfantRow = typeof enfant.$inferSelect;
export type ContratRow = typeof contrat.$inferSelect;
export type GrilleTarifaireRow = typeof grilleTarifaire.$inferSelect;
export type PrestationMoisRow = typeof prestationMois.$inferSelect;
export type ProcessedEventRow = typeof processedEvent.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;
export type DeadLetterRow = typeof deadLetter.$inferSelect;
