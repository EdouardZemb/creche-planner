// MBT — BVA-17 (Equivalence Partitioning / partition par tranche) ;
// Critère : partition complète des 3 tranches T1/T2/T3 (tous les tarifs) + cas part garde PAI ;
// Traçabilité doc 17 ; SUT : abcm/grille-abcm.ts
import { describe, expect, it } from 'vitest';
import { Tranche } from '@creche-planner/shared-kernel';
import { GrilleAbcm } from './grille-abcm.js';
import { GrilleIndisponibleError } from '../core/tarification-error.js';

/**
 * Modèle BVA-17 — grille ABCM 2026 par tranche (grille-abcm.ts L29-55).
 * Les 3 tranches forment une partition exhaustive ; chaque tranche expose un
 * vecteur de tarifs (cantine, péri matin/soir, ALSH journée/demi/repas).
 * La part « garde » cantine (PAI) n'existe que pour T3.
 */

interface VecteurTarifs {
  cantineTotal: number;
  periMatin: number;
  periSoir: number;
  alshJourneeComplete: number;
  alshDemiJournee: number;
  alshRepas: number;
}

const ATTENDU: Record<1 | 2 | 3, VecteurTarifs> = {
  1: {
    cantineTotal: 1050,
    periMatin: 231,
    periSoir: 501,
    alshJourneeComplete: 2350,
    alshDemiJournee: 850,
    alshRepas: 650,
  },
  2: {
    cantineTotal: 1165,
    periMatin: 287,
    periSoir: 601,
    alshJourneeComplete: 2500,
    alshDemiJournee: 900,
    alshRepas: 700,
  },
  3: {
    cantineTotal: 1268,
    periMatin: 333,
    periSoir: 705,
    alshJourneeComplete: 2650,
    alshDemiJournee: 950,
    alshRepas: 750,
  },
};

const TRANCHES: readonly [1 | 2 | 3, Tranche][] = [
  [1, Tranche.T1],
  [2, Tranche.T2],
  [3, Tranche.T3],
];

describe('MBT BVA-17 — grille ABCM par tranche (partition complète)', () => {
  it.each(TRANCHES)('tranche T%i — tous les tarifs', (niveau, tranche) => {
    const g = GrilleAbcm.pour(tranche);
    const attendu = ATTENDU[niveau];
    expect(g.cantineTotal.centimes).toBe(attendu.cantineTotal);
    expect(g.periMatin.centimes).toBe(attendu.periMatin);
    expect(g.periSoir.centimes).toBe(attendu.periSoir);
    expect(g.alshJourneeComplete.centimes).toBe(attendu.alshJourneeComplete);
    expect(g.alshDemiJournee.centimes).toBe(attendu.alshDemiJournee);
    expect(g.alshRepas.centimes).toBe(attendu.alshRepas);
  });
});

describe('MBT BVA-17 — part « garde » cantine (PAI) : T3 seule', () => {
  it('T3 ⇒ part garde = 8,01 €', () => {
    expect(GrilleAbcm.pour(Tranche.T3).cantinePartGarde.centimes).toBe(801);
  });

  const sansPartGarde: readonly [1 | 2, Tranche][] = [
    [1, Tranche.T1],
    [2, Tranche.T2],
  ];
  it.each(sansPartGarde)(
    'T%i ⇒ GrilleIndisponibleError (INV-03)',
    (_n, tranche) => {
      expect(() => GrilleAbcm.pour(tranche).cantinePartGarde).toThrow(
        GrilleIndisponibleError,
      );
    },
  );
});
