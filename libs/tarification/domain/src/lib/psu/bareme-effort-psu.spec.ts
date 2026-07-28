import { describe, expect, it } from 'vitest';
import { BaremeEffortPsu } from './bareme-effort-psu.js';
import { baremeEffortPsu2026 } from './bareme-effort-psu.fixtures.js';
import { TauxEffortInconnuError } from '../core/tarification-error.js';

describe('BaremeEffortPsu (taux d’effort CNAF, doc 02 §3.3)', () => {
  const bareme = baremeEffortPsu2026();

  it('donne le taux par nombre d’enfants à charge', () => {
    expect(bareme.taux(1)).toBe(0.000619);
    expect(bareme.taux(2)).toBe(0.000516);
    expect(bareme.taux(3)).toBe(0.000413);
    expect(bareme.taux(4)).toBe(0.00031);
    expect(bareme.taux(7)).toBe(0.00031);
    expect(bareme.taux(8)).toBe(0.000206);
    // Au-delà du dernier palier connu (8), le taux plafond s'applique.
    expect(bareme.taux(12)).toBe(0.000206);
  });

  it('rejette un nombre d’enfants hors barème (INV-02)', () => {
    expect(() => bareme.taux(0)).toThrow(TauxEffortInconnuError);
    expect(() => bareme.taux(-1)).toThrow(TauxEffortInconnuError);
    expect(() => bareme.taux(2.5)).toThrow(TauxEffortInconnuError);
  });

  it('se construit depuis une map de paramètres (RM-30-04, plus de figé)', () => {
    const bareme2 = new BaremeEffortPsu({ '1': 0.001, '2': 0.0008 });
    expect(bareme2.taux(1)).toBe(0.001);
    expect(bareme2.taux(2)).toBe(0.0008);
    expect(bareme2.taux(9)).toBe(0.0008); // clamp au dernier palier
  });

  it('lève quand un palier intermédiaire manque dans la map', () => {
    // Map creuse : le palier 2 n'existe pas → hors barème pour nbEnfants = 2.
    const creux = new BaremeEffortPsu({ '1': 0.001, '3': 0.0005 });
    expect(() => creux.taux(2)).toThrow(TauxEffortInconnuError);
  });

  it('lève pour tout nombre sur un barème vide', () => {
    const vide = new BaremeEffortPsu({});
    expect(() => vide.taux(1)).toThrow(TauxEffortInconnuError);
  });
});

// Triage mutation AQ-13 (doc 27) : message hors barème non asserté.
describe('BaremeEffortPsu — triage mutation AQ-13', () => {
  it('explicite la valeur hors barème', () => {
    expect(() => baremeEffortPsu2026().taux(0)).toThrow(
      "nombre d'enfants à charge hors barème (≥ 1 attendu) : 0",
    );
  });
});
