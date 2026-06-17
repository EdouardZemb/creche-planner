import { describe, expect, it } from 'vitest';
import {
  JOURS_OUVERTURE_ECOLE,
  jourSemaineDeIso,
  estJourOuvertureEcole,
} from './jour-semaine.js';
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

describe('estJourOuvertureEcole', () => {
  it('reconnaît lundi/mardi/jeudi/vendredi comme jours d ouverture école (doc 02 §4.4bis)', () => {
    expect(estJourOuvertureEcole('LUNDI')).toBe(true);
    expect(estJourOuvertureEcole('MARDI')).toBe(true);
    expect(estJourOuvertureEcole('JEUDI')).toBe(true);
    expect(estJourOuvertureEcole('VENDREDI')).toBe(true);
  });

  it('exclut mercredi, samedi et dimanche', () => {
    expect(estJourOuvertureEcole('MERCREDI')).toBe(false);
    expect(estJourOuvertureEcole('SAMEDI')).toBe(false);
    expect(estJourOuvertureEcole('DIMANCHE')).toBe(false);
  });

  it('expose les jours d ouverture école', () => {
    expect(JOURS_OUVERTURE_ECOLE).toEqual([
      'LUNDI',
      'MARDI',
      'JEUDI',
      'VENDREDI',
    ]);
  });
});
