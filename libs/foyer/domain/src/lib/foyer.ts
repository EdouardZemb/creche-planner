import { Money, Tranche } from '@creche-planner/shared-kernel';
import { Enfant } from './enfant.js';
import {
  EnfantsAChargeInvalideError,
  NombreDePartsInvalideError,
} from './foyer-error.js';

/** Saisie brute d'un foyer avant validation. */
export interface SaisieFoyer {
  readonly ressourcesMensuelles: Money;
  readonly rfr: Money;
  readonly nbEnfantsACharge: number;
  readonly nbParts: number;
  readonly enfants?: readonly Enfant[];
}

/**
 * Agrégat Foyer (doc 02 §0/§1) : composition (enfants) + données financières
 * (ressources CNAF, RFR, nb d'enfants à charge, nb de parts). Immuable — chaque
 * évolution (ajout d'enfant, réactualisation du RFR) renvoie un nouveau Foyer.
 *
 * `ressourcesMensuelles` et `rfr` s'appuient sur `Money` (≥ 0 garanti par le
 * value object) ; la tranche ABCM est **dérivée** du RFR, jamais stockée.
 */
export class Foyer {
  private constructor(
    readonly ressourcesMensuelles: Money,
    readonly rfr: Money,
    readonly nbEnfantsACharge: number,
    readonly nbParts: number,
    readonly enfants: readonly Enfant[],
  ) {}

  static creer(saisie: SaisieFoyer): Foyer {
    if (
      !Number.isInteger(saisie.nbEnfantsACharge) ||
      saisie.nbEnfantsACharge < 1
    ) {
      throw new EnfantsAChargeInvalideError(
        `nombre d'enfants à charge invalide : ${saisie.nbEnfantsACharge} (entier ≥ 1 attendu)`,
      );
    }
    if (!Number.isFinite(saisie.nbParts) || saisie.nbParts <= 0) {
      throw new NombreDePartsInvalideError(
        `nombre de parts invalide : ${saisie.nbParts} (> 0 attendu)`,
      );
    }
    return new Foyer(
      saisie.ressourcesMensuelles,
      saisie.rfr,
      saisie.nbEnfantsACharge,
      saisie.nbParts,
      saisie.enfants ? [...saisie.enfants] : [],
    );
  }

  /** Tranche RFR ABCM déduite du revenu fiscal de référence (doc 02 §0, INV-03). */
  get tranche(): Tranche {
    return Tranche.depuisRfr(this.rfr);
  }

  /** Rattache un enfant → nouveau Foyer (l'original n'est pas muté). */
  ajouterEnfant(enfant: Enfant): Foyer {
    return new Foyer(
      this.ressourcesMensuelles,
      this.rfr,
      this.nbEnfantsACharge,
      this.nbParts,
      [...this.enfants, enfant],
    );
  }

  /** Réactualise le RFR (avis d'imposition annuel, Q-05) → nouveau Foyer, tranche recalculée. */
  actualiserRfr(rfr: Money): Foyer {
    return new Foyer(
      this.ressourcesMensuelles,
      rfr,
      this.nbEnfantsACharge,
      this.nbParts,
      this.enfants,
    );
  }
}
