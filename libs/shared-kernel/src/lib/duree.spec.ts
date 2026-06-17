import { describe, expect, it } from 'vitest';
import { Duree } from './duree.js';
import {
  DureeInvalideError,
  PlageHoraireInvalideError,
} from './domain-error.js';

describe('Duree', () => {
  describe('construction', () => {
    it('se construit à partir de minutes entières', () => {
      expect(Duree.depuisMinutes(90).enMinutes).toBe(90);
    });

    it('se construit à partir d’heures et de minutes', () => {
      expect(Duree.depuisHeuresMinutes(1, 30).enMinutes).toBe(90);
      expect(Duree.depuisHeuresMinutes(8, 0).enMinutes).toBe(480);
    });

    it('expose le zéro', () => {
      expect(Duree.zero().enMinutes).toBe(0);
      expect(Duree.zero().estZero()).toBe(true);
    });

    it('refuse une durée négative', () => {
      expect(() => Duree.depuisMinutes(-1)).toThrow(DureeInvalideError);
      expect(() => Duree.depuisHeuresMinutes(-1, 0)).toThrow(
        DureeInvalideError,
      );
    });

    it('refuse un nombre de minutes non entier', () => {
      expect(() => Duree.depuisMinutes(1.5)).toThrow(DureeInvalideError);
    });
  });

  describe('plage horaire (fin > début)', () => {
    it('calcule la durée entre un début et une fin', () => {
      // 09:00 → 16:30 = 7 h 30 = 450 min (semaine type Mia, lundi)
      expect(Duree.entre(9 * 60, 16 * 60 + 30).enMinutes).toBe(450);
    });

    it('refuse une fin antérieure au début', () => {
      expect(() => Duree.entre(16 * 60, 9 * 60)).toThrow(
        PlageHoraireInvalideError,
      );
    });

    it('refuse une plage de durée nulle (fin égale début)', () => {
      expect(() => Duree.entre(540, 540)).toThrow(PlageHoraireInvalideError);
    });
  });

  describe('arithmétique & conversions', () => {
    it('additionne deux durées', () => {
      expect(
        Duree.depuisMinutes(450).plus(Duree.depuisMinutes(510)).enMinutes,
      ).toBe(960);
    });

    it('soustrait deux durées', () => {
      expect(
        Duree.depuisMinutes(510).moins(Duree.depuisMinutes(60)).enMinutes,
      ).toBe(450);
    });

    it('refuse une soustraction qui rendrait la durée négative', () => {
      expect(() =>
        Duree.depuisMinutes(60).moins(Duree.depuisMinutes(61)),
      ).toThrow(DureeInvalideError);
    });

    it('convertit en heures décimales', () => {
      expect(Duree.depuisMinutes(90).enHeures()).toBe(1.5);
    });

    it('teste l’égalité par valeur', () => {
      expect(Duree.depuisMinutes(90).egale(Duree.depuisMinutes(90))).toBe(true);
      expect(Duree.depuisMinutes(90).egale(Duree.depuisMinutes(91))).toBe(
        false,
      );
    });

    it('se représente en chaîne lisible', () => {
      expect(Duree.depuisMinutes(90).toString()).toBe('1 h 30');
      expect(Duree.depuisMinutes(480).toString()).toBe('8 h 00');
      expect(Duree.depuisMinutes(45).toString()).toBe('0 h 45');
    });
  });
});
