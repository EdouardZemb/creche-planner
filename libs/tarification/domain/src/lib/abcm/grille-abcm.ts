import { Money, Tranche } from '@creche-planner/shared-kernel';
import { GrilleIndisponibleError } from '../core/tarification-error.js';

/** Tarifs ABCM d'une tranche RFR (doc 02 §4, Maternelle Mulhouse, au 01/01/2026). */
interface DonneesGrilleAbcm {
  /** Cantine — TOTAL repas + encadrement, par jour (doc 02 §4.1). */
  cantineTotal: Money;
  /**
   * Cantine — part « garde » seule (cas PAI panier-repas, doc 02 §4.4 bis).
   * Connue uniquement pour la T3 Maternelle Mulhouse (8,01 €) ; absente sinon.
   */
  cantinePartGarde?: Money;
  /** Périscolaire — séance du matin (doc 02 §4.2). */
  periMatin: Money;
  /** Périscolaire — séance du soir, 2 h (doc 02 §4.2). */
  periSoir: Money;
  /** ALSH — journée complète (doc 02 §4.3). */
  alshJourneeComplete: Money;
  /** ALSH — demi-journée (doc 02 §4.3). */
  alshDemiJournee: Money;
  /** ALSH — repas (doc 02 §4.3). */
  alshRepas: Money;
}

/**
 * Grille ABCM versionnée 2026 par tranche (doc 02 §4). Donnée du Référentiel,
 * figée ici pour tester le domaine en isolation (Phase 2).
 */
const GRILLE_ABCM_2026: Record<1 | 2 | 3, DonneesGrilleAbcm> = {
  1: {
    cantineTotal: Money.depuisEuros(10.5),
    periMatin: Money.depuisEuros(2.31),
    periSoir: Money.depuisEuros(5.01),
    alshJourneeComplete: Money.depuisEuros(23.5),
    alshDemiJournee: Money.depuisEuros(8.5),
    alshRepas: Money.depuisEuros(6.5),
  },
  2: {
    cantineTotal: Money.depuisEuros(11.65),
    periMatin: Money.depuisEuros(2.87),
    periSoir: Money.depuisEuros(6.01),
    alshJourneeComplete: Money.depuisEuros(25.0),
    alshDemiJournee: Money.depuisEuros(9.0),
    alshRepas: Money.depuisEuros(7.0),
  },
  3: {
    cantineTotal: Money.depuisEuros(12.68),
    cantinePartGarde: Money.depuisEuros(8.01),
    periMatin: Money.depuisEuros(3.33),
    periSoir: Money.depuisEuros(7.05),
    alshJourneeComplete: Money.depuisEuros(26.5),
    alshDemiJournee: Money.depuisEuros(9.5),
    alshRepas: Money.depuisEuros(7.5),
  },
};

/**
 * Grille tarifaire ABCM applicable à une tranche RFR (INV-03). Façade lecture
 * seule sur les barèmes versionnés ; ne fait aucun calcul de quantité.
 */
export class GrilleAbcm {
  private constructor(private readonly donnees: DonneesGrilleAbcm) {}

  /** Grille ABCM 2026 pour la tranche donnée (doc 02 §4). */
  static pour(tranche: Tranche): GrilleAbcm {
    return new GrilleAbcm(GRILLE_ABCM_2026[tranche.niveau]);
  }

  get cantineTotal(): Money {
    return this.donnees.cantineTotal;
  }

  /** Part « garde » de la cantine (PAI). Lève si la tranche ne la définit pas. */
  get cantinePartGarde(): Money {
    if (this.donnees.cantinePartGarde === undefined) {
      throw new GrilleIndisponibleError(
        'part « garde » cantine (PAI) non définie pour cette tranche',
      );
    }
    return this.donnees.cantinePartGarde;
  }

  get periMatin(): Money {
    return this.donnees.periMatin;
  }

  get periSoir(): Money {
    return this.donnees.periSoir;
  }

  get alshJourneeComplete(): Money {
    return this.donnees.alshJourneeComplete;
  }

  get alshDemiJournee(): Money {
    return this.donnees.alshDemiJournee;
  }

  get alshRepas(): Money {
    return this.donnees.alshRepas;
  }
}
