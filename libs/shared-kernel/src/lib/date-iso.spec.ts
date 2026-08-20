import { describe, expect, it } from 'vitest';
import { ajouterJours, differenceEnJours, estDateIso } from './date-iso.js';
import { DateIsoInvalideError } from './domain-error.js';

describe('estDateIso', () => {
  it('accepte la forme YYYY-MM-DD', () => {
    expect(estDateIso('2026-04-05')).toBe(true);
  });

  it('refuse toute autre forme', () => {
    expect(estDateIso('2026-4-5')).toBe(false);
    expect(estDateIso('2026-04-05T00:00:00.000Z')).toBe(false);
    expect(estDateIso('')).toBe(false);
  });
});

describe('ajouterJours', () => {
  it('décale au sein du mois, dans les deux sens', () => {
    expect(ajouterJours('2026-04-05', 3)).toBe('2026-04-08');
    expect(ajouterJours('2026-04-05', -3)).toBe('2026-04-02');
    expect(ajouterJours('2026-04-05', 0)).toBe('2026-04-05');
  });

  it('absorbe la frontière de mois vers l’avant et vers l’arrière', () => {
    expect(ajouterJours('2026-04-30', 1)).toBe('2026-05-01');
    expect(ajouterJours('2026-05-01', -1)).toBe('2026-04-30');
  });

  it('absorbe la frontière d’année dans les deux sens', () => {
    expect(ajouterJours('2026-12-31', 1)).toBe('2027-01-01');
    expect(ajouterJours('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('absorbe février, bissextile ou non', () => {
    expect(ajouterJours('2024-02-28', 1)).toBe('2024-02-29');
    expect(ajouterJours('2026-02-28', 1)).toBe('2026-03-01');
    expect(ajouterJours('2000-02-28', 1)).toBe('2000-02-29');
    expect(ajouterJours('1900-02-28', 1)).toBe('1900-03-01');
  });

  it('franchit plusieurs mois d’un coup (Pâques + 50)', () => {
    expect(ajouterJours('2026-04-05', 50)).toBe('2026-05-25');
    expect(ajouterJours('2027-03-28', 50)).toBe('2027-05-17');
    expect(ajouterJours('2026-11-20', -60)).toBe('2026-09-21');
  });

  it('lève DateIsoInvalideError sur un format invalide', () => {
    expect(() => ajouterJours('05/04/2026', 1)).toThrow(DateIsoInvalideError);
  });
});

describe('differenceEnJours', () => {
  it('vaut 0 pour un même jour', () => {
    expect(differenceEnJours('2026-04-05', '2026-04-05')).toBe(0);
  });

  it('compte les jours dans le sens croissant', () => {
    expect(differenceEnJours('2026-04-05', '2026-04-08')).toBe(3);
    expect(differenceEnJours('2026-01-05', '2026-07-04')).toBe(180);
  });

  it('est négatif quand la fin précède le début', () => {
    expect(differenceEnJours('2026-04-08', '2026-04-05')).toBe(-3);
  });

  it('absorbe les années bissextiles et les frontières de siècle', () => {
    expect(differenceEnJours('2024-02-28', '2024-03-01')).toBe(2);
    expect(differenceEnJours('2026-02-28', '2026-03-01')).toBe(1);
    expect(differenceEnJours('1900-01-01', '2000-01-01')).toBe(36524);
  });

  it('est cohérent avec ajouterJours', () => {
    for (const delta of [-60, -1, 0, 1, 39, 50, 400]) {
      expect(
        differenceEnJours('2026-04-05', ajouterJours('2026-04-05', delta)),
      ).toBe(delta);
    }
  });

  it('lève DateIsoInvalideError sur l’une ou l’autre borne', () => {
    expect(() => differenceEnJours('05/04/2026', '2026-04-08')).toThrow(
      DateIsoInvalideError,
    );
    expect(() => differenceEnJours('2026-04-05', '08/04/2026')).toThrow(
      DateIsoInvalideError,
    );
  });
});
