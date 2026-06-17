import { CoutMois, LigneDeCout } from '../core/cout-mois.js';
import type { PolitiqueTarifaire } from '../core/politique-tarifaire.js';
import { exigerEntierNonNegatif } from '../core/garde.js';
import type { GrilleAbcm } from './grille-abcm.js';

/** Saisie cantine du mois. Règle ABCM : réservé ⇒ facturé (doc 02 §4.4 bis). */
export interface SaisieMoisCantine {
  /** Nombre de jours de cantine réservés (présence indifférente). */
  nbJours: number;
  /** Cas PAI panier-repas : seule la part « garde » est facturée (doc 02 §4.4 bis). */
  pai?: boolean;
}

/**
 * Stratégie tarifaire **cantine ABCM** (doc 02 §4.1). Coût = nombre de jours
 * réservés × tarif de la tranche (TOTAL, ou part « garde » seule en cas de PAI).
 */
export class TarifCantineAbcm implements PolitiqueTarifaire<SaisieMoisCantine> {
  readonly mode = 'CANTINE' as const;

  constructor(private readonly grille: GrilleAbcm) {}

  calculerCoutMois(saisie: SaisieMoisCantine): CoutMois {
    exigerEntierNonNegatif(saisie.nbJours, 'nbJours');
    const pai = saisie.pai ?? false;
    const tarif = pai ? this.grille.cantinePartGarde : this.grille.cantineTotal;
    const libelle = pai ? 'Cantine (PAI — part garde)' : 'Cantine';
    return new CoutMois([
      LigneDeCout.debit(libelle, tarif.fois(saisie.nbJours)),
    ]);
  }
}
