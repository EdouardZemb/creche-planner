import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Schémas de validation des **entrées de la gateway** (frontière BFF). La
 * validation métier profonde reste chez le service propriétaire ; ici on vérifie
 * la forme minimale et on relaie. Les erreurs sont rendues au même format que les
 * services amont : `[{ champ, message }]`.
 */

/**
 * Rattachement d'un parent au foyer (frontière BFF). `email` requis ; le reste
 * est une identité douce optionnelle. La validation profonde (unicité, défauts
 * `principal`/`ordre`) reste chez `svc-foyer`.
 */
export const ajouterParentSchema = z.object({
  email: z.email('adresse e-mail invalide'),
  prenom: z.string().min(1).max(200).optional(),
  nom: z.string().min(1).max(200).optional(),
  principal: z.boolean().optional(),
  ordre: z.number().int().min(0).optional(),
});

/**
 * Édition d'un parent (`PUT`) : tous les champs optionnels (upsert partiel) ;
 * `prenom`/`nom` acceptent `null` pour effacer l'identité douce, `actif` réactive
 * un parent retiré (soft-delete).
 */
export const modifierParentSchema = z.object({
  email: z.email('adresse e-mail invalide').optional(),
  prenom: z.string().min(1).max(200).nullable().optional(),
  nom: z.string().min(1).max(200).nullable().optional(),
  principal: z.boolean().optional(),
  ordre: z.number().int().min(0).optional(),
  actif: z.boolean().optional(),
});

/** Création orchestrée d'un foyer + ses enfants + ses parents. */
export const creerDossierFoyerSchema = z.object({
  ressourcesMensuelles: z.number().nonnegative(),
  rfr: z.number().nonnegative(),
  nbEnfantsACharge: z.number().int().min(1),
  nbParts: z.number().positive(),
  enfants: z
    .array(
      z.object({
        prenom: z.string().min(1),
        dateNaissance: z.string().min(1),
      }),
    )
    .default([]),
  parents: z.array(ajouterParentSchema).default([]),
});
export type CreerDossierFoyer = z.infer<typeof creerDossierFoyerSchema>;

/**
 * Création d'un contrat de garde. Champs communs validés ; les champs
 * spécifiques au mode (`semaineType`, `semaineAbcm`, `heuresAnnuelles…`) passent
 * via `passthrough()` et sont validés par `svc-planification`.
 */
export const creerContratSchema = z
  .object({
    mode: z.enum(['CRECHE_PSU', 'CANTINE', 'PERISCOLAIRE', 'ALSH']),
    foyerId: z.string().min(1),
    enfant: z.string().min(1),
    valideDu: z.string().min(1),
    valideAu: z.string().nullable(),
  })
  .passthrough();

/**
 * Modification d'un contrat de garde : mêmes champs communs que la création ; les
 * champs spécifiques au mode passent via `passthrough()` et sont validés en amont.
 */
export const modifierContratSchema = creerContratSchema;

/** Corps d'écriture de planning : relayé tel quel au service propriétaire. */
export const ecrirePlanningSchema = z.object({}).passthrough();

// Semaine ISO `YYYY-Www` (01-53). La validation profonde reste au service.
const SEMAINE_ISO = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
/** Semaine ISO au format `YYYY-Www`. */
export const semaineIsoSchema = z
  .string()
  .regex(SEMAINE_ISO, 'semaine attendue au format YYYY-Www');

/** Heure du jour `HH:MM` (00:00 → 23:59), pour la règle de préavis « jour + heure ». */
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Règle de préavis d'un établissement (union discriminée par `type`) — forme
 * minimale validée à la frontière BFF, la validation profonde reste au service.
 */
export const preavisRegleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('JOURS_OUVRES'),
    valeur: z.number().int().min(0).max(30),
  }),
  z.object({
    type: z.literal('JOUR_HEURE'),
    jour: z.enum([
      'LUNDI',
      'MARDI',
      'MERCREDI',
      'JEUDI',
      'VENDREDI',
      'SAMEDI',
      'DIMANCHE',
    ]),
    heure: z.string().regex(HEURE, 'heure attendue au format HH:MM'),
  }),
]);

/** Modes de garde proposables par un établissement (sous-ensemble informatif). */
const MODES_ETABLISSEMENT = [
  'CRECHE_PSU',
  'PERISCOLAIRE',
  'CANTINE',
  'ALSH',
] as const;

/**
 * Création d'un **établissement** (entité libre par foyer, P2) à la frontière BFF
 * — relayé à `svc-planification` qui fait la validation profonde. Seul `nom` est
 * requis ; le reste est facultatif et peut être `null` (champ vidé). Le `foyerId`
 * voyage dans le chemin (`/foyers/:foyerId/etablissements`), pas dans le corps.
 */
export const creerEtablissementSchema = z.object({
  nom: z.string().min(1).max(200),
  emailService: z.email('adresse e-mail invalide').nullish(),
  preavisRegle: preavisRegleSchema.nullish(),
  types: z.array(z.enum(MODES_ETABLISSEMENT)).optional(),
  adresse: z.string().max(500).nullish(),
  telephone: z.string().max(40).nullish(),
  contact: z.string().max(200).nullish(),
  actif: z.boolean().optional(),
});

/** Édition d'un établissement : tous les champs facultatifs (seuls les fournis changent). */
export const modifierEtablissementSchema = creerEtablissementSchema.partial();

// Mois borné 01-12 (AQ-04, doc 27 : l'ancienne `\d{2}` acceptait « 2026-13 »).
const MOIS = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Mois au format `YYYY-MM`. */
export const moisSchema = z
  .string()
  .regex(MOIS, 'mois attendu au format YYYY-MM');

/**
 * Valide `valeur` contre `schema` ou lève une `BadRequestException` (400) au
 * format `[{ champ, message }]`, homogène avec les services amont.
 */
export function valider<T>(schema: z.ZodType<T>, valeur: unknown): T {
  const resultat = schema.safeParse(valeur);
  if (!resultat.success) {
    throw new BadRequestException(
      resultat.error.issues.map((probleme) => ({
        champ: probleme.path.join('.'),
        message: probleme.message,
      })),
    );
  }
  return resultat.data;
}
