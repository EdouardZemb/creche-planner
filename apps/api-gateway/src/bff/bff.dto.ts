import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Schémas de validation des **entrées de la gateway** (frontière BFF). La
 * validation métier profonde reste chez le service propriétaire ; ici on vérifie
 * la forme minimale et on relaie. Les erreurs sont rendues au même format que les
 * services amont : `[{ champ, message }]`.
 */

/** Création orchestrée d'un foyer + ses enfants. */
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
