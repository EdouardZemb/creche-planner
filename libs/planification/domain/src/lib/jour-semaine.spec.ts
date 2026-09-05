import { describe, expect, it } from 'vitest';
import { jourSemaineDeIso } from './jour-semaine.js';
import { DateInvalideError } from './planification-error.js';

describe('jourSemaineDeIso', () => {
  it('dérive le jour de la semaine depuis une date ISO', () => {
    // 2026-06-01 est un lundi.
    expect(jourSemaineDeIso('2026-06-01')).toBe('LUNDI');
    expect(jourSemaineDeIso('2026-06-02')).toBe('MARDI');
    expect(jourSemaineDeIso('2026-06-03')).toBe('MERCREDI');
    expect(jourSemaineDeIso('2026-06-04')).toBe('JEUDI');
    expect(jourSemaineDeIso('2026-06-05')).toBe('VENDREDI');
    expect(jourSemaineDeIso('2026-06-06')).toBe('SAMEDI');
    expect(jourSemaineDeIso('2026-06-07')).toBe('DIMANCHE');
  });

  it('rejette une date au mauvais format', () => {
    expect(() => jourSemaineDeIso('01/06/2026')).toThrow(DateInvalideError);
    expect(() => jourSemaineDeIso('2026-6-1')).toThrow(DateInvalideError);
  });

  it('rejette une date inexistante', () => {
    expect(() => jourSemaineDeIso('2026-02-30')).toThrow(DateInvalideError);
    expect(() => jourSemaineDeIso('2026-13-01')).toThrow(DateInvalideError);
  });
});
