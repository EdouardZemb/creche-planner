/**
 * MBT — BVA-01 (Money euros→centimes : BVA arrondi) + BVA-03 (Money.fois : BVA arrondi)
 *        + INV-01 (Money property-based : invariants & round-trip)
 * Critère(s) de couverture : BVA 3 points autour de chaque seuil d'arrondi (x.xx4 / x.xx5 / x.xx6),
 *   cas zéro, classes d'erreur INV-01 (négatif → MontantNegatifError, non-entier de centimes →
 *   MontantNonEntierError) ; facteurs limites de `fois` (0, 0.5, 1, 1.5, 2, fractionnaire, négatif) ;
 *   propriétés : INV-01 (centimes ≥ 0 entier), round-trip depuisCentimes, commutativité/associativité
 *   de plus, plus∘moins = identité, distributivité de fois.
 * Traçabilité doc 17 : BVA-01, BVA-03, INV-01. SUT : money.ts.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Money } from './money.js';
import { MontantNegatifError, MontantNonEntierError } from './domain-error.js';

describe('MBT Money', () => {
  // --- BVA-01 : Money.depuisEuros — arrondi au centime ---------------------
  describe('BVA-01 depuisEuros (BVA arrondi au centime)', () => {
    it.each([
      // [euros, centimes attendus]
      [0, 0], // cas zéro
      // seuil d'arrondi autour de 1,00x €
      [1.004, 100], // x.xx4 → arrondi inférieur
      [1.005, 101], // x.xx5 → arrondi supérieur (round half up)
      [1.006, 101], // x.xx6 → arrondi supérieur
      // seuil d'arrondi autour de 2,34x €
      [2.344, 234],
      [2.345, 235],
      [2.346, 235],
      // seuil d'arrondi autour de 0,00x € (proche de zéro)
      [0.004, 0],
      [0.005, 1],
      [0.006, 1],
      // valeurs métier réelles
      [3.47, 347],
      [6716.92, 671692],
    ])('depuisEuros(%s) → %s centime(s)', (euros, attendu) => {
      expect(Money.depuisEuros(euros).centimes).toBe(attendu);
    });

    it.each([[-0.01], [-1], [-1000.5]])(
      'depuisEuros(%s) lève MontantNegatifError (INV-01)',
      (euros) => {
        expect(() => Money.depuisEuros(euros)).toThrow(MontantNegatifError);
      },
    );
  });

  // --- INV-01 : depuisCentimes — classes valides / invalides ---------------
  describe('INV-01 depuisCentimes (classes d’équivalence + erreurs)', () => {
    it.each([
      [0, 0],
      [1, 1],
      [347, 347],
      [671692, 671692],
    ])('depuisCentimes(%s) accepte un entier ≥ 0', (c, attendu) => {
      expect(Money.depuisCentimes(c).centimes).toBe(attendu);
    });

    it.each([[-1], [-100]])(
      'depuisCentimes(%s) lève MontantNegatifError',
      (c) => {
        expect(() => Money.depuisCentimes(c)).toThrow(MontantNegatifError);
      },
    );

    it.each([[3.5], [0.1], [Number.NaN]])(
      'depuisCentimes(%s) lève MontantNonEntierError',
      (c) => {
        expect(() => Money.depuisCentimes(c)).toThrow(MontantNonEntierError);
      },
    );
  });

  // --- BVA-03 : Money.fois — facteurs limites + arrondi --------------------
  describe('BVA-03 fois (BVA facteur + arrondi au centime)', () => {
    it.each([
      // [centimes base, facteur, centimes attendus]
      [347, 0, 0], // facteur nul
      [347, 0.5, 174], // 173,5 → 174 (round half up)
      [347, 1, 347], // élément neutre
      [347, 1.5, 521], // 520,5 → 521
      [347, 2, 694], // facteur entier > 1
      [1268, 16, 20288], // valeur métier (séances)
      [100, 0.335, 34], // 33,5 → 34 fractionnaire
    ])('depuisCentimes(%s).fois(%s) → %s', (base, facteur, attendu) => {
      expect(Money.depuisCentimes(base).fois(facteur).centimes).toBe(attendu);
    });

    it.each([[-1], [-0.5]])(
      'fois(%s) (facteur négatif) lève MontantNegatifError',
      (facteur) => {
        expect(() => Money.depuisCentimes(347).fois(facteur)).toThrow(
          MontantNegatifError,
        );
      },
    );
  });

  // --- Property-based : invariants & oracles -------------------------------
  describe('property-based (fast-check)', () => {
    it('INV-01 : toute instance via euros valides a centimes entier ≥ 0', () => {
      fc.assert(
        fc.property(
          fc.float({ min: 0, max: 1_000_000, noNaN: true }),
          (euros) => {
            const c = Money.depuisEuros(euros).centimes;
            return Number.isInteger(c) && c >= 0;
          },
        ),
      );
    });

    it('round-trip : depuisCentimes(c).centimes === c (c entier ≥ 0)', () => {
      fc.assert(
        fc.property(fc.nat(), (c) => Money.depuisCentimes(c).centimes === c),
      );
    });

    it('commutativité de plus : a + b == b + a', () => {
      fc.assert(
        fc.property(fc.nat(), fc.nat(), (a, b) => {
          const ab = Money.depuisCentimes(a).plus(Money.depuisCentimes(b));
          const ba = Money.depuisCentimes(b).plus(Money.depuisCentimes(a));
          return ab.egale(ba);
        }),
      );
    });

    it('associativité de plus : (a + b) + c == a + (b + c)', () => {
      fc.assert(
        fc.property(fc.nat(), fc.nat(), fc.nat(), (a, b, c) => {
          const ma = Money.depuisCentimes(a);
          const mb = Money.depuisCentimes(b);
          const mc = Money.depuisCentimes(c);
          return ma
            .plus(mb)
            .plus(mc)
            .egale(ma.plus(mb.plus(mc)));
        }),
      );
    });

    it('plus puis moins est l’identité : (a + b) - b == a', () => {
      fc.assert(
        fc.property(fc.nat(), fc.nat(), (a, b) => {
          const ma = Money.depuisCentimes(a);
          const mb = Money.depuisCentimes(b);
          return ma.plus(mb).moins(mb).egale(ma);
        }),
      );
    });

    it('distributivité de fois sur plus : (a + b)·k == a·k + b·k (k entier)', () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 1_000_000 }),
          fc.nat({ max: 1_000_000 }),
          fc.nat({ max: 1000 }),
          (a, b, k) => {
            const ma = Money.depuisCentimes(a);
            const mb = Money.depuisCentimes(b);
            // k entier : pas d'arrondi, la distributivité est exacte.
            return ma
              .plus(mb)
              .fois(k)
              .egale(ma.fois(k).plus(mb.fois(k)));
          },
        ),
      );
    });
  });
});
