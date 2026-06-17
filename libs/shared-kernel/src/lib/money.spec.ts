import { describe, expect, it } from 'vitest';
import { Money } from './money.js';
import { MontantNegatifError, MontantNonEntierError } from './domain-error.js';

describe('Money', () => {
  describe('construction', () => {
    it('se construit à partir de centimes entiers', () => {
      expect(Money.depuisCentimes(347).centimes).toBe(347);
    });

    it('expose le zéro', () => {
      expect(Money.zero().centimes).toBe(0);
      expect(Money.zero().estZero()).toBe(true);
    });

    it('convertit des euros en centimes avec arrondi au centime', () => {
      expect(Money.depuisEuros(3.47).centimes).toBe(347);
      expect(Money.depuisEuros(10).centimes).toBe(1000);
      // 6716,92 € → 671692 centimes (ressources réelles du foyer)
      expect(Money.depuisEuros(6716.92).centimes).toBe(671692);
    });

    it('arrondit au centime le plus proche depuis les euros', () => {
      expect(Money.depuisEuros(1.005).centimes).toBe(101);
      expect(Money.depuisEuros(1.004).centimes).toBe(100);
    });

    it('refuse un montant négatif', () => {
      expect(() => Money.depuisCentimes(-1)).toThrow(MontantNegatifError);
      expect(() => Money.depuisEuros(-0.01)).toThrow(MontantNegatifError);
    });

    it('refuse un nombre de centimes non entier', () => {
      expect(() => Money.depuisCentimes(3.5)).toThrow(MontantNonEntierError);
      expect(() => Money.depuisCentimes(Number.NaN)).toThrow(
        MontantNonEntierError,
      );
    });
  });

  describe('arithmétique', () => {
    it('additionne deux montants', () => {
      expect(
        Money.depuisCentimes(40000).plus(Money.depuisCentimes(2000)).centimes,
      ).toBe(42000);
    });

    it('soustrait deux montants', () => {
      expect(
        Money.depuisCentimes(41220).moins(Money.depuisCentimes(2776)).centimes,
      ).toBe(38444);
    });

    it('refuse une soustraction qui rendrait le montant négatif', () => {
      expect(() =>
        Money.depuisCentimes(100).moins(Money.depuisCentimes(101)),
      ).toThrow(MontantNegatifError);
    });

    it('multiplie par une quantité entière', () => {
      expect(Money.depuisCentimes(347).fois(2).centimes).toBe(694);
    });

    it('multiplie par un facteur fractionnaire en arrondissant au centime', () => {
      expect(Money.depuisCentimes(347).fois(0.5).centimes).toBe(174);
      expect(Money.depuisCentimes(1268).fois(16).centimes).toBe(20288);
    });

    it('refuse une multiplication par un facteur négatif', () => {
      expect(() => Money.depuisCentimes(347).fois(-1)).toThrow(
        MontantNegatifError,
      );
    });
  });

  describe('comparaison & représentation', () => {
    it('teste l’égalité par valeur', () => {
      expect(Money.depuisCentimes(347).egale(Money.depuisCentimes(347))).toBe(
        true,
      );
      expect(Money.depuisCentimes(347).egale(Money.depuisCentimes(348))).toBe(
        false,
      );
    });

    it('compare deux montants', () => {
      expect(
        Money.depuisCentimes(348).estSuperieurA(Money.depuisCentimes(347)),
      ).toBe(true);
      expect(
        Money.depuisCentimes(347).estSuperieurA(Money.depuisCentimes(347)),
      ).toBe(false);
    });

    it('expose la valeur en euros', () => {
      expect(Money.depuisCentimes(347).enEuros()).toBe(3.47);
    });

    it('se représente en chaîne lisible', () => {
      expect(Money.depuisCentimes(347).toString()).toBe('3,47 €');
      expect(Money.depuisCentimes(671692).toString()).toBe('6716,92 €');
    });

    it('est immuable (les opérations renvoient une nouvelle instance)', () => {
      const base = Money.depuisCentimes(347);
      base.plus(Money.depuisCentimes(1));
      expect(base.centimes).toBe(347);
    });
  });
});
