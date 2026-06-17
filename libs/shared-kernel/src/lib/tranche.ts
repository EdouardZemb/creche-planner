import { Money } from './money.js';

/**
 * Tranche de revenu (RFR) du barème ABCM (doc 02 §1, INV-03).
 * Seuils : T1 < 20 000 € ≤ T2 ≤ 50 000 € < T3.
 * Value object à instances canoniques (T1/T2/T3), comparables par référence.
 */
export class Tranche {
  static readonly T1 = new Tranche(1);
  static readonly T2 = new Tranche(2);
  static readonly T3 = new Tranche(3);

  private static readonly SEUIL_T2 = Money.depuisEuros(20000);
  private static readonly SEUIL_T3 = Money.depuisEuros(50000);

  private constructor(readonly niveau: 1 | 2 | 3) {}

  /** Déduit la tranche à partir du revenu fiscal de référence annuel. */
  static depuisRfr(rfr: Money): Tranche {
    if (rfr.estSuperieurA(Tranche.SEUIL_T3)) {
      return Tranche.T3;
    }
    if (rfr.estSuperieurA(Tranche.SEUIL_T2) || rfr.egale(Tranche.SEUIL_T2)) {
      return Tranche.T2;
    }
    return Tranche.T1;
  }

  egale(autre: Tranche): boolean {
    return this.niveau === autre.niveau;
  }

  toString(): string {
    return `Tranche ${this.niveau}`;
  }
}
