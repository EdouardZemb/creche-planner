/**
 * MBT — BVA-02 (Duree.entre : BVA autour de l'égalité début/fin)
 *        + INV-01 (Duree property-based : invariants & oracles)
 * Critère(s) de couverture : BVA 3 points autour de la contrainte « fin > début STRICT »
 *   ((début, début) → erreur, (début, début-1) → erreur, (début, début+1) → ok) ;
 *   classes d'erreur INV-01 (minutes négatives / non entières → DureeInvalideError) ;
 *   propriétés : INV-01 (minutes ≥ 0 entier), round-trip depuisMinutes, commutativité de plus,
 *   plus∘moins = identité sous contrainte, cohérence depuisHeuresMinutes.
 * Traçabilité doc 17 : BVA-02, INV-01. SUT : duree.ts.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Duree } from './duree.js';
import {
  DureeInvalideError,
  PlageHoraireInvalideError,
} from './domain-error.js';

describe('MBT Duree', () => {
  // --- BVA-02 : Duree.entre — frontière « fin > début STRICT » -------------
  describe('BVA-02 entre (BVA autour de l’égalité début/fin)', () => {
    const debut = 540; // 09 h 00

    it.each([
      // [début, fin, minutes attendues]
      [debut, debut + 1, 1], // fin = début + 1 → ok (premier point valide)
      [debut, debut + 60, 60], // plage nominale
      [0, 1, 1], // borne basse (minuit + 1 min)
    ])('entre(%s, %s) → %s minute(s)', (d, f, attendu) => {
      expect(Duree.entre(d, f).enMinutes).toBe(attendu);
    });

    it.each([
      // [début, fin] invalides : fin ≤ début
      [debut, debut], // égalité → erreur
      [debut, debut - 1], // fin = début - 1 → erreur
      [600, 540], // fin franchement antérieure → erreur
    ])('entre(%s, %s) lève PlageHoraireInvalideError', (d, f) => {
      expect(() => Duree.entre(d, f)).toThrow(PlageHoraireInvalideError);
    });
  });

  // --- INV-01 : depuisMinutes — classes valides / invalides ----------------
  describe('INV-01 depuisMinutes (classes d’équivalence + erreurs)', () => {
    it.each([
      [0, 0],
      [1, 1],
      [540, 540],
    ])('depuisMinutes(%s) accepte un entier ≥ 0', (m, attendu) => {
      expect(Duree.depuisMinutes(m).enMinutes).toBe(attendu);
    });

    it.each([[-1], [-60]])(
      'depuisMinutes(%s) lève DureeInvalideError (négatif)',
      (m) => {
        expect(() => Duree.depuisMinutes(m)).toThrow(DureeInvalideError);
      },
    );

    it.each([[1.5], [0.1], [Number.NaN]])(
      'depuisMinutes(%s) lève DureeInvalideError (non entier)',
      (m) => {
        expect(() => Duree.depuisMinutes(m)).toThrow(DureeInvalideError);
      },
    );
  });

  // --- Property-based : invariants & oracles -------------------------------
  describe('property-based (fast-check)', () => {
    it('INV-01 : toute durée construite a minutes entier ≥ 0', () => {
      fc.assert(
        fc.property(fc.nat(), (m) => {
          const v = Duree.depuisMinutes(m).enMinutes;
          return Number.isInteger(v) && v >= 0;
        }),
      );
    });

    it('round-trip : depuisMinutes(m).enMinutes === m (m entier ≥ 0)', () => {
      fc.assert(
        fc.property(fc.nat(), (m) => Duree.depuisMinutes(m).enMinutes === m),
      );
    });

    it('commutativité de plus : a + b == b + a', () => {
      fc.assert(
        fc.property(fc.nat(), fc.nat(), (a, b) => {
          const ab = Duree.depuisMinutes(a).plus(Duree.depuisMinutes(b));
          const ba = Duree.depuisMinutes(b).plus(Duree.depuisMinutes(a));
          return ab.egale(ba);
        }),
      );
    });

    it('plus puis moins est l’identité : (a + b) - b == a', () => {
      fc.assert(
        fc.property(fc.nat(), fc.nat(), (a, b) => {
          const da = Duree.depuisMinutes(a);
          const db = Duree.depuisMinutes(b);
          return da.plus(db).moins(db).egale(da);
        }),
      );
    });

    it('cohérence depuisHeuresMinutes : h·60 + m == enMinutes', () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 24 }),
          fc.nat({ max: 59 }),
          (h, m) => Duree.depuisHeuresMinutes(h, m).enMinutes === h * 60 + m,
        ),
      );
    });

    it('entre(d, f) == f - d pour f > d (oracle)', () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 1440 }),
          fc.integer({ min: 1, max: 1440 }),
          (d, delta) => Duree.entre(d, d + delta).enMinutes === delta,
        ),
      );
    });
  });
});
