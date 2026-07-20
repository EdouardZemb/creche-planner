import { describe, expect, it } from 'vitest';
import { Tranche } from '@creche-planner/shared-kernel';
import { GrilleAbcm } from './grille-abcm.js';
import { grilleAbcm2026 } from './grille-abcm.fixtures.js';
import { GrilleIndisponibleError } from '../core/tarification-error.js';

describe('GrilleAbcm (barèmes ABCM versionnés, doc 02 §4)', () => {
  it('expose les tarifs de la tranche 3 (foyer de référence)', () => {
    const t3 = grilleAbcm2026(Tranche.T3);
    expect(t3.cantineTotal.centimes).toBe(1268);
    expect(t3.cantinePartGarde.centimes).toBe(801);
    expect(t3.periMatin.centimes).toBe(333);
    expect(t3.periSoir.centimes).toBe(705);
    expect(t3.alshJourneeComplete.centimes).toBe(2650);
    expect(t3.alshDemiJournee.centimes).toBe(950);
    expect(t3.alshRepas.centimes).toBe(750);
  });

  it('expose les tarifs des tranches 1 et 2', () => {
    const t1 = grilleAbcm2026(Tranche.T1);
    expect(t1.cantineTotal.centimes).toBe(1050);
    expect(t1.periMatin.centimes).toBe(231);
    const t2 = grilleAbcm2026(Tranche.T2);
    expect(t2.cantineTotal.centimes).toBe(1165);
    expect(t2.alshJourneeComplete.centimes).toBe(2500);
  });

  it('refuse la part « garde » cantine (PAI) hors T3 (INV-03)', () => {
    expect(() => grilleAbcm2026(Tranche.T1).cantinePartGarde).toThrow(
      GrilleIndisponibleError,
    );
  });

  it('construit une grille PARTIELLE (un seul mode projeté) : les autres postes lèvent', () => {
    // referentiel.GrillePubliee.v2 projette une grille par mode : une grille
    // cantine seule ne porte ni périscolaire ni ALSH. `null` = poste absent.
    const cantineSeule = GrilleAbcm.depuisParametres({
      cantineTotalCentimes: 1268,
      cantinePartGardeCentimes: null,
    });
    expect(cantineSeule.cantineTotal.centimes).toBe(1268);
    expect(() => cantineSeule.cantinePartGarde).toThrow(
      GrilleIndisponibleError,
    );
    expect(() => cantineSeule.periMatin).toThrow(GrilleIndisponibleError);
    expect(() => cantineSeule.periSoir).toThrow(GrilleIndisponibleError);
    expect(() => cantineSeule.alshJourneeComplete).toThrow(
      GrilleIndisponibleError,
    );
    expect(() => cantineSeule.alshDemiJournee).toThrow(GrilleIndisponibleError);
    expect(() => cantineSeule.alshRepas).toThrow(GrilleIndisponibleError);
  });
});

// Triage mutation AQ-13 (doc 27) : message d'indisponibilité non asserté.
describe('GrilleAbcm — triage mutation AQ-13', () => {
  it('explique l’absence de part « garde » cantine (PAI)', () => {
    expect(() => grilleAbcm2026(Tranche.T1).cantinePartGarde).toThrow(
      'part « garde » cantine (PAI) non défini pour cette grille',
    );
  });
});
