import { describe, expect, it } from 'vitest';
import {
  BAREME_EFFORT_PSU_2026,
  BaremeEffortPsu,
} from './bareme-effort-psu.js';
import { TauxEffortInconnuError } from '../core/tarification-error.js';

describe('BaremeEffortPsu (taux d’effort CNAF, doc 02 §3.3)', () => {
  const bareme = new BaremeEffortPsu();

  it('donne le taux par nombre d’enfants à charge', () => {
    expect(bareme.taux(1)).toBe(0.000619);
    expect(bareme.taux(2)).toBe(0.000516);
    expect(bareme.taux(3)).toBe(0.000413);
    expect(bareme.taux(4)).toBe(0.00031);
    expect(bareme.taux(7)).toBe(0.00031);
    expect(bareme.taux(8)).toBe(0.000206);
    expect(bareme.taux(12)).toBe(0.000206);
  });

  it('rejette un nombre d’enfants hors barème (INV-02)', () => {
    expect(() => bareme.taux(0)).toThrow(TauxEffortInconnuError);
    expect(() => bareme.taux(-1)).toThrow(TauxEffortInconnuError);
    expect(() => bareme.taux(2.5)).toThrow(TauxEffortInconnuError);
  });

  it('expose une instance 2026 prête à l’emploi', () => {
    expect(BAREME_EFFORT_PSU_2026.taux(2)).toBe(0.000516);
  });
});

// Triage mutation AQ-13 (doc 27) : message hors barème non asserté.
describe('BaremeEffortPsu — triage mutation AQ-13', () => {
  it('explicite la valeur hors barème', () => {
    expect(() => new BaremeEffortPsu().taux(0)).toThrow(
      "nombre d'enfants à charge hors barème (≥ 1 attendu) : 0",
    );
  });
});
