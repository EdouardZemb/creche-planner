import { describe, expect, it } from 'vitest';
import { PeriodeValidite } from './periode-validite.js';
import { PeriodeInvalideError } from './referentiel-error.js';

describe('PeriodeValidite', () => {
  it('rejette une date de début mal formée', () => {
    expect(() => PeriodeValidite.creer('2026/01/01')).toThrow(
      PeriodeInvalideError,
    );
  });

  it('rejette une date de fin mal formée', () => {
    expect(() => PeriodeValidite.creer('2026-01-01', '01-01-2027')).toThrow(
      PeriodeInvalideError,
    );
  });

  it('rejette une fin antérieure au début', () => {
    expect(() => PeriodeValidite.creer('2026-09-01', '2026-08-31')).toThrow(
      PeriodeInvalideError,
    );
  });

  it('accepte une période bornée', () => {
    const p = PeriodeValidite.creer('2026-01-01', '2026-12-31');
    expect(p.du).toBe('2026-01-01');
    expect(p.au).toBe('2026-12-31');
  });

  it('accepte une période ouverte (sans fin)', () => {
    const p = PeriodeValidite.creer('2026-01-01');
    expect(p.au).toBeUndefined();
  });

  describe('contient', () => {
    it('exclut une date avant le début', () => {
      const p = PeriodeValidite.creer('2026-01-01', '2026-12-31');
      expect(p.contient('2025-12-31')).toBe(false);
    });

    it('exclut une date après la fin', () => {
      const p = PeriodeValidite.creer('2026-01-01', '2026-12-31');
      expect(p.contient('2027-01-01')).toBe(false);
    });

    it('inclut une date dans une période bornée (bornes incluses)', () => {
      const p = PeriodeValidite.creer('2026-01-01', '2026-12-31');
      expect(p.contient('2026-01-01')).toBe(true);
      expect(p.contient('2026-12-31')).toBe(true);
    });

    it('inclut toute date ≥ début pour une période ouverte', () => {
      const p = PeriodeValidite.creer('2026-01-01');
      expect(p.contient('2099-01-01')).toBe(true);
    });
  });

  describe('chevauche', () => {
    const bornee = (du: string, au: string) => PeriodeValidite.creer(du, au);

    it('détecte deux périodes bornées qui se recouvrent', () => {
      expect(
        bornee('2026-01-01', '2026-06-30').chevauche(
          bornee('2026-06-01', '2026-12-31'),
        ),
      ).toBe(true);
    });

    it('ignore deux périodes bornées disjointes (la première avant)', () => {
      expect(
        bornee('2026-01-01', '2026-05-31').chevauche(
          bornee('2026-06-01', '2026-12-31'),
        ),
      ).toBe(false);
    });

    it('ignore deux périodes bornées disjointes (la première après)', () => {
      expect(
        bornee('2026-07-01', '2026-12-31').chevauche(
          bornee('2026-01-01', '2026-06-30'),
        ),
      ).toBe(false);
    });

    it('détecte un recouvrement quand la période courante est ouverte', () => {
      expect(
        PeriodeValidite.creer('2026-01-01').chevauche(
          bornee('2027-01-01', '2027-12-31'),
        ),
      ).toBe(true);
    });

    it('détecte un recouvrement quand l’autre période est ouverte', () => {
      expect(
        bornee('2027-01-01', '2027-12-31').chevauche(
          PeriodeValidite.creer('2026-01-01'),
        ),
      ).toBe(true);
    });
  });
});
