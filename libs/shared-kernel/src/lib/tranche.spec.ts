import { describe, expect, it } from 'vitest';
import { Tranche } from './tranche.js';
import { Money } from './money.js';

describe('Tranche (classe de revenu RFR, ABCM)', () => {
  describe('déduction depuis le RFR (seuils 20 k / 50 k €)', () => {
    it('classe en T1 un RFR strictement inférieur à 20 000 €', () => {
      expect(Tranche.depuisRfr(Money.depuisEuros(19999.99))).toBe(Tranche.T1);
    });

    it('classe en T2 un RFR à la borne basse (20 000 €)', () => {
      expect(Tranche.depuisRfr(Money.depuisEuros(20000))).toBe(Tranche.T2);
    });

    it('classe en T2 un RFR à la borne haute (50 000 €)', () => {
      expect(Tranche.depuisRfr(Money.depuisEuros(50000))).toBe(Tranche.T2);
    });

    it('classe en T3 un RFR strictement supérieur à 50 000 €', () => {
      expect(Tranche.depuisRfr(Money.depuisEuros(50000.01))).toBe(Tranche.T3);
    });

    it('classe le RFR réel du foyer (72 705 €) en T3', () => {
      expect(Tranche.depuisRfr(Money.depuisEuros(72705))).toBe(Tranche.T3);
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
