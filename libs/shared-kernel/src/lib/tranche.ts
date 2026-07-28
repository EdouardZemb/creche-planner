import { BaremeTranchesInvalideError } from './domain-error.js';
import { Money } from './money.js';

/**
 * Un seuil du barème de tranches : `niveau` (1/2/3…) et `rfrMaxCentimes`, la borne
 * **haute inclusive** de RFR (en centimes) au-delà de laquelle on passe à la tranche
 * suivante. `null` = pas de borne haute (dernière tranche, ouverte vers le haut).
 */
export interface SeuilTranche {
  readonly niveau: number;
  readonly rfrMaxCentimes: number | null;
}

/**
 * Barème de tranches RFR ABCM : liste **ordonnée** de seuils, du plus bas au plus
 * haut niveau (SFD 30, DV-03). Les valeurs (20 000/50 000 €…) ne vivent plus dans le
 * code : elles sont versionnées par le Référentiel et transportées jusqu'ici.
 */
export type BaremeTranches = readonly SeuilTranche[];

/**
 * Tranche de revenu (RFR) du barème ABCM (doc 02 §1, INV-03).
 * Value object à instances canoniques (T1/T2/T3), comparables par référence.
 *
 * Les **seuils** ne sont plus figés dans ce value object (SFD 30, DV-03) : la
 * classification passe désormais par un {@link BaremeTranches} versionné, résolu à
 * la date du fait par le service appelant.
 */
export class Tranche {
  static readonly T1 = new Tranche(1);
  static readonly T2 = new Tranche(2);
  static readonly T3 = new Tranche(3);

  /** Instances canoniques par niveau (une tranche = une seule instance). */
  private static readonly CANONIQUES: ReadonlyMap<number, Tranche> = new Map([
    [1, Tranche.T1],
    [2, Tranche.T2],
    [3, Tranche.T3],
  ]);

  private constructor(readonly niveau: 1 | 2 | 3) {}

  /**
   * Instance canonique d'un niveau (1/2/3). Lève `BaremeTranchesInvalideError` si le
   * niveau n'est pas connu — un barème ne peut désigner que des tranches existantes.
   */
  static depuisNiveau(niveau: number): Tranche {
    const tranche = Tranche.CANONIQUES.get(niveau);
    if (tranche === undefined) {
      throw new BaremeTranchesInvalideError(
        `niveau de tranche inconnu : ${niveau} (1, 2 ou 3 attendu)`,
      );
    }
    return tranche;
  }

  /**
   * Déduit la tranche à partir du revenu fiscal de référence annuel et d'un barème
   * versionné : on retient le **premier** seuil (ordre croissant) dont la borne haute
   * couvre le RFR (`rfrMaxCentimes === null` = tranche ouverte). Un barème sans
   * tranche applicable (mal formé, sans borne ouverte finale) lève
   * `BaremeTranchesInvalideError`.
   */
  static depuisRfr(rfr: Money, bareme: BaremeTranches): Tranche {
    for (const seuil of bareme) {
      if (
        seuil.rfrMaxCentimes === null ||
        rfr.centimes <= seuil.rfrMaxCentimes
      ) {
        return Tranche.depuisNiveau(seuil.niveau);
      }
    }
    throw new BaremeTranchesInvalideError(
      `barème sans tranche applicable pour un RFR de ${rfr.centimes} centime(s)`,
    );
  }

  egale(autre: Tranche): boolean {
    return this.niveau === autre.niveau;
  }

  toString(): string {
    return `Tranche ${this.niveau}`;
  }
}
