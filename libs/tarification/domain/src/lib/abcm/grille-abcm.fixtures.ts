import type { Tranche } from '@creche-planner/shared-kernel';
import { GrilleAbcm, type ParametresGrilleAbcm } from './grille-abcm.js';

/**
 * **Fixture de specs** (hors chemin de calcul) : la grille ABCM 2026 réelle par
 * tranche (doc 02 §4), en centimes. Les valeurs tarifaires ne vivent plus dans le
 * domaine (RM-30-04) — elles viennent du Référentiel projeté en production ; ce
 * module ne sert qu'à exercer la **formule** (`GrilleAbcm`, stratégies ABCM) en
 * isolation. Non exporté par l'index public : à l'usage exclusif des tests.
 */
const PARAMETRES_2026: Record<1 | 2 | 3, ParametresGrilleAbcm> = {
  1: {
    cantineTotalCentimes: 1050,
    cantinePartGardeCentimes: null,
    periMatinCentimes: 231,
    periSoirCentimes: 501,
    alshJourneeCompleteCentimes: 2350,
    alshDemiJourneeCentimes: 850,
    alshRepasCentimes: 650,
  },
  2: {
    cantineTotalCentimes: 1165,
    cantinePartGardeCentimes: null,
    periMatinCentimes: 287,
    periSoirCentimes: 601,
    alshJourneeCompleteCentimes: 2500,
    alshDemiJourneeCentimes: 900,
    alshRepasCentimes: 700,
  },
  3: {
    cantineTotalCentimes: 1268,
    cantinePartGardeCentimes: 801,
    periMatinCentimes: 333,
    periSoirCentimes: 705,
    alshJourneeCompleteCentimes: 2650,
    alshDemiJourneeCentimes: 950,
    alshRepasCentimes: 750,
  },
};

/** Grille ABCM 2026 de la tranche (fixture de specs). */
export function grilleAbcm2026(tranche: Tranche): GrilleAbcm {
  return GrilleAbcm.depuisParametres(PARAMETRES_2026[tranche.niveau]);
}
