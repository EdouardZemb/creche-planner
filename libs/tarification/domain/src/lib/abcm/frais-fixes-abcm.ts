import { Money } from '@creche-planner/shared-kernel';
import { CoutMois, LigneDeCout } from '../core/cout-mois.js';
import type { PolitiqueTarifaire } from '../core/politique-tarifaire.js';
import { QuantiteInvalideError } from '../core/tarification-error.js';

/** Mois où les frais fixes annuels ABCM sont rattachés : septembre (doc 02 §4.4). */
const MOIS_RATTACHEMENT = 9;

/** Configuration des frais fixes annuels ABCM (doc 02 §4.4). */
export interface ConfigFraisFixesAbcm {
  /** Cotisation annuelle (1 enfant inscrit). Défaut : 286 €. */
  cotisationAnnuelle?: Money;
  /** Frais de 1ère inscription (1ère année uniquement). Défaut : 150 €. */
  fraisPremiereInscription?: Money;
}

/** Saisie : mois calendaire (1–12) et si l'on est dans la 1ère année ABCM. */
export interface SaisieMoisFraisFixes {
  mois: number;
  premiereAnnee: boolean;
}

/**
 * Stratégie **frais fixes annuels ABCM** (doc 02 §4.4). La cotisation est
 * rattachée en totalité à septembre ; les frais de 1ère inscription ne
 * s'ajoutent que la 1ère année (septembre 2026). Tout autre mois → 0 €.
 */
export class FraisFixesAbcm implements PolitiqueTarifaire<SaisieMoisFraisFixes> {
  readonly mode = 'FRAIS_FIXES_ABCM' as const;

  private readonly cotisationAnnuelle: Money;
  private readonly fraisPremiereInscription: Money;

  constructor(config: ConfigFraisFixesAbcm = {}) {
    this.cotisationAnnuelle =
      config.cotisationAnnuelle ?? Money.depuisEuros(286);
    this.fraisPremiereInscription =
      config.fraisPremiereInscription ?? Money.depuisEuros(150);
  }

  calculerCoutMois(saisie: SaisieMoisFraisFixes): CoutMois {
    if (!Number.isInteger(saisie.mois) || saisie.mois < 1 || saisie.mois > 12) {
      throw new QuantiteInvalideError(
        `mois calendaire hors plage 1–12 (reçu : ${saisie.mois})`,
      );
    }
    if (saisie.mois !== MOIS_RATTACHEMENT) {
      return new CoutMois([]);
    }
    const lignes: LigneDeCout[] = [
      LigneDeCout.debit('Cotisation annuelle ABCM', this.cotisationAnnuelle),
    ];
    if (saisie.premiereAnnee) {
      lignes.push(
        LigneDeCout.debit(
          'Frais de 1ère inscription',
          this.fraisPremiereInscription,
        ),
      );
    }
    return new CoutMois(lignes);
  }
}
