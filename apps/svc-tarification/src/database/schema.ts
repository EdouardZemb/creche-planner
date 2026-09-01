import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
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
 * Projection des **versions de ressources** d'un foyer (event `foyer.FoyerMisAJour.v3`,
 * SFD 30 DV-03). Chaque version porte sa `date_effet` et la `tranche` déjà dérivée
 * par svc-foyer au barème de cette date : le calcul résout la version applicable **au
 * 1er du mois** (H7). `id` = `versionId` amont (PK). Les v1/v2 continuent d'alimenter
 * la ligne « courante » de `foyer` (compat) ; un foyer sans version projetée retombe
 * dessus. Garde de monotonie `occurred_at` par version.
 */
export const foyerVersion = pgTable(
  'foyer_version',
  {
    /** Identité de version amont (`versionId`, PK). */
    id: uuid('id').primaryKey(),
    foyerId: uuid('foyer_id').notNull(),
    /** Date d'effet ISO `YYYY-MM-DD`. */
    dateEffet: varchar('date_effet', { length: 10 }).notNull(),
    /**
     * **Fin** de la version, ISO `YYYY-MM-DD` **incluse** ; `NULL` = version **en
     * vigueur**. Copie de `svc-foyer.foyer_version.date_fin` (`AM-55`). C'est la
     * borne que le calcul du coût interroge : un mois qu'aucune période ne couvre
     * n'a **pas** de ressources connues, et le service le dit au lieu de se rabattre
     * sur celles d'aujourd'hui.
     */
    dateFin: varchar('date_fin', { length: 10 }),
    ressourcesMensuellesCentimes: integer('ressources_mensuelles_centimes')
      .notNull()
      .default(0),
    rfrCentimes: integer('rfr_centimes').notNull().default(0),
    /** Tranche RFR ABCM dérivée au barème de la date d'effet (1/2/3). */
    tranche: integer('tranche').notNull(),
    nbEnfantsACharge: integer('nb_enfants_a_charge').notNull().default(0),
    nbParts: numeric('nb_parts').notNull().default('0'),
    eventId: uuid('event_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('foyer_version_foyer_date_uq').on(table.foyerId, table.dateEffet),
    // Borne de rétention T1 (doc 37 §3) sur la copie. Index partiel : une version
    // en vigueur (`date_fin IS NULL`) n'est jamais purgée.
    index('foyer_version_date_fin_idx')
      .on(table.dateFin)
      .where(sql`${table.dateFin} is not null`),
  ],
);

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
    /**
     * Identifiant technique de la ligne (PK **surrogate**, sans signification
     * métier). Une grille amont est publiée en **un événement par mode ABCM**,
     * tous porteurs du même `grilleId` : celui-ci ne peut donc pas porter la PK
     * (il alimente 3 lignes). L'identité métier est `(mode, tranche, valide_du)`,
     * portée par `grille_tarifaire_mode_tranche_du_uq` — cible du `ON CONFLICT`
     * de la projection, qui assure l'idempotence des republications.
     */
    id: uuid('id').primaryKey().defaultRandom(),
    /** Identifiant de la grille amont d'origine (traçabilité ; non discriminant). */
    grilleId: uuid('grille_id').notNull(),
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

/**
 * Projection du **barème PSU** applicable (event `referentiel.BaremePsuPublie.v1`).
 * Versionné par période de validité (`valide_du`/`valide_au`). Le taux d'effort
 * (map `nbEnfants → taux`) et les bornes CNAF sont projetés bruts et passés au
 * domaine, résolus **à la date du mois** (RM-30-04 : plus de barème figé dans le
 * calcul). `valide_du` est unique (une version par date de début).
 */
export const baremePsu = pgTable(
  'bareme_psu',
  {
    /** Identifiant du barème amont (PK). */
    id: uuid('id').primaryKey(),
    /** Début de validité ISO `YYYY-MM-DD` (inclus). */
    valideDu: varchar('valide_du', { length: 10 }).notNull(),
    /** Fin de validité ISO `YYYY-MM-DD` (incluse), `null` si période ouverte. */
    valideAu: varchar('valide_au', { length: 10 }),
    /** Map `nbEnfantsACharge` (chaîne) → taux horaire CNAF, forme domaine. */
    taux: jsonb('taux').notNull(),
    /** Plancher de ressources CNAF en centimes, `null` si non appliqué. */
    plancherCentimes: integer('plancher_centimes'),
    /** Plafond de ressources CNAF en centimes, `null` si non appliqué. */
    plafondCentimes: integer('plafond_centimes'),
    eventId: uuid('event_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Un barème amont par début de validité : republication idempotente.
    unique('bareme_psu_du_uq').on(table.valideDu),
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
  /** Id du dernier événement appliqué (corrélation/diagnostic). */
  eventId: uuid('event_id'),
  /**
   * Horodatage d'occurrence du dernier événement appliqué (garde de monotonie) :
   * un événement plus ancien re-livré (NAK/backoff JetStream) n'écrase plus un état
   * plus récent. NULLABLE : auto-amorçage au premier événement, pas de back-fill
   * (les lignes projetées avant ce lot ont `occurred_at NULL`).
   */
  occurredAt: timestamp('occurred_at', { withTimezone: true }),
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
export const deadLetter = pgTable(
  'dead_letter',
  {
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
  },
  // Borne de rétention (lot 2b) : 90 j. L'index arrive avec la purge, dans la même
  // migration — une première purge sur une table jamais nettoyée est sinon un
  // balayage séquentiel intégral.
  (table) => [index('dead_letter_created_at_idx').on(table.createdAt)],
);

// --- Unités associatives (SFD 40) — source de vérité, pas une projection ------

/**
 * **Engagement de bénévolat** d'un foyer pour une période (SFD 40, US-40-01).
 * Première table de ce service qui n'est PAS un read model : les unités
 * associatives se **saisissent** ici, et elles vivent dans Tarification parce que
 * c'est le seul contexte autorisé à appeler le domaine qui en dérive le coût
 * (doc 02 §4.5, `UnitesAssociativesAbcm`) — cf. les frontières de contexte
 * d'`eslint.config.mjs`.
 *
 * Quota, valeur d'UA, bornes de période et caution sont des **données**
 * (`RM-40-02`) : un quota qui change à l'assemblée générale suivante se saisit, il
 * ne se déploie pas. Les défauts « 20 h / 31,25 € » du domaine ne sont plus qu'une
 * **proposition d'écran**.
 *
 * Pas de clé étrangère vers `foyer` : cette table-là est une projection, qui peut
 * être froide au moment où le parent déclare son engagement. La cascade
 * d'effacement est donc **explicite**, dans le consommateur de
 * `foyer.FoyerSupprime.v1` (`ProjectionService`), aux côtés des autres tables.
 */
export const engagementUa = pgTable(
  'engagement_ua',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    foyerId: uuid('foyer_id').notNull(),
    /** Début de la période de comptage ISO `YYYY-MM-DD` (inclus ; typiquement 1er juin). */
    debut: varchar('debut', { length: 10 }).notNull(),
    /** Fin de la période ISO `YYYY-MM-DD` **incluse** — c'est l'échéance affichée. */
    fin: varchar('fin', { length: 10 }).notNull(),
    /**
     * Quota d'unités associatives dues (1 UA = 1 h). `numeric` et non `integer` :
     * la variante « double accès portail » du RI vaut 10 UA par parent (`Q-40-02`),
     * et rien n'interdit un demi-quota au prorata d'une inscription en cours d'année.
     */
    quotaHeures: numeric('quota_heures').notNull(),
    /** Valeur d'une UA non réalisée, en centimes (comme tout montant du dépôt). */
    valeurUaCentimes: integer('valeur_ua_centimes').notNull(),
    /**
     * Caution déposée, en centimes. **Informative** : Martha ne touche à aucun
     * paiement (SFD 40 §2), elle affiche ce qui est en jeu. `null` si non saisie.
     */
    cautionCentimes: integer('caution_centimes'),
    creeLe: timestamp('cree_le', { withTimezone: true }).notNull().defaultNow(),
    majLe: timestamp('maj_le', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Une seule période par (foyer, début) : le non-chevauchement complet est vérifié
    // par le service (une contrainte d'exclusion sur des `varchar` n'existe pas), mais
    // le doublon exact, lui, est refusé par la base — un rejeu de formulaire ne crée
    // pas deux engagements identiques.
    unique('engagement_ua_foyer_debut_uq').on(table.foyerId, table.debut),
    index('engagement_ua_foyer_idx').on(table.foyerId),
  ],
);

/**
 * **Une session de bénévolat** — une ligne par créneau (SFD 40, US-40-02). C'est
 * une **recopie** d'un engagement pris sur le site travaux de l'association
 * (`RM-40-01`) : Martha ne réserve rien, elle tient le compte.
 *
 * `foyer_id` est dénormalisé depuis l'engagement : il porte la portée
 * (`@FoyerScope`) et la cascade d'effacement sans jointure.
 */
export const sessionUa = pgTable(
  'session_ua',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagementUa.id, { onDelete: 'cascade' }),
    /** Foyer propriétaire, dénormalisé de l'engagement (portée + purge). */
    foyerId: uuid('foyer_id').notNull(),
    /** Date du créneau ISO `YYYY-MM-DD`. */
    date: varchar('date', { length: 10 }).notNull(),
    /** Durée en heures ; décimale (une demi-heure de ménage existe). */
    dureeHeures: numeric('duree_heures').notNull(),
    /**
     * Type de créneau, pris dans `TYPES_SESSION_UA` du domaine. Colonne **libre**
     * (`varchar`) et non `enum` : le catalogue est une donnée (SFD 40 §3), et un
     * type ajouté au RI ne doit pas demander une migration.
     */
    type: varchar('type', { length: 32 }).notNull(),
    /** Qui s'y colle — prénom libre : ce service ne projette pas les parents. */
    realisePar: varchar('realise_par', { length: 200 }),
    /** Établissement concerné (Mulhouse / Lutterbach…), facultatif. */
    etablissementId: uuid('etablissement_id'),
    /** `PREVUE` | `REALISEE` | `ANNULEE` (`ETATS_SESSION_UA`). */
    etat: varchar('etat', { length: 16 }).notNull(),
    creeLe: timestamp('cree_le', { withTimezone: true }).notNull().defaultNow(),
    majLe: timestamp('maj_le', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Le suivi lit toujours « les sessions d'un engagement, par date » ; l'export de
    // portabilité et la purge balaient par foyer. Deux index, deux lectures réelles.
    index('session_ua_engagement_date_idx').on(table.engagementId, table.date),
    index('session_ua_foyer_idx').on(table.foyerId),
  ],
);

/**
 * **Piste d'audit acteur** de `svc-tarification` (doc 37 §7). Elle naît avec les
 * premières routes de mutation du service (`RM-40-08` : « dès le premier commit,
 * jamais en différé ») — jusqu'ici, Tarification n'écrivait rien qu'un humain ait
 * demandé, et n'avait donc rien à tracer.
 *
 * Copie **structurelle** de `svc-foyer.journal_audit`, à une différence près et
 * elle est délibérée : **aucune clé étrangère** vers `foyer`, qui n'est ici qu'une
 * projection possiblement froide. La ligne d'audit ne peut donc pas dépendre de
 * l'arrivée d'un événement pour être écrite.
 */
export const journalAudit = pgTable(
  'journal_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    foyerId: uuid('foyer_id').notNull(),
    /** Action consignée, prise dans `ACTIONS_AUDIT` (`audit/journal-audit.actions.ts`). */
    action: varchar('action', { length: 64 }).notNull(),
    /** Nature de la ressource visée (`engagement_ua`, `session_ua`). */
    cibleType: varchar('cible_type', { length: 32 }).notNull(),
    /** Identifiant de la ressource visée ; nul quand l'action porte le foyer entier. */
    cibleId: uuid('cible_id'),
    /** `parent` | `service` | `inconnu` — la forme de l'acteur, toujours connue. */
    acteurType: varchar('acteur_type', { length: 16 }).notNull(),
    /** E-mail du parent ou nom du service ; **nul** si `acteur_type = 'inconnu'`. */
    acteur: varchar('acteur', { length: 320 }),
    creeLe: timestamp('cree_le', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('journal_audit_foyer_date_idx').on(table.foyerId, table.creeLe),
  ],
);

export type FoyerRow = typeof foyer.$inferSelect;
export type EngagementUaRow = typeof engagementUa.$inferSelect;
export type SessionUaRow = typeof sessionUa.$inferSelect;
export type JournalAuditRow = typeof journalAudit.$inferSelect;
export type FoyerVersionRow = typeof foyerVersion.$inferSelect;
export type EnfantRow = typeof enfant.$inferSelect;
export type ContratRow = typeof contrat.$inferSelect;
export type GrilleTarifaireRow = typeof grilleTarifaire.$inferSelect;
export type BaremePsuRow = typeof baremePsu.$inferSelect;
export type PrestationMoisRow = typeof prestationMois.$inferSelect;
export type ProcessedEventRow = typeof processedEvent.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;
export type DeadLetterRow = typeof deadLetter.$inferSelect;
