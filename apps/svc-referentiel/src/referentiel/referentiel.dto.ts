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
