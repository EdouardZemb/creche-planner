import { z } from 'zod';
import {
  integrationEventSchema,
  MODES_CONTRAT,
  type ModeContrat,
} from '@creche-planner/contracts-kernel';
import { preavisRegleSchema } from '../etablissement/preavis.js';

/**
 * Événements d'intégration du bounded context **Planification** (contrats de garde,
 * inscriptions ABCM, planning réel/simulé, doc 06 §9.3). Émis par `svc-planification`
 * via l'outbox, publiés sur NATS JetStream (stream `PLANIFICATION`, sujets
 * `planification.>`). Les consommateurs (Phase 6, `svc-tarification`) y apprennent
 * qu'un contrat est créé ou qu'un planning mensuel a changé.
 */

/** Service émetteur (champ `source` de l'enveloppe). */
export const PLANIFICATION_EVENT_SOURCE = 'svc-planification';

/**
 * Modes de garde couverts par un contrat de garde — ré-export de compatibilité
 * de la définition unique (SFD 30 §H4, `@creche-planner/contracts-kernel`).
 */
export { MODES_CONTRAT };
export type { ModeContrat };

// --- planification.ContratCree.v1 -------------------------------------------

/** Nom métier versionné (champ `type` de l'enveloppe). */
export const CONTRAT_CREE_TYPE = 'planification.ContratCree.v1';

export const contratCreePayloadSchema = z.object({
  contratId: z.string().uuid(),
  foyerId: z.string().uuid(),
  /** Prénom de l'enfant concerné par le contrat (ex. "Mia"/"Zoé"). */
  enfant: z.string().min(1),
  /**
   * Identifiant de l'enfant (agrégat `svc-foyer`) rattaché au contrat, ou `null`
   * pour un contrat historique pas encore rapproché (colonne `contrat.enfant_id`
   * NULLABLE jusqu'au back-fill). Champ **additif et OPTIONNEL** dans la v1 (même
   * évolution non rupteur que `etablissementId` en P2) : les consommateurs qui
   * l'ignorent (`svc-tarification`, `svc-notifications`) ne sont pas cassés.
   */
  enfantId: z.string().uuid().nullish(),
  /** Mode de garde du contrat. */
  mode: z.enum(MODES_CONTRAT),
  /** Début de validité, ISO `YYYY-MM-DD`. */
  valideDu: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO YYYY-MM-DD attendue'),
  /** Fin de validité, ISO `YYYY-MM-DD`, ou `null` si période ouverte. */
  valideAu: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO YYYY-MM-DD attendue')
    .nullable(),
  /**
   * Établissement d'accueil rattaché au contrat (P2), ou `null` si aucun n'est
   * lié (la colonne `contrat.etablissement_id` est NULLABLE jusqu'à la migration
   * de données P5). Champ **additif et OPTIONNEL** dans la v1 : émis (null/uuid)
   * par `svc-planification` post-P2, mais son absence reste tolérée (rétro-compat,
   * évolution non rupteur) — les consommateurs qui l'ignorent encore
   * (`svc-tarification`, `svc-notifications`) ne sont pas cassés.
   */
  etablissementId: z.string().uuid().nullish(),
  /**
   * Première année d'inscription de l'enfant à l'association ABCM (frais de
   * 1ʳᵉ inscription, doc 02 §4.4). Champ **additif et OPTIONNEL** dans la v1
   * (même évolution non rupteur que `enfantId`/`etablissementId`) ; absent ou
   * `null` ⇒ `false`. Toujours `false` pour un contrat CRECHE_PSU.
   */
  premiereInscription: z.boolean().nullish(),
});
export type ContratCreePayload = z.infer<typeof contratCreePayloadSchema>;

export const contratCreeEventSchema = integrationEventSchema(
  contratCreePayloadSchema,
);
export type ContratCreeEvent = z.infer<typeof contratCreeEventSchema>;

// --- planification.ContratCree.v2 -------------------------------------------

/**
 * Nom métier versionné (champ `type` de l'enveloppe). **v2 additive** (SFD 30,
 * RM-30-06) : payload v1 + `versionId` + `dateEffet` de la **version initiale**
 * du contrat (le contrat de garde est versionné à date d'effet depuis le lot 4).
 * Les consommateurs v1 (projections tarification/notifications) restent valides :
 * les champs ajoutés sont ignorés par leur schéma (strip).
 */
export const CONTRAT_CREE_V2_TYPE = 'planification.ContratCree.v2';

export const contratCreeV2PayloadSchema = contratCreePayloadSchema.extend({
  /** Identifiant de la version initiale (`contrat_version`). */
  versionId: z.string().uuid(),
  /** Date d'effet de la version initiale, ISO `YYYY-MM-DD` (= `valideDu`). */
  dateEffet: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO YYYY-MM-DD attendue'),
});
export type ContratCreeV2Payload = z.infer<typeof contratCreeV2PayloadSchema>;

export const contratCreeV2EventSchema = integrationEventSchema(
  contratCreeV2PayloadSchema,
);
export type ContratCreeV2Event = z.infer<typeof contratCreeV2EventSchema>;

// --- planification.PlanningModifie.v1 ---------------------------------------

/** Nom métier versionné (champ `type` de l'enveloppe). */
export const PLANNING_MODIFIE_TYPE = 'planification.PlanningModifie.v1';

export const planningModifiePayloadSchema = z.object({
  contratId: z.string().uuid(),
  /** Mois concerné, ISO `YYYY-MM`. */
  mois: z.string().regex(/^\d{4}-\d{2}$/, 'mois ISO YYYY-MM attendu'),
  /** `true` si planning simulé, `false` si planning réel. */
  simule: z.boolean(),
});
export type PlanningModifiePayload = z.infer<
  typeof planningModifiePayloadSchema
>;

export const planningModifieEventSchema = integrationEventSchema(
  planningModifiePayloadSchema,
);
export type PlanningModifieEvent = z.infer<typeof planningModifieEventSchema>;

// --- planification.ContratModifie.v1 ----------------------------------------

/** Nom métier versionné (champ `type` de l'enveloppe). */
export const CONTRAT_MODIFIE_TYPE = 'planification.ContratModifie.v1';

export const contratModifiePayloadSchema = z.object({
  contratId: z.string().uuid(),
  foyerId: z.string().uuid(),
  /** Prénom de l'enfant concerné par le contrat (ex. "Mia"/"Zoé"). */
  enfant: z.string().min(1),
  /** Identifiant de l'enfant (`svc-foyer`), optionnel/nullable. Cf. `ContratCree`. */
  enfantId: z.string().uuid().nullish(),
  /** Mode de garde du contrat (peut changer en édition). */
  mode: z.enum(MODES_CONTRAT),
  /** Début de validité, ISO `YYYY-MM-DD`. */
  valideDu: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO YYYY-MM-DD attendue'),
  /** Fin de validité, ISO `YYYY-MM-DD`, ou `null` si période ouverte. */
  valideAu: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO YYYY-MM-DD attendue')
    .nullable(),
  /** Établissement d'accueil rattaché (P2), optionnel/nullable. Cf. `ContratCree`. */
  etablissementId: z.string().uuid().nullish(),
  /**
   * Première année d'inscription à l'association ABCM, optionnel/nullable
   * (absent/`null` ⇒ `false`). Cf. `ContratCree`.
   */
  premiereInscription: z.boolean().nullish(),
});
export type ContratModifiePayload = z.infer<typeof contratModifiePayloadSchema>;

export const contratModifieEventSchema = integrationEventSchema(
  contratModifiePayloadSchema,
);
export type ContratModifieEvent = z.infer<typeof contratModifieEventSchema>;

// --- planification.ContratModifie.v2 ----------------------------------------

/**
 * Nom métier versionné (champ `type` de l'enveloppe). **v2 additive** (SFD 30,
 * RM-30-06) : payload v1 + `versionId` + `dateEffet` de la version **créée ou
 * corrigée** par le geste (avenant, correction). Les gestes chirurgicaux non
 * versionnés (`rattacherEtablissement`/`rattacherEnfant`, projection prénom)
 * continuent d'émettre la v1 — les projections acceptent les deux.
 */
export const CONTRAT_MODIFIE_V2_TYPE = 'planification.ContratModifie.v2';

export const contratModifieV2PayloadSchema = contratModifiePayloadSchema.extend(
  {
    /** Identifiant de la version concernée (`contrat_version`). */
    versionId: z.string().uuid(),
    /** Date d'effet de la version concernée, ISO `YYYY-MM-DD`. */
    dateEffet: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO YYYY-MM-DD attendue'),
  },
);
export type ContratModifieV2Payload = z.infer<
  typeof contratModifieV2PayloadSchema
>;

export const contratModifieV2EventSchema = integrationEventSchema(
  contratModifieV2PayloadSchema,
);
export type ContratModifieV2Event = z.infer<typeof contratModifieV2EventSchema>;

// --- planification.ContratSupprime.v1 ---------------------------------------

/** Nom métier versionné (champ `type` de l'enveloppe). */
export const CONTRAT_SUPPRIME_TYPE = 'planification.ContratSupprime.v1';

export const contratSupprimePayloadSchema = z.object({
  contratId: z.string().uuid(),
});
export type ContratSupprimePayload = z.infer<
  typeof contratSupprimePayloadSchema
>;

export const contratSupprimeEventSchema = integrationEventSchema(
  contratSupprimePayloadSchema,
);
export type ContratSupprimeEvent = z.infer<typeof contratSupprimeEventSchema>;

// --- planification.Etablissement{Cree,Modifie,Supprime}.v1 ------------------

/**
 * État complet d'un **établissement** (entité libre, par foyer — cf.
 * `.claude/plans/etablissements-entite-libre.md`). `EtablissementCree` et
 * `EtablissementModifie` partagent ce payload : le consommateur (`svc-notifications`,
 * P3) projette son read-model sans relire la source. Les coordonnées (adresse,
 * téléphone, contact) restent **internes** à `svc-planification` (affichage) et ne
 * voyagent donc pas dans l'événement — seul le routage des récaps en a besoin.
 */
const etablissementEtatPayloadSchema = z.object({
  etablissementId: z.string().uuid(),
  foyerId: z.string().uuid(),
  /** Nom libre, unique par foyer (ex. « Crèche du centre »). */
  nom: z.string().min(1),
  /** Destinataire des récaps de service ; `null` tant que non renseigné. */
  emailService: z.email().nullable(),
  /** Règle de préavis (union JOURS_OUVRES | JOUR_HEURE) ; `null` si non définie. */
  preavisRegle: preavisRegleSchema.nullable(),
  /** Sous-ensemble des modes proposés par l'établissement (informatif). */
  types: z.array(z.enum(MODES_CONTRAT)),
  /** Établissement actif (un établissement archivé n'est plus notifié). */
  actif: z.boolean(),
});

/** Nom métier versionné (champ `type` de l'enveloppe). */
export const ETABLISSEMENT_CREE_TYPE = 'planification.EtablissementCree.v1';

export const etablissementCreePayloadSchema = etablissementEtatPayloadSchema;
export type EtablissementCreePayload = z.infer<
  typeof etablissementCreePayloadSchema
>;

export const etablissementCreeEventSchema = integrationEventSchema(
  etablissementCreePayloadSchema,
);
export type EtablissementCreeEvent = z.infer<
  typeof etablissementCreeEventSchema
>;

/** Nom métier versionné (champ `type` de l'enveloppe). */
export const ETABLISSEMENT_MODIFIE_TYPE =
  'planification.EtablissementModifie.v1';

export const etablissementModifiePayloadSchema = etablissementEtatPayloadSchema;
export type EtablissementModifiePayload = z.infer<
  typeof etablissementModifiePayloadSchema
>;

export const etablissementModifieEventSchema = integrationEventSchema(
  etablissementModifiePayloadSchema,
);
export type EtablissementModifieEvent = z.infer<
  typeof etablissementModifieEventSchema
>;

/** Nom métier versionné (champ `type` de l'enveloppe). */
export const ETABLISSEMENT_SUPPRIME_TYPE =
  'planification.EtablissementSupprime.v1';

export const etablissementSupprimePayloadSchema = z.object({
  etablissementId: z.string().uuid(),
});
export type EtablissementSupprimePayload = z.infer<
  typeof etablissementSupprimePayloadSchema
>;

export const etablissementSupprimeEventSchema = integrationEventSchema(
  etablissementSupprimePayloadSchema,
);
export type EtablissementSupprimeEvent = z.infer<
  typeof etablissementSupprimeEventSchema
>;

/**
 * **Inventaire** des types d'événement du contexte Planification — donc des sujets
 * NATS du stream `PLANIFICATION`. Même rôle et même porte que
 * `TYPES_EVENEMENTS_FOYER` (`pnpm abonnements`), cf. sa documentation.
 */
export const TYPES_EVENEMENTS_PLANIFICATION: readonly string[] = [
  CONTRAT_CREE_TYPE,
  CONTRAT_CREE_V2_TYPE,
  CONTRAT_MODIFIE_TYPE,
  CONTRAT_MODIFIE_V2_TYPE,
  CONTRAT_SUPPRIME_TYPE,
  PLANNING_MODIFIE_TYPE,
  ETABLISSEMENT_CREE_TYPE,
  ETABLISSEMENT_MODIFIE_TYPE,
  ETABLISSEMENT_SUPPRIME_TYPE,
];
