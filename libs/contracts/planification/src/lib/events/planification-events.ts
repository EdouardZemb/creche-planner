import { z } from 'zod';
import { integrationEventSchema } from '@creche-planner/contracts-kernel';
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

/** Modes de garde couverts par un contrat de garde. */
export const MODES_CONTRAT = [
  'CRECHE_PSU',
  'PERISCOLAIRE',
  'CANTINE',
  'ALSH',
] as const;
/** Mode de garde d'un contrat (type unitaire dérivé de `MODES_CONTRAT`). */
export type ModeContrat = (typeof MODES_CONTRAT)[number];

// --- planification.ContratCree.v1 -------------------------------------------

/** Nom métier versionné (champ `type` de l'enveloppe). */
export const CONTRAT_CREE_TYPE = 'planification.ContratCree.v1';

export const contratCreePayloadSchema = z.object({
  contratId: z.string().uuid(),
  foyerId: z.string().uuid(),
  /** Prénom de l'enfant concerné par le contrat (ex. "Mia"/"Zoé"). */
  enfant: z.string().min(1),
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
});
export type ContratCreePayload = z.infer<typeof contratCreePayloadSchema>;

export const contratCreeEventSchema = integrationEventSchema(
  contratCreePayloadSchema,
);
export type ContratCreeEvent = z.infer<typeof contratCreeEventSchema>;

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
});
export type ContratModifiePayload = z.infer<typeof contratModifiePayloadSchema>;

export const contratModifieEventSchema = integrationEventSchema(
  contratModifiePayloadSchema,
);
export type ContratModifieEvent = z.infer<typeof contratModifieEventSchema>;

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
