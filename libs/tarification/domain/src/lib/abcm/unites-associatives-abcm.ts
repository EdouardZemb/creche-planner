import { Money } from '@creche-planner/shared-kernel';
import { CoutMois, LigneDeCout } from '../core/cout-mois.js';
import type { PolitiqueTarifaire } from '../core/politique-tarifaire.js';
import { exigerNombreNonNegatif } from '../core/garde.js';

/** Configuration des Unités Associatives ABCM (doc 02 §4.5). */
export interface ConfigUnitesAssociatives {
  /** Quota d'heures de bénévolat à réaliser par an. Défaut : 20 h. */
  quotaHeures?: number;
  /** Valeur d'une UA non réalisée. Défaut : 31,25 €. */
  valeurUa?: Money;
}

/** Saisie : heures de bénévolat effectivement réalisées sur la période. */
export interface SaisieUnitesAssociatives {
  heuresRealisees: number;
}

/**
 * Stratégie **Unités Associatives ABCM** (doc 02 §4.5) — coût *conditionnel*
 * et pilotable : coût = max(0, quota − heures réalisées) × valeur de l'UA.
 * Quota atteint ⇒ 0 € (caution rendue). Rattaché à la fin de période (mai).
 */
export class UnitesAssociativesAbcm implements PolitiqueTarifaire<SaisieUnitesAssociatives> {
  readonly mode = 'UNITES_ASSOCIATIVES' as const;

  private readonly quotaHeures: number;
  private readonly valeurUa: Money;

  constructor(config: ConfigUnitesAssociatives = {}) {
    this.quotaHeures = config.quotaHeures ?? 20;
    this.valeurUa = config.valeurUa ?? Money.depuisEuros(31.25);
  }

  calculerCoutMois(saisie: SaisieUnitesAssociatives): CoutMois {
    exigerNombreNonNegatif(saisie.heuresRealisees, 'heuresRealisees');
    const heuresManquantes = Math.max(
      0,
      this.quotaHeures - saisie.heuresRealisees,
    );
    if (heuresManquantes === 0) {
      return new CoutMois([]);
    }
    return new CoutMois([
      LigneDeCout.debit(
        'UA non réalisées',
        this.valeurUa.fois(heuresManquantes),
      ),
    ]);
  }
}
