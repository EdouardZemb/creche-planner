import { TauxEffortInconnuError } from '../core/tarification-error.js';

/**
 * Barème CNAF du **taux d'effort** PSU par nombre d'enfants à charge
 * (doc 02 §3.3). Le taux est un ratio horaire appliqué aux ressources
 * mensuelles (ex. 2 enfants → 0,0516 % → 0.000516).
 *
 * RM-30-04 : le barème n'est plus figé dans le domaine — il est **fourni en
 * paramètres** (map `nbEnfants → taux`), projetée depuis le Référentiel
 * (`referentiel.BaremePsuPublie.v1`). Au-delà du plus grand palier renseigné, le
 * dernier palier s'applique (plafond de taux). INV-02 : tout `nbEnfants` ≥ 1 doit
 * avoir un taux ; sinon `TauxEffortInconnuError`.
 */
export class BaremeEffortPsu {
  /** Plus grand palier `nbEnfants` renseigné dans la map (0 si vide). */
  private readonly maxNiveau: number;

  constructor(
    private readonly tauxParEnfant: Readonly<Record<string, number>>,
  ) {
    const niveaux = Object.keys(tauxParEnfant).map(Number);
    this.maxNiveau = niveaux.length > 0 ? Math.max(...niveaux) : 0;
  }

  /** Taux horaire CNAF pour `nbEnfantsACharge` enfants (doc 02 §3.3). */
  taux(nbEnfantsACharge: number): number {
    if (!Number.isInteger(nbEnfantsACharge) || nbEnfantsACharge < 1) {
      throw new TauxEffortInconnuError(
        `nombre d'enfants à charge hors barème (≥ 1 attendu) : ${nbEnfantsACharge}`,
      );
    }
    // Au-delà du dernier palier connu, le taux plafond s'applique (doc 02 §3.3).
    const niveau = Math.min(nbEnfantsACharge, this.maxNiveau);
    const taux = this.tauxParEnfant[String(niveau)];
    if (taux === undefined) {
      throw new TauxEffortInconnuError(
        `nombre d'enfants à charge hors barème : ${nbEnfantsACharge}`,
      );
    }
    return taux;
  }
}
