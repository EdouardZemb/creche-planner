import { TauxEffortInconnuError } from '../core/tarification-error.js';

/**
 * Barème CNAF du **taux d'effort** PSU par nombre d'enfants à charge
 * (doc 02 §3.3). Le taux est un ratio horaire appliqué aux ressources
 * mensuelles (ex. 2 enfants → 0,0516 % → 0.000516).
 *
 * Donnée du Référentiel à maintenir par année ; figée ici pour 2026 afin que
 * le domaine soit testable en isolation (Phase 2). INV-02 : tout `nbEnfants`
 * ≥ 1 doit avoir un taux ; sinon `TauxEffortInconnuError`.
 */
export class BaremeEffortPsu {
  /** Taux horaire CNAF pour `nbEnfantsACharge` enfants (doc 02 §3.3). */
  taux(nbEnfantsACharge: number): number {
    if (!Number.isInteger(nbEnfantsACharge) || nbEnfantsACharge < 1) {
      throw new TauxEffortInconnuError(
        `nombre d'enfants à charge hors barème (≥ 1 attendu) : ${nbEnfantsACharge}`,
      );
    }
    if (nbEnfantsACharge === 1) {
      return 0.000619;
    }
    if (nbEnfantsACharge === 2) {
      return 0.000516;
    }
    if (nbEnfantsACharge === 3) {
      return 0.000413;
    }
    if (nbEnfantsACharge <= 7) {
      return 0.00031;
    }
    return 0.000206;
  }
}

/** Barème CNAF en vigueur pour l'année 2026 (doc 02 §3.3). */
export const BAREME_EFFORT_PSU_2026 = new BaremeEffortPsu();
