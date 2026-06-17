import { CoutMois, LigneDeCout } from '../core/cout-mois.js';
import type { PolitiqueTarifaire } from '../core/politique-tarifaire.js';
import { exigerEntierNonNegatif } from '../core/garde.js';
import type { GrilleAbcm } from './grille-abcm.js';

/** Saisie ALSH du mois (mercredis / vacances), par unité réservée (doc 02 §4.3). */
export interface SaisieMoisAlsh {
  nbJourneesCompletes: number;
  nbDemiJournees?: number;
  nbRepas?: number;
}

/**
 * Stratégie tarifaire **ALSH ABCM** (doc 02 §4.3). Coût = journées complètes,
 * demi-journées et repas, chacun au tarif de la tranche.
 */
export class TarifAlshAbcm implements PolitiqueTarifaire<SaisieMoisAlsh> {
  readonly mode = 'ALSH' as const;

  constructor(private readonly grille: GrilleAbcm) {}

  calculerCoutMois(saisie: SaisieMoisAlsh): CoutMois {
    const nbDemiJournees = saisie.nbDemiJournees ?? 0;
    const nbRepas = saisie.nbRepas ?? 0;
    exigerEntierNonNegatif(saisie.nbJourneesCompletes, 'nbJourneesCompletes');
    exigerEntierNonNegatif(nbDemiJournees, 'nbDemiJournees');
    exigerEntierNonNegatif(nbRepas, 'nbRepas');
    return new CoutMois([
      LigneDeCout.debit(
        'ALSH journée complète',
        this.grille.alshJourneeComplete.fois(saisie.nbJourneesCompletes),
      ),
      LigneDeCout.debit(
        'ALSH demi-journée',
        this.grille.alshDemiJournee.fois(nbDemiJournees),
      ),
      LigneDeCout.debit('ALSH repas', this.grille.alshRepas.fois(nbRepas)),
    ]);
  }
}
