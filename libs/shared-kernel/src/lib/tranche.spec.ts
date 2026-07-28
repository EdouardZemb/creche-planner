import { describe, expect, it } from 'vitest';
import { BaremeTranchesInvalideError } from './domain-error.js';
import { Money } from './money.js';
import { Tranche, type BaremeTranches } from './tranche.js';

/**
 * Barème de référence (mêmes seuils métier que l'ancien code : T1 < 20 000 €,
 * 20 000 ≤ T2 ≤ 50 000 €, T3 > 50 000 €), exprimé en bornes hautes **inclusives** en
 * centimes. T1 s'arrête à 19 999,99 € (la borne basse de T2 = 20 000 € appartient à
 * T2) ; T2 s'arrête à 50 000 € inclus ; T3 est ouverte.
 */
const BAREME: BaremeTranches = [
  { niveau: 1, rfrMaxCentimes: 1999999 },
  { niveau: 2, rfrMaxCentimes: 5000000 },
  { niveau: 3, rfrMaxCentimes: null },
];

describe('Tranche (classe de revenu RFR, ABCM)', () => {
  describe('déduction depuis le RFR (barème versionné)', () => {
    it('classe en T1 un RFR strictement inférieur à 20 000 €', () => {
      expect(Tranche.depuisRfr(Money.depuisEuros(19999.99), BAREME)).toBe(
        Tranche.T1,
      );
    });

    it('classe en T2 un RFR à la borne basse (20 000 €)', () => {
      expect(Tranche.depuisRfr(Money.depuisEuros(20000), BAREME)).toBe(
        Tranche.T2,
      );
    });

    it('classe en T2 un RFR à la borne haute (50 000 €)', () => {
      expect(Tranche.depuisRfr(Money.depuisEuros(50000), BAREME)).toBe(
        Tranche.T2,
      );
    });

    it('classe en T3 un RFR strictement supérieur à 50 000 €', () => {
      expect(Tranche.depuisRfr(Money.depuisEuros(50000.01), BAREME)).toBe(
        Tranche.T3,
      );
    });

    it('classe le RFR réel du foyer (72 705 €) en T3', () => {
      expect(Tranche.depuisRfr(Money.depuisEuros(72705), BAREME)).toBe(
        Tranche.T3,
      );
    });

    it('lève si aucune tranche n’est applicable (barème sans borne ouverte)', () => {
      const baremeMalForme: BaremeTranches = [
        { niveau: 1, rfrMaxCentimes: 100 },
      ];
      expect(() =>
        Tranche.depuisRfr(Money.depuisCentimes(200), baremeMalForme),
      ).toThrow(BaremeTranchesInvalideError);
    });
  });

  describe('depuisNiveau', () => {
    it('renvoie l’instance canonique du niveau', () => {
      expect(Tranche.depuisNiveau(1)).toBe(Tranche.T1);
      expect(Tranche.depuisNiveau(2)).toBe(Tranche.T2);
      expect(Tranche.depuisNiveau(3)).toBe(Tranche.T3);
    });

    it('lève pour un niveau inconnu', () => {
      expect(() => Tranche.depuisNiveau(0)).toThrow(
        BaremeTranchesInvalideError,
      );
      expect(() => Tranche.depuisNiveau(4)).toThrow(
        BaremeTranchesInvalideError,
      );
    });
  });

  describe('propriétés', () => {
    it('expose un niveau 1/2/3', () => {
      expect(Tranche.T1.niveau).toBe(1);
      expect(Tranche.T2.niveau).toBe(2);
      expect(Tranche.T3.niveau).toBe(3);
    });

    it('teste l’égalité', () => {
      expect(Tranche.T3.egale(Tranche.T3)).toBe(true);
      expect(Tranche.T3.egale(Tranche.T1)).toBe(false);
    });

    it('se représente en chaîne lisible', () => {
      expect(Tranche.T3.toString()).toBe('Tranche 3');
    });
  });
});
