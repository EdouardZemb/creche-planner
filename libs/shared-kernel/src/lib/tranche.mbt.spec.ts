/**
 * MBT — DT-01 (Tranche.depuisRfr : arbre de classification + BVA aux bornes)
 *        + monotonie (Tranche property-based)
 * Critère(s) de couverture : toutes les partitions RFR (T1 < 20 000 ; 20 000 ≤ T2 ≤ 50 000 ;
 *   T3 > 50 000) ; BVA 3 points à CHAQUE borne (19999,99 / 20000,00 / 20000,01 et
 *   49999,99 / 50000,00 / 50000,01) ; propriété de monotonie : rfr1 ≤ rfr2 ⇒ niveau(T1) ≤ niveau(T2).
 * Traçabilité doc 17 : DT-01. SUT : tranche.ts (dépend de money.ts).
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Money } from './money.js';
import { Tranche } from './tranche.js';

describe('MBT Tranche', () => {
  // --- DT-01 : arbre de classification depuisRfr + BVA aux bornes ----------
  describe('DT-01 depuisRfr (arbre de classification + BVA 3 points)', () => {
    it.each([
      // [rfr en euros, tranche attendue, commentaire]
      // Partition T1 : RFR < 20 000 €
      [0, Tranche.T1], // borne basse extrême
      [19999.99, Tranche.T1], // BVA borne T1/T2 : juste sous le seuil
      // Borne T2 inférieure : 20 000 € inclus dans T2
      [20000.0, Tranche.T2], // BVA : seuil exact → T2 (≥ 20 000)
      [20000.01, Tranche.T2], // BVA : juste au-dessus
      // Partition T2 : 20 000 € ≤ RFR ≤ 50 000 €
      [35000, Tranche.T2], // milieu de partition
      [49999.99, Tranche.T2], // BVA borne T2/T3 : juste sous le seuil
      // Borne T3 : 50 000 € inclus dans T2 (T3 strictement > 50 000)
      [50000.0, Tranche.T2], // BVA : seuil exact → T2 (pas strictement > 50 000)
      [50000.01, Tranche.T3], // BVA : juste au-dessus → T3
      [1000000, Tranche.T3], // borne haute extrême
    ])('depuisRfr(%s €) → %s', (rfrEuros, attendue) => {
      expect(
        Tranche.depuisRfr(Money.depuisEuros(rfrEuros)).egale(attendue),
      ).toBe(true);
    });
  });

  // --- Property-based : monotonie -----------------------------------------
  describe('property-based (fast-check)', () => {
    it('monotonie : rfr1 ≤ rfr2 ⇒ niveau(tranche1) ≤ niveau(tranche2)', () => {
      fc.assert(
        fc.property(fc.nat(), fc.nat(), (c1, c2) => {
          const [petit, grand] = c1 <= c2 ? [c1, c2] : [c2, c1];
          const t1 = Tranche.depuisRfr(Money.depuisCentimes(petit));
          const t2 = Tranche.depuisRfr(Money.depuisCentimes(grand));
          return t1.niveau <= t2.niveau;
        }),
      );
    });

    it('totalité : depuisRfr renvoie toujours une des trois tranches canoniques', () => {
      fc.assert(
        fc.property(fc.nat(), (c) => {
          const t = Tranche.depuisRfr(Money.depuisCentimes(c));
          return t === Tranche.T1 || t === Tranche.T2 || t === Tranche.T3;
        }),
      );
    });
  });
});
