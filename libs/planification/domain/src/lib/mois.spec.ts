import { describe, expect, it } from 'vitest';
import { joursDuMois } from './mois.js';
import { MoisInvalideError } from './planification-error.js';

describe('joursDuMois', () => {
  it('énumère toutes les dates ISO d un mois de 30 jours', () => {
    const jours = joursDuMois('2026-06');
    expect(jours).toHaveLength(30);
    expect(jours[0]).toBe('2026-06-01');
    expect(jours[29]).toBe('2026-06-30');
  });

  it('gère un mois de 31 jours', () => {
    expect(joursDuMois('2026-07')).toHaveLength(31);
  });

  it('gère février d une année non bissextile', () => {
    expect(joursDuMois('2026-02')).toHaveLength(28);
  });

  it('gère février d une année bissextile', () => {
    const jours = joursDuMois('2024-02');
    expect(jours).toHaveLength(29);
    expect(jours[28]).toBe('2024-02-29');
  });

  it('rejette un mois au mauvais format', () => {
    expect(() => joursDuMois('2026-6')).toThrow(MoisInvalideError);
    expect(() => joursDuMois('06-2026')).toThrow(MoisInvalideError);
  });

  it('rejette un numéro de mois hors bornes', () => {
    expect(() => joursDuMois('2026-00')).toThrow(MoisInvalideError);
    expect(() => joursDuMois('2026-13')).toThrow(MoisInvalideError);
  });
});
