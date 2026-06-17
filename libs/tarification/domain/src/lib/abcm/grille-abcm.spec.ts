import { describe, expect, it } from 'vitest';
import { Tranche } from '@creche-planner/shared-kernel';
import { GrilleAbcm } from './grille-abcm.js';
import { GrilleIndisponibleError } from '../core/tarification-error.js';

describe('GrilleAbcm (barèmes ABCM versionnés, doc 02 §4)', () => {
  it('expose les tarifs de la tranche 3 (foyer de référence)', () => {
    const t3 = GrilleAbcm.pour(Tranche.T3);
    expect(t3.cantineTotal.centimes).toBe(1268);
    expect(t3.cantinePartGarde.centimes).toBe(801);
    expect(t3.periMatin.centimes).toBe(333);
    expect(t3.periSoir.centimes).toBe(705);
    expect(t3.alshJourneeComplete.centimes).toBe(2650);
    expect(t3.alshDemiJournee.centimes).toBe(950);
    expect(t3.alshRepas.centimes).toBe(750);
  });

  it('expose les tarifs des tranches 1 et 2', () => {
    const t1 = GrilleAbcm.pour(Tranche.T1);
    expect(t1.cantineTotal.centimes).toBe(1050);
    expect(t1.periMatin.centimes).toBe(231);
    const t2 = GrilleAbcm.pour(Tranche.T2);
    expect(t2.cantineTotal.centimes).toBe(1165);
    expect(t2.alshJourneeComplete.centimes).toBe(2500);
  });

  it('refuse la part « garde » cantine (PAI) hors T3 (INV-03)', () => {
    expect(() => GrilleAbcm.pour(Tranche.T1).cantinePartGarde).toThrow(
      GrilleIndisponibleError,
    );
  });
});

// Triage mutation AQ-13 (doc 27) : message d'indisponibilité non asserté.
describe('GrilleAbcm — triage mutation AQ-13', () => {
  it('explique l’absence de part « garde » cantine (PAI)', () => {
    expect(() => GrilleAbcm.pour(Tranche.T1).cantinePartGarde).toThrow(
      'part « garde » cantine (PAI) non définie pour cette tranche',
    );
  });
});
