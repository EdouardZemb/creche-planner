import { BaremeEffortPsu } from './bareme-effort-psu.js';

/**
 * **Fixture de specs** (hors chemin de calcul) : le barème CNAF du taux d'effort
 * PSU 2026 (doc 02 §3.3). Les valeurs ne vivent plus dans le domaine (RM-30-04) ;
 * en production elles viennent du Référentiel projeté. À l'usage exclusif des
 * tests, non exporté par l'index public.
 */
const TAUX_EFFORT_PSU_2026: Readonly<Record<string, number>> = {
  '1': 0.000619,
  '2': 0.000516,
  '3': 0.000413,
  '4': 0.00031,
  '5': 0.00031,
  '6': 0.00031,
  '7': 0.00031,
  '8': 0.000206,
};

/** Barème d'effort PSU 2026 (fixture de specs). */
export function baremeEffortPsu2026(): BaremeEffortPsu {
  return new BaremeEffortPsu(TAUX_EFFORT_PSU_2026);
}
