import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  ModeContrat,
  PreavisRegle,
} from '@creche-planner/contracts-planification';
import type {
  JourSemaine,
  RegimeSemaine,
  ServiceCalendrier,
  TypeException,
  TypePeriode,
} from '@creche-planner/planification-domain';
import type { RegimeFeries } from '@creche-planner/shared-kernel';

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
  /**
   * Prénom de l'enfant concerné (ex. "Mia"/"Zoé"). **Dénormalisation d'affichage** :
   * la référence est `enfant_id` ; ce prénom est rafraîchi par la projection du
   * `foyer.EnfantModifie.v1` (cf. `consumers/projection.service.ts`) pour que le
   * renommage d'un enfant côté `svc-foyer` se propage aux contrats.
   */
  enfant: varchar('enfant', { length: 200 }).notNull(),
  /**
   * Identifiant de l'enfant (agrégat **svc-foyer**) — lien de référence du contrat.
   * Pas de FK (référence inter-services, comme `foyer_id`). **NULLABLE** le temps du
   * back-fill des contrats historiques (rapprochement par prénom au sein du foyer,
   * `scripts/backfill-enfants.mjs`) ; promotion NOT NULL différée, comme
   * `etablissement_id` (migration 0004).
   */
  enfantId: uuid('enfant_id'),
  /** Mode de garde : CRECHE_PSU | CANTINE | PERISCOLAIRE | ALSH. */
  mode: varchar('mode', { length: 32 }).notNull(),
  /**
   * Établissement d'accueil rattaché (P2). Référence **explicite** remplaçant la
   * déduction `mode → établissement` codée en dur. **NOT NULL** depuis P5 : le
   * back-fill prod a rattaché tous les contrats puis la migration différée a été
   * promue (`0004_contrat_etablissement_not_null`). FK vers `etablissement`
   * (déclarée plus bas, d'où la référence paresseuse `() => etablissement.id`). Le
   * `mode` reste une dimension **indépendante** (type/tarif, ≠ établissement).
   */
  etablissementId: uuid('etablissement_id')
    .notNull()
    .references(() => etablissement.id),
  /** Début de validité ISO `YYYY-MM-DD` (inclus). */
  valideDu: varchar('valide_du', { length: 10 }).notNull(),
  /** Fin de validité ISO `YYYY-MM-DD` (incluse), `null` si période ouverte. */
  valideAu: varchar('valide_au', { length: 10 }),
  /**
   * Première année d'inscription de l'enfant à l'association ABCM (frais de
   * 1ʳᵉ inscription, doc 02 §4.4 — chantier Coûts lot 4a). Saisi par le parent
   * dans le formulaire de contrat ABCM ; l'année de rattachement est dérivée de
   * `valide_du` (pas de date dédiée). Toujours `false` pour un contrat
   * CRECHE_PSU (le DTO crèche n'expose pas le champ ; défaut base conservé).
   */
  premiereInscription: boolean('premiere_inscription').notNull().default(false),
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
 * **Version datée** d'un contrat de garde (SFD 30 « versionnement à date d'effet »).
 * L'identité du contrat (mode, enfant, établissement, bornes de vie) reste dans
 * `contrat` ; ses paramètres **versionnés** (semaine type / inscriptions, heures
 * annuelles, nb mensualités) vivent ici, une ligne par **date d'effet**. Un avenant
 * insère une nouvelle version qui clôt implicitement la précédente la veille (fin
 * dérivée, jamais stockée — cf. `@creche-planner/shared-kernel`). La version dont
 * la période couvre aujourd'hui est **projetée** sur les colonnes homonymes de
 * `contrat` (lecteurs existants inchangés). `unique(contrat_id, date_effet)` refuse
 * deux versions le même jour (avenant → 409).
 */
export const contratVersion = pgTable(
  'contrat_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contratId: uuid('contrat_id')
      .notNull()
      .references(() => contrat.id, { onDelete: 'cascade' }),
    /** Date d'effet ISO `YYYY-MM-DD` (inclus) — début de la période de la version. */
    dateEffet: varchar('date_effet', { length: 10 }).notNull(),
    /** Heures annuelles contractualisées (crèche PSU) — `double precision`. */
    heuresAnnuellesContractualisees: doublePrecision(
      'heures_annuelles_contractualisees',
    ),
    /** Nombre de mensualités lissant l'année (crèche PSU). */
    nbMensualites: integer('nb_mensualites'),
    /** Semaine type crèche : jour → plages horaires (minutes). */
    semaineType: jsonb('semaine_type'),
    /** Semaine type ABCM : jour d'école → inscriptions péri/cantine. */
    semaineAbcm: jsonb('semaine_abcm'),
    /** Horodatage de saisie de la version (traçabilité, D6). */
    saisiLe: timestamp('saisi_le', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Motif optionnel de l'avenant/de la correction (traçabilité, D6). */
    motif: varchar('motif', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('contrat_version_contrat_date_uq').on(
      table.contratId,
      table.dateEffet,
    ),
  ],
);

/**
 * Journal des **corrections rétroactives** d'une version de contrat (D6, US-30-05).
 * Chaque correction (écrasement d'une version existante) écrit une ligne avant/après
 * (jsonb) + motif : trace complète de « qui a changé quoi » sans `saisi_par` en v1
 * (mono-foyer, l'identité est dans les logs gateway). Aucune ligne pour un avenant
 * (création d'une version nouvelle), seulement pour l'écrasement d'une version.
 */
export const correctionJournal = pgTable('correction_journal', {
  id: uuid('id').primaryKey().defaultRandom(),
  contratId: uuid('contrat_id')
    .notNull()
    .references(() => contrat.id, { onDelete: 'cascade' }),
  /** Version corrigée (référence de traçabilité, pas de FK — conservée si purge). */
  versionId: uuid('version_id').notNull(),
  /** État des paramètres versionnés **avant** correction. */
  avant: jsonb('avant').notNull(),
  /** État des paramètres versionnés **après** correction. */
  apres: jsonb('apres').notNull(),
  /** Motif optionnel de la correction. */
  motif: varchar('motif', { length: 500 }),
  corrigeLe: timestamp('corrige_le', { withTimezone: true })
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
    /**
     * Zone de vacances scolaires (`A`|`B`|`C`), `null` = pas de calendrier
     * scolaire (cas de la crèche). **Hors axe de connaissance, et c'est voulu** :
     * la zone ne dit pas ce qu'un jour vaut, elle dit seulement *où aller
     * chercher* les périodes à importer (lot 3). Les périodes importées, elles,
     * portent leur propre historisation — changer la zone n'altère donc
     * rétroactivement aucune résolution passée. Cf. `calendrierRegimeFeries`
     * juste en dessous pour le cas symétrique, qui lui **exige** l'axe.
     */
    zoneScolaire: varchar('zone_scolaire', { length: 1 }).$type<
      'A' | 'B' | 'C'
    >(),
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
 * ## Le calendrier d'ouverture — trois couches, **deux axes de temps**
 *
 * Traduction fidèle du domaine arrêté au lot 1
 * (`libs/planification/domain/src/lib/calendrier-ouverture.ts`) : c'est lui qui dit
 * ce que la persistance doit savoir, jamais l'inverse.
 *
 * 1. **Axe métier** — quand la chose a lieu : `du`/`au` d'une période (bornes
 *    **inclusives**), `jour` d'une exception, `jour_semaine` d'une récurrence.
 * 2. **Axe de connaissance** — ce que le calendrier disait à un instant donné :
 *    `connu_depuis` / `connu_jusqua`, intervalle **semi-ouvert** `[depuis, jusqua)`,
 *    borne haute **exclusive**. Ne pas l'aligner sur le `au` métier, qui est
 *    inclusif : les replier l'un sur l'autre décalerait la vérité d'un jour sans
 *    rien casser de visible.
 *
 * **Append-only** : une retouche ne fait jamais d'`UPDATE` de la donnée ni de
 * `DELETE` — elle pose `connu_jusqua` sur la ligne en vigueur et en insère une
 * nouvelle. Une suppression, côté API, est donc une **clôture**. C'est ce qui rend
 * un mois déjà facturé littéralement intouchable (RM-31-03).
 *
 * **Unicités partielles** (`WHERE connu_jusqua IS NULL`) : uniques parmi les lignes
 * **encore ouvertes** seulement. Une unicité totale interdirait exactement
 * l'historique qu'on veut garder. Les clés sont celles de `verifierUniciteOuverte`
 * dans le domaine — un jour pour les exceptions, un couple (régime, jour de
 * semaine) pour les récurrences, et rien pour les périodes (plusieurs peuvent
 * légitimement couvrir un même jour : une fermeture annuelle pendant des vacances).
 */

/** Provenance d'une période : import open data (lot 3) ou saisie du parent. */
export type SourcePeriode = 'IMPORT' | 'MANUEL';

/** Couche 2 — période datée (scolaire, vacances, fermeture annuelle). */
export const calendrierPeriode = pgTable(
  'calendrier_periode',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    etablissementId: uuid('etablissement_id')
      .notNull()
      .references(() => etablissement.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 32 }).$type<TypePeriode>().notNull(),
    libelle: varchar('libelle', { length: 200 }).notNull(),
    /** Début inclus, ISO `YYYY-MM-DD` (axe métier). */
    du: varchar('du', { length: 10 }).notNull(),
    /** Fin **incluse**, ISO `YYYY-MM-DD` (axe métier). */
    au: varchar('au', { length: 10 }).notNull(),
    /** Provenance : `IMPORT` (open data, lot 3) ou `MANUEL` (saisie parent). */
    source: varchar('source', { length: 16 })
      .$type<SourcePeriode>()
      .notNull()
      .default('MANUEL'),
    /** Année scolaire de rattachement (`2026-2027`), `null` hors import. */
    anneeScolaire: varchar('annee_scolaire', { length: 9 }),
    /** Horodatage de l'import qui a posé la ligne, `null` en saisie manuelle. */
    importeLe: timestamp('importe_le', { withTimezone: true }),
    connuDepuis: timestamp('connu_depuis', { withTimezone: true }).notNull(),
    connuJusqua: timestamp('connu_jusqua', { withTimezone: true }),
  },
  (table) => [
    // Lecture d'une plage : on filtre l'établissement puis l'axe métier. L'axe de
    // connaissance n'est PAS filtré en SQL (le domaine a besoin des lignes closes
    // pour répondre à un `aLaDate` passé) — l'index ne le porte donc pas.
    index('calendrier_periode_etab_du_idx').on(table.etablissementId, table.du),
  ],
);

/** Couche 1 — exception ponctuelle (la plus forte). */
export const calendrierException = pgTable(
  'calendrier_exception',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    etablissementId: uuid('etablissement_id')
      .notNull()
      .references(() => etablissement.id, { onDelete: 'cascade' }),
    /** Jour concerné, ISO `YYYY-MM-DD` (axe métier). */
    jour: varchar('jour', { length: 10 }).notNull(),
    type: varchar('type', { length: 32 }).$type<TypeException>().notNull(),
    libelle: varchar('libelle', { length: 200 }).notNull(),
    /**
     * Services visés — `null` = **tous** (fermeture totale, ou ouverture qui
     * rétablit la récurrence du jour). Validé par zod à l'écriture contre les
     * modes connus : un mode inconnu qui dort en base casse la résolution des
     * mois plus tard, quand plus personne ne fait le lien.
     */
    services: jsonb('services').$type<ServiceCalendrier[]>(),
    connuDepuis: timestamp('connu_depuis', { withTimezone: true }).notNull(),
    connuJusqua: timestamp('connu_jusqua', { withTimezone: true }),
  },
  (table) => [
    // Clé de `verifierUniciteOuverte` côté exceptions : au plus une ligne ouverte
    // par jour, l'historique en garde autant que de retouches.
    uniqueIndex('calendrier_exception_jour_ouvert_uq')
      .on(table.etablissementId, table.jour)
      .where(sql`${table.connuJusqua} is null`),
  ],
);

/** Couche 3 — récurrence hebdomadaire, par régime et jour de semaine. */
export const calendrierRecurrence = pgTable(
  'calendrier_recurrence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    etablissementId: uuid('etablissement_id')
      .notNull()
      .references(() => etablissement.id, { onDelete: 'cascade' }),
    regime: varchar('regime', { length: 16 }).$type<RegimeSemaine>().notNull(),
    jourSemaine: varchar('jour_semaine', { length: 16 })
      .$type<JourSemaine>()
      .notNull(),
    /** Services ouverts ce jour-là sous ce régime (liste, jamais `null`). */
    services: jsonb('services').$type<ServiceCalendrier[]>().notNull(),
    connuDepuis: timestamp('connu_depuis', { withTimezone: true }).notNull(),
    connuJusqua: timestamp('connu_jusqua', { withTimezone: true }),
  },
  (table) => [
    // Clé de `verifierUniciteOuverte` côté récurrences.
    uniqueIndex('calendrier_recurrence_ouvert_uq')
      .on(table.etablissementId, table.regime, table.jourSemaine)
      .where(sql`${table.connuJusqua} is null`),
  ],
);

/**
 * **Régime de fériés de l'établissement — historisé (`AM-106`, tranché ici).**
 *
 * Le lot 1 avait laissé la question ouverte, en la nommant précisément : « les
 * fériés sont calculés donc non historisés » est vrai du **calcul**, faux de son
 * **entrée**. `joursFeries(annee, regime)` est déterministe à régime constant ;
 * mais `regime` est une donnée saisie, et la porter par une colonne simple sur
 * `etablissement` (forme prévue par la D2) laissait un chemin de retouche
 * rétroactive : corriger un `FR` saisi par erreur en `FR_ALSACE_MOSELLE` rouvrait
 * le Vendredi saint et le 26 décembre sur des mois **déjà facturés** — deux jours
 * par an, mais exactement ce que RM-31-03 interdit. C'était le dernier trou de
 * l'amendement PO, et il ne se serait vu qu'à la première correction en prod.
 *
 * **Tranché : la colonne porte le même axe que les trois couches** — une table
 * append-only de plus, de forme identique, plutôt qu'une limite « écrite et
 * assumée ». Ce n'est pas gratuit (le CRUD établissement écrit ici), mais la
 * variante gratuite consistait à laisser survivre le seul chemin de réécriture du
 * passé au chantier qui existe pour le fermer.
 *
 * **Écart assumé vs la D2 du plan** : `etablissement` ne porte donc **pas** de
 * colonne `regime_feries`. Une source, pas deux — un cache dérivé sur
 * `etablissement` aurait rouvert la même question au premier désaccord entre les
 * deux. `EtablissementVue.regimeFeries` reste exposé au contrat : c'est la valeur
 * **actuellement connue**, lue sur la ligne ouverte. D7 tient toujours : sans
 * aucune ligne, la résolution retombe sur `FR`, le défaut national.
 */
export const calendrierRegimeFeries = pgTable(
  'calendrier_regime_feries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    etablissementId: uuid('etablissement_id')
      .notNull()
      .references(() => etablissement.id, { onDelete: 'cascade' }),
    regime: varchar('regime', { length: 32 }).$type<RegimeFeries>().notNull(),
    connuDepuis: timestamp('connu_depuis', { withTimezone: true }).notNull(),
    connuJusqua: timestamp('connu_jusqua', { withTimezone: true }),
  },
  (table) => [
    // Au plus un régime ouvert par établissement — l'analogue de
    // `verifierUniciteOuverte` pour une couche que le domaine ne connaît pas (il
    // reçoit un régime déjà résolu). La base est donc ici la SEULE garde
    // structurelle : c'est délibéré, et testé côté service.
    uniqueIndex('calendrier_regime_feries_ouvert_uq')
      .on(table.etablissementId)
      .where(sql`${table.connuJusqua} is null`),
  ],
);

/**
 * Journal des événements déjà consommés (clé = `id` d'enveloppe `IntegrationEvent`).
 * Le consommateur du stream `FOYER` (rafraîchissement de la dénormalisation
 * `contrat.enfant`) vérifie/insère cette ligne **dans la transaction** qui met à
 * jour les contrats : rejouer un événement (livraison at-least-once JetStream) est
 * alors un **no-op** — en particulier, pas de double ré-émission `ContratModifie`.
 * `stream`/`type` sont conservés pour le diagnostic.
 */
export const processedEvent = pgTable('processed_event', {
  /** Identifiant d'enveloppe de l'événement (clé d'idempotence). */
  id: uuid('id').primaryKey(),
  /** Stream JetStream d'origine (FOYER). */
  stream: varchar('stream', { length: 32 }).notNull(),
  /** Type métier versionné de l'événement (ex. `foyer.EnfantModifie.v1`). */
  type: varchar('type', { length: 200 }).notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Outbox transactionnelle (doc 06 §8.4). L'événement est inséré **dans la même
 * transaction** que le changement d'état ; un relais le publie ensuite sur NATS
 * et renseigne `published_at`. `id` = identifiant d'enveloppe = **clé d'idempotence**.
 */
export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey(),
    type: varchar('type', { length: 200 }).notNull(),
    payload: jsonb('payload').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    traceId: varchar('trace_id', { length: 64 }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    // Borne de rétention (lot 2b) : 30 j après publication effective.
    index('outbox_published_at_idx').on(table.publishedAt),
    // Backlog du relais, balayé **toutes les 2 s** : `published_at IS NULL` trié par
    // `occurred_at`. Index partiel, donc de la taille de la file, pas de la table
    // (volet index d'`AM-01`).
    index('outbox_backlog_idx')
      .on(table.occurredAt)
      .where(sql`${table.publishedAt} is null`),
  ],
);

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

export type ContratRow = typeof contrat.$inferSelect;
export type ContratVersionRow = typeof contratVersion.$inferSelect;
export type CorrectionJournalRow = typeof correctionJournal.$inferSelect;
export type PlanningMoisRow = typeof planningMois.$inferSelect;
export type EtablissementRow = typeof etablissement.$inferSelect;
export type ProcessedEventRow = typeof processedEvent.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;
export type DeadLetterRow = typeof deadLetter.$inferSelect;
export type CalendrierPeriodeRow = typeof calendrierPeriode.$inferSelect;
export type CalendrierExceptionRow = typeof calendrierException.$inferSelect;
export type CalendrierRecurrenceRow = typeof calendrierRecurrence.$inferSelect;
export type CalendrierRegimeFeriesRow =
  typeof calendrierRegimeFeries.$inferSelect;
