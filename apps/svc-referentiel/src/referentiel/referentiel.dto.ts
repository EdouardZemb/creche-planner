import { z } from 'zod';

/**
 * Publication d'une grille ABCM versionnée (montants saisis en **euros**). La
 * cohérence de période et de tranche est revalidée par le domaine côté service.
 * Dates : `z.iso.date()` valide le calendrier réel (AQ-04 — `2026-02-30` rejeté).
 *
 * Ce schéma n'est plus branché sur un pipe HTTP (l'écriture `POST /grilles/abcm`
 * a été retirée) : il est appliqué en tête de `ReferentielService.publierGrilleAbcm`,
 * si bien que les grilles seedées au boot sont validées de la même façon.
 */
export const publierGrilleAbcmSchema = z.object({
  tranche: z.number().int(),
  valideDu: z.iso.date('date ISO YYYY-MM-DD attendue'),
  valideAu: z.iso.date('date ISO YYYY-MM-DD attendue').nullable().optional(),
  cantineTotal: z.number().nonnegative(),
  cantinePartGarde: z.number().nonnegative().optional(),
  periMatin: z.number().nonnegative(),
  periSoir: z.number().nonnegative(),
  alshJourneeComplete: z.number().nonnegative(),
  alshDemiJournee: z.number().nonnegative(),
  alshRepas: z.number().nonnegative(),
});
export type PublierGrilleAbcmDto = z.infer<typeof publierGrilleAbcmSchema>;

/**
 * Une **ligne de tranche** d'une grille saisie à l'écran (SFD 30, lot 6) : les
 * postes tarifaires d'un niveau de tranche, montants en **euros**. Reprend les
 * champs de `publierGrilleAbcmSchema` sans les bornes de période (portées une
 * seule fois par la grille entière).
 */
export const trancheGrilleSchema = z.object({
  tranche: z.number().int(),
  cantineTotal: z.number().nonnegative(),
  cantinePartGarde: z.number().nonnegative().optional(),
  periMatin: z.number().nonnegative(),
  periSoir: z.number().nonnegative(),
  alshJourneeComplete: z.number().nonnegative(),
  alshDemiJournee: z.number().nonnegative(),
  alshRepas: z.number().nonnegative(),
});

/**
 * Publication d'une **grille complète** (SFD 30, US-30-02, lot 6) : une période de
 * validité + une ligne par tranche (montants en euros). Publiée **atomiquement**
 * par `ReferentielService.publierGrille` — une période chevauchant une grille
 * existante (de la même tranche) est refusée sans **aucune** écriture partielle.
 */
export const publierGrilleSchema = z.object({
  valideDu: z.iso.date('date ISO YYYY-MM-DD attendue'),
  valideAu: z.iso.date('date ISO YYYY-MM-DD attendue').nullable().optional(),
  tranches: z.array(trancheGrilleSchema).min(1),
});
export type PublierGrilleDto = z.infer<typeof publierGrilleSchema>;

/**
 * Publication d'un barème PSU versionné (SFD 30, D2). `taux` = map
 * `nbEnfantsACharge` (chaîne) → taux horaire CNAF. Bornes (plancher/plafond)
 * saisies en **euros**, converties en centimes côté service. Validé en tête de
 * `ReferentielService.publierBaremePsu` (couvre aussi le barème seedé au boot).
 */
export const publierBaremePsuSchema = z.object({
  valideDu: z.iso.date('date ISO YYYY-MM-DD attendue'),
  valideAu: z.iso.date('date ISO YYYY-MM-DD attendue').nullable().optional(),
  taux: z.record(z.string(), z.number().nonnegative()),
  plancher: z.number().nonnegative().optional(),
  plafond: z.number().nonnegative().optional(),
});
export type PublierBaremePsuDto = z.infer<typeof publierBaremePsuSchema>;

/**
 * Publication d'un barème de **seuils de tranche RFR** versionné (SFD 30, DV-03).
 * `seuils` = liste ordonnée `[{niveau, rfrMax|null}]`, la borne haute **inclusive**
 * de chaque tranche saisie en **euros** (convertie en centimes côté service) ;
 * `null` = tranche ouverte. Validé en tête de `ReferentielService.publierBaremeTranches`.
 */
export const publierBaremeTranchesSchema = z.object({
  valideDu: z.iso.date('date ISO YYYY-MM-DD attendue'),
  valideAu: z.iso.date('date ISO YYYY-MM-DD attendue').nullable().optional(),
  seuils: z
    .array(
      z.object({
        niveau: z.number().int().positive(),
        rfrMax: z.number().nonnegative().nullable(),
      }),
    )
    .min(1),
});
export type PublierBaremeTranchesDto = z.infer<
  typeof publierBaremeTranchesSchema
>;
