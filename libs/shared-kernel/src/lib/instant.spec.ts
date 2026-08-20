import { describe, expect, it } from 'vitest';
import { instant } from './instant.js';
import { InstantInvalideError } from './domain-error.js';

describe('instant', () => {
  it('accepte un ISO 8601 UTC de largeur fixe', () => {
    expect(instant('2026-08-17T09:30:00.000Z')).toBe(
      '2026-08-17T09:30:00.000Z',
    );
  });

  it('refuse un offset horaire — il casserait la comparaison lexicographique', () => {
    expect(() => instant('2026-08-17T11:30:00.000+02:00')).toThrow(
      InstantInvalideError,
    );
  });

  it('refuse une date nue : les deux axes de temps ne se replient pas l’un sur l’autre', () => {
    expect(() => instant('2026-08-17')).toThrow(InstantInvalideError);
  });

  it('refuse une précision différente de la milliseconde', () => {
    expect(() => instant('2026-08-17T09:30:00Z')).toThrow(InstantInvalideError);
  });

  it('ordonne chronologiquement par comparaison lexicographique', () => {
    const tot = instant('2026-08-17T09:30:00.000Z');
    const tard = instant('2026-08-17T09:30:00.001Z');
    expect(tot < tard).toBe(true);
    expect(instant('2026-09-01T00:00:00.000Z') > tard).toBe(true);
  });
});
