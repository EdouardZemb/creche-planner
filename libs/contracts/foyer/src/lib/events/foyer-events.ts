import { z } from 'zod';
import { integrationEventSchema } from '@creche-planner/contracts-kernel';

/**
 * Événements d'intégration du bounded context **Foyer** (doc 06 §8.5).
 * Émis par `svc-foyer` via l'outbox, publiés sur NATS JetStream. Les montants
 * voyagent en **centimes entiers** (cohérent avec `Money`) et la tranche RFR est
 * un dérivé transporté pour épargner aux consommateurs la connaissance du barème.
 */

/** Service émetteur (champ `source` de l'enveloppe). */
export const FOYER_EVENT_SOURCE = 'svc-foyer';

// --- Identités brandées (parse-don't-validate, doc 03 §3) -------------------
// Les identifiants UUID sont brandés via Zod : à la sortie d'un `.parse()` on
// obtient un type nominal (FoyerId/EnfantId) impossible à confondre avec un
// string brut ou un autre identifiant. Coût runtime nul (l'étiquette est
// effacée), validation faite à la frontière.
export const foyerIdSchema = z.string().uuid().brand<'FoyerId'>();
export type FoyerId = z.infer<typeof foyerIdSchema>;

export const enfantIdSchema = z.string().uuid().brand<'EnfantId'>();
export type EnfantId = z.infer<typeof enfantIdSchema>;

export const parentIdSchema = z.string().uuid().brand<'ParentId'>();
export type ParentId = z.infer<typeof parentIdSchema>;

// --- foyer.FoyerMisAJour.v1 -------------------------------------------------

/** Nom métier versionné (champ `type` de l'enveloppe). */
export const FOYER_MIS_A_JOUR_TYPE = 'foyer.FoyerMisAJour.v1';

export const foyerMisAJourPayloadSchema = z.object({
  foyerId: foyerIdSchema,
  ressourcesMensuellesCentimes: z.number().int().nonnegative(),
  rfrCentimes: z.number().int().nonnegative(),
  nbEnfantsACharge: z.number().int().min(1),
  nbParts: z.number().positive(),
  /** Tranche RFR ABCM dérivée du RFR (1/2/3), transportée pour les consommateurs. */
  tranche: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
export type FoyerMisAJourPayload = z.infer<typeof foyerMisAJourPayloadSchema>;

export const foyerMisAJourEventSchema = integrationEventSchema(
  foyerMisAJourPayloadSchema,
);
export type FoyerMisAJourEvent = z.infer<typeof foyerMisAJourEventSchema>;

// --- foyer.FoyerMisAJour.v2 (rétrocompatible) -------------------------------

/**
 * **v2 rétrocompatible** de `foyer.FoyerMisAJour` (ADR-0004, décision 2 ; DEC-02).
 * Exerce réellement le versioning : un champ **optionnel** est ajouté sans rien
 * retirer ni renommer, de sorte qu'un payload v1 reste un payload v2 valide.
 *
 * Champ ajouté : `anneeRevenus` — l'année fiscale du RFR/des ressources
 * transportés (métadonnée d'audit). Optionnelle : un émetteur v1 ne la fournit
 * pas, un consommateur v2 sait l'exploiter quand elle est présente.
 */
export const FOYER_MIS_A_JOUR_V2_TYPE = 'foyer.FoyerMisAJour.v2';

export const foyerMisAJourPayloadV2Schema = foyerMisAJourPayloadSchema.extend({
  /** Année fiscale (ex. 2024) du RFR/des ressources. Optionnel pour rester rétrocompatible v1. */
  anneeRevenus: z.number().int().gte(2000).lte(2100).optional(),
});
export type FoyerMisAJourPayloadV2 = z.infer<
  typeof foyerMisAJourPayloadV2Schema
>;

export const foyerMisAJourEventV2Schema = integrationEventSchema(
  foyerMisAJourPayloadV2Schema,
);
export type FoyerMisAJourEventV2 = z.infer<typeof foyerMisAJourEventV2Schema>;

// --- foyer.FoyerMisAJour.v3 (ressources versionnées à date d'effet) ---------

/**
 * **v3 additive** de `foyer.FoyerMisAJour` (SFD 30, D4/DV-03). Les ressources d'un
 * foyer deviennent une **suite de versions à date d'effet** : chaque version émet un
 * v3 portant, en plus du payload v2, l'identité de la version (`versionId`) et sa
 * `dateEffet`. La `tranche` transportée est celle **dérivée du barème applicable à la
 * date d'effet** — le consommateur (tarification) la projette telle quelle et la
 * résout au mois calculé. Un payload v2 reste un payload v3 valide moins ces deux
 * champs ; le dispatch se fait par `version` d'enveloppe (patron `decoderFoyerMisAJour`).
 */
export const FOYER_MIS_A_JOUR_V3_TYPE = 'foyer.FoyerMisAJour.v3';

export const foyerMisAJourPayloadV3Schema = foyerMisAJourPayloadV2Schema.extend(
  {
    /** Identité stable de la version de ressources (une ligne `foyer_version`). */
    versionId: z.string().uuid(),
    /** Date d'effet de la version, ISO `YYYY-MM-DD` (granularité jour, H1). */
    dateEffet: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO YYYY-MM-DD attendue'),
    /**
     * **Fin** de la version, ISO `YYYY-MM-DD` **incluse** — veille de la date d'effet
     * de la version suivante ; `null` = version **en vigueur** (aucune suivante).
     *
     * Matérialisée depuis le lot 1 « le coût ne ment plus » (`AM-55`) : elle était
     * jusque-là **dérivée à la lecture** par chaque consommateur, ce qui rendait
     * indiscernables « version encore en vigueur » et « version dont on ignore la
     * suite » — l'aval valorisait alors un mois passé avec des ressources qui ne le
     * couvraient pas, sans lever d'erreur.
     *
     * **Champ absent** = événement émis **avant** ce lot, encore en vol dans un
     * outbox : le consommateur le projette en `null`, ce qui reproduit exactement la
     * dérivation d'avant (la sélection à date départage deux périodes ouvertes par la
     * date d'effet la plus récente). Le premier enregistrement de ressources ré-émet
     * l'historique complet et rétablit les bornes.
     */
    dateFin: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO YYYY-MM-DD attendue')
      .nullable()
      .optional(),
  },
);
export type FoyerMisAJourPayloadV3 = z.infer<
  typeof foyerMisAJourPayloadV3Schema
>;

export const foyerMisAJourEventV3Schema = integrationEventSchema(
  foyerMisAJourPayloadV3Schema,
);
export type FoyerMisAJourEventV3 = z.infer<typeof foyerMisAJourEventV3Schema>;

// --- foyer.EnfantAjoute.v1 --------------------------------------------------

/** Nom métier versionné (champ `type` de l'enveloppe). */
export const ENFANT_AJOUTE_TYPE = 'foyer.EnfantAjoute.v1';

export const enfantAjoutePayloadSchema = z.object({
  foyerId: foyerIdSchema,
  enfantId: enfantIdSchema,
  prenom: z.string().min(1),
  /** Date de naissance au format ISO `YYYY-MM-DD`. */
  dateNaissance: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO YYYY-MM-DD attendue'),
});
export type EnfantAjoutePayload = z.infer<typeof enfantAjoutePayloadSchema>;

export const enfantAjouteEventSchema = integrationEventSchema(
  enfantAjoutePayloadSchema,
);
export type EnfantAjouteEvent = z.infer<typeof enfantAjouteEventSchema>;

// --- foyer.Enfant{Modifie,Retire}.v1 ---------------------------------------

/**
 * Cycle de vie d'un **enfant** au-delà de l'ajout (cycle de vie du foyer, P4).
 * `Modifie` transporte l'**état complet** (le consommateur projette sans relire
 * la source, comme `EnfantAjoute`) ; `Retire` ne porte que les identités (la
 * suppression est un **hard delete** côté svc-foyer — pas de colonne `actif` sur
 * `enfant`, cohérent avec le `ON DELETE CASCADE`).
 *
 * Le couplage contrat→enfant de `svc-planification` se fait par `enfant_id`
 * (colonne encore nullable le temps du back-fill) : `EnfantModifie` y rafraîchit
 * la dénormalisation `contrat.enfant`, mais `EnfantRetire` n'y déclenche **rien**
 * — un contrat survit à l'enfant qu'il désigne. C'est l'effacement du foyer
 * entier (`FoyerSupprime`) qui emporte les contrats, pas le retrait unitaire.
 */
export const ENFANT_MODIFIE_TYPE = 'foyer.EnfantModifie.v1';
export const ENFANT_RETIRE_TYPE = 'foyer.EnfantRetire.v1';

/** État complet d'un enfant transporté par `EnfantModifie` (même forme qu'`EnfantAjoute`). */
export const enfantModifiePayloadSchema = enfantAjoutePayloadSchema;
export type EnfantModifiePayload = z.infer<typeof enfantModifiePayloadSchema>;

/** Identités seules : la suppression est un hard delete, l'état n'est pas reporté. */
export const enfantRetirePayloadSchema = z.object({
  foyerId: foyerIdSchema,
  enfantId: enfantIdSchema,
});
export type EnfantRetirePayload = z.infer<typeof enfantRetirePayloadSchema>;

export const enfantModifieEventSchema = integrationEventSchema(
  enfantModifiePayloadSchema,
);
export type EnfantModifieEvent = z.infer<typeof enfantModifieEventSchema>;

export const enfantRetireEventSchema = integrationEventSchema(
  enfantRetirePayloadSchema,
);
export type EnfantRetireEvent = z.infer<typeof enfantRetireEventSchema>;

// --- foyer.Parent{Ajoute,Modifie,Retire}.v1 --------------------------------

/**
 * Cycle de vie d'un **parent** d'un foyer (destinataire des notifications et,
 * en option B, identité de connexion via son e-mail — cf.
 * `.claude/plans/parents-foyer-modelisation.md`). Émis par `svc-foyer` via
 * l'outbox sur le stream `FOYER`, ils alimenteront la projection locale
 * `foyer_parent` de `svc-notifications` (PR 4) pour router le récap hebdo.
 *
 * `Ajoute` et `Modifie` transportent l'**état complet** du parent (le
 * consommateur projette sans relire la source) ; `Retire` ne porte que les
 * identités (le retrait est un soft-delete `actif = false` côté svc-foyer).
 */
export const PARENT_AJOUTE_TYPE = 'foyer.ParentAjoute.v1';
export const PARENT_MODIFIE_TYPE = 'foyer.ParentModifie.v1';
export const PARENT_RETIRE_TYPE = 'foyer.ParentRetire.v1';

/**
 * État complet d'un parent transporté par `ParentAjoute`/`ParentModifie`.
 * `prenom`/`nom` sont optionnels (identité douce) ; `email` = destinataire et
 * futur identifiant de login, unique **par foyer** parmi les parents actifs (plus
 * global : un même e-mail peut être parent de plusieurs foyers — familles
 * recomposées — et redevient réutilisable après un retrait). Les consommateurs
 * upsertent par `parentId` : un `ParentAjoute` de réactivation repasse `actif`.
 */
export const parentEtatPayloadSchema = z.object({
  foyerId: foyerIdSchema,
  parentId: parentIdSchema,
  email: z.email(),
  prenom: z.string().min(1).optional(),
  nom: z.string().min(1).optional(),
  principal: z.boolean(),
  actif: z.boolean(),
});

export const parentAjoutePayloadSchema = parentEtatPayloadSchema;
export type ParentAjoutePayload = z.infer<typeof parentAjoutePayloadSchema>;

export const parentModifiePayloadSchema = parentEtatPayloadSchema;
export type ParentModifiePayload = z.infer<typeof parentModifiePayloadSchema>;

/** Identités seules : le retrait est un soft-delete, l'état n'est pas reporté. */
export const parentRetirePayloadSchema = z.object({
  foyerId: foyerIdSchema,
  parentId: parentIdSchema,
});
export type ParentRetirePayload = z.infer<typeof parentRetirePayloadSchema>;

export const parentAjouteEventSchema = integrationEventSchema(
  parentAjoutePayloadSchema,
);
export type ParentAjouteEvent = z.infer<typeof parentAjouteEventSchema>;

export const parentModifieEventSchema = integrationEventSchema(
  parentModifiePayloadSchema,
);
export type ParentModifieEvent = z.infer<typeof parentModifieEventSchema>;

export const parentRetireEventSchema = integrationEventSchema(
  parentRetirePayloadSchema,
);
export type ParentRetireEvent = z.infer<typeof parentRetireEventSchema>;

// --- foyer.FoyerSupprime.v1 -------------------------------------------------

/**
 * **Effacement d'un foyer entier** (droit à l'effacement, lot 2 du plan
 * standards ; `AM-34`). Côté `svc-foyer` c'est un `DELETE` réel sur `foyer` :
 * les tables filles partent par `ON DELETE CASCADE` (versions de ressources,
 * journal de corrections, enfants, parents, et par les parents les préférences
 * et les jetons de désabonnement). Les read-models aval en détiennent des
 * **copies** — l'effacement doit donc **voyager en événement**, jamais en
 * suppression locale (doc 37 § 3, effet de bord).
 *
 * Le payload transporte les `parentIds` **parce que la boîte de réception
 * in-app de `svc-notifications` (table `notification`) est clé par `parent_id`
 * et ne porte aucun `foyer_id`** : sans cette liste, ces lignes — qui
 * contiennent des prénoms d'enfants — resteraient orphelines et invisibles.
 * Les parents **retirés** (soft-delete `actif = false`) y figurent aussi : ce
 * sont eux, précisément, dont l'effacement était impossible jusqu'ici.
 *
 * Identités seules, comme `EnfantRetire` : l'état supprimé n'est pas reporté.
 */
export const FOYER_SUPPRIME_TYPE = 'foyer.FoyerSupprime.v1';

export const foyerSupprimePayloadSchema = z.object({
  foyerId: foyerIdSchema,
  /** Tous les parents du foyer au moment de l'effacement, actifs **et** retirés. */
  parentIds: z.array(parentIdSchema),
});
export type FoyerSupprimePayload = z.infer<typeof foyerSupprimePayloadSchema>;

export const foyerSupprimeEventSchema = integrationEventSchema(
  foyerSupprimePayloadSchema,
);
export type FoyerSupprimeEvent = z.infer<typeof foyerSupprimeEventSchema>;

// --- Préférences de notification (profil parent, PR1) ----------------------

/**
 * Identité brandée d'une **préférence de notification** (parse-don't-validate).
 * Une ligne = un triplet `(parent, type de notification, canal)` : cf.
 * `.claude/plans/parent-profil-notifications.md` §3.1.
 */
export const preferenceNotificationIdSchema = z
  .string()
  .uuid()
  .brand<'PreferenceNotificationId'>();
export type PreferenceNotificationId = z.infer<
  typeof preferenceNotificationIdSchema
>;

/**
 * **Type de notification** adressé au parent. Enum partagé (contrat) entre
 * svc-foyer (propriétaire), le BFF et svc-notifications (projection) :
 * - `VALIDATION_HEBDO` : rappel du mardi « valider la semaine N+1 » (transactionnel) ;
 * - `RECAP_SERVICE` : récap sortant vers l'établissement (non désabonnable côté parent).
 */
export const TYPES_NOTIFICATION = [
  'VALIDATION_HEBDO',
  'RECAP_SERVICE',
] as const;
export const typeNotificationSchema = z.enum(TYPES_NOTIFICATION);
export type TypeNotification = (typeof TYPES_NOTIFICATION)[number];

/**
 * **Canal** de délivrance d'une notification. `PUSH` reste hors périmètre mais le
 * modèle est prévu extensible (nouvel item d'enum, migration additive nulle car
 * les préférences vivent dans une table dédiée).
 */
export const CANAUX = ['EMAIL', 'IN_APP'] as const;
export const canalSchema = z.enum(CANAUX);
export type Canal = (typeof CANAUX)[number];

// --- foyer.PreferencesNotifModifiees.v1 ------------------------------------

/** Nom métier versionné (champ `type` de l'enveloppe). */
export const PREFERENCES_NOTIF_MODIFIEES_TYPE =
  'foyer.PreferencesNotifModifiees.v1';

/**
 * État d'**une** préférence transporté par l'événement (matrice type × canal).
 * `consentementAt`/`desabonneAt` tracent l'opt-in/opt-out (RGPD, §7) ; optionnels
 * (absents tant qu'aucun choix explicite n'a été posé — la valeur reste le défaut
 * applicatif).
 */
export const preferenceNotifSchema = z.object({
  typeNotification: typeNotificationSchema,
  canal: canalSchema,
  actif: z.boolean(),
  consentementAt: z.iso.datetime().optional(),
  desabonneAt: z.iso.datetime().optional(),
});
export type PreferenceNotif = z.infer<typeof preferenceNotifSchema>;

/**
 * **État complet** des préférences d'un parent (le consommateur projette sans
 * relire la source, même patron que `ParentAjoute`/`ParentModifie`). Émis dans la
 * même transaction que l'écriture via l'outbox → stream `FOYER`. Payload PII
 * (identifie un parent) : flux interne, cf. plan §7.
 */
export const preferencesNotifModifieesPayloadSchema = z.object({
  foyerId: foyerIdSchema,
  parentId: parentIdSchema,
  preferences: z.array(preferenceNotifSchema),
});
export type PreferencesNotifModifieesPayload = z.infer<
  typeof preferencesNotifModifieesPayloadSchema
>;

export const preferencesNotifModifieesEventSchema = integrationEventSchema(
  preferencesNotifModifieesPayloadSchema,
);
export type PreferencesNotifModifieesEvent = z.infer<
  typeof preferencesNotifModifieesEventSchema
>;

/**
 * **Inventaire** des types d'événement du contexte Foyer — donc des sujets NATS
 * du stream `FOYER` : le sujet d'un message **est** son `type` (`OutboxRelay`
 * publie sur `evt.type`). C'est la seule liste exhaustive de ce qu'un
 * consommateur durable de `FOYER` peut recevoir.
 *
 * Sert à borner un abonnement (`filter_subjects`, `AM-53`) et surtout à **prouver
 * qu'aucun type publié n'est reçu sans être traité** : sans cette liste, un type
 * ajouté ici et oublié dans un `typesGeres` serait simplement filtré — jamais
 * livré, jamais projeté, sans un rebut pour le dire.
 *
 * Porte : `pnpm abonnements` échoue si un `_TYPE` de ce fichier n'y figure pas.
 */
export const TYPES_EVENEMENTS_FOYER: readonly string[] = [
  FOYER_MIS_A_JOUR_TYPE,
  FOYER_MIS_A_JOUR_V2_TYPE,
  FOYER_MIS_A_JOUR_V3_TYPE,
  FOYER_SUPPRIME_TYPE,
  ENFANT_AJOUTE_TYPE,
  ENFANT_MODIFIE_TYPE,
  ENFANT_RETIRE_TYPE,
  PARENT_AJOUTE_TYPE,
  PARENT_MODIFIE_TYPE,
  PARENT_RETIRE_TYPE,
  PREFERENCES_NOTIF_MODIFIEES_TYPE,
];
