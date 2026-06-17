import { CoutMois, LigneDeCout } from '../core/cout-mois.js';
import type { PolitiqueTarifaire } from '../core/politique-tarifaire.js';
import { exigerEntierNonNegatif } from '../core/garde.js';
import type { GrilleAbcm } from './grille-abcm.js';

/** Saisie périscolaire du mois : séances matin et soir réservées (doc 02 §4.2). */
export interface SaisieMoisPeriscolaire {
  nbMatins: number;
  nbSoirs: number;
}

/**
 * Stratégie tarifaire **périscolaire ABCM** (doc 02 §4.2). Coût = Σ séances
 * matin × tarif matin + Σ séances soir × tarif soir, selon la tranche.
 */
export class TarifPeriscolaireAbcm implements PolitiqueTarifaire<SaisieMoisPeriscolaire> {
  readonly mode = 'PERISCOLAIRE' as const;

  constructor(private readonly grille: GrilleAbcm) {}

  calculerCoutMois(saisie: SaisieMoisPeriscolaire): CoutMois {
    exigerEntierNonNegatif(saisie.nbMatins, 'nbMatins');
    exigerEntierNonNegatif(saisie.nbSoirs, 'nbSoirs');
    return new CoutMois([
      LigneDeCout.debit(
        'Périscolaire matin',
        this.grille.periMatin.fois(saisie.nbMatins),
      ),
      LigneDeCout.debit(
        'Périscolaire soir',
        this.grille.periSoir.fois(saisie.nbSoirs),
      ),
    ]);
  }
}
