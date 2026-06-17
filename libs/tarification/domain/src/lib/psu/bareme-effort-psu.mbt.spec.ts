// MBT — DT-08 (Decision Table / partition par paliers) ;
// Critère : partition complète des paliers + BVA aux bornes de palier (3|4, 7|8) + valeurs invalides ;
// Traçabilité doc 17 ; SUT : psu/bareme-effort-psu.ts
import { describe, expect, it } from 'vitest';
import { BaremeEffortPsu } from './bareme-effort-psu.js';
import { TauxEffortInconnuError } from '../core/tarification-error.js';

/**
 * Modèle DT-08 — taux d'effort par nbEnfantsACharge (bareme-effort-psu.ts L14-33) :
 *   1            ⇒ 0.000619
 *   2            ⇒ 0.000516
 *   3            ⇒ 0.000413
 *   4 ≤ n ≤ 7    ⇒ 0.00031
 *   n ≥ 8        ⇒ 0.000206
 *   n < 1 ou non entier ⇒ TauxEffortInconnuError
 *
 * Bornes de palier sensibles : 3↔4 (palier 3 vs palier 4-7) et 7↔8 (palier 4-7 vs ≥8).
 */

const bareme = new BaremeEffortPsu();

describe('MBT DT-08 — paliers du taux d’effort (partition complète)', () => {
  // Tous les paliers, un représentant par classe + bornes BVA.
  const cas: ReadonlyArray<[number, number]> = [
    [1, 0.000619], // palier 1
    [2, 0.000516], // palier 2
    [3, 0.000413], // palier 3  (borne basse du couple 3|4)
    [4, 0.00031], //  palier 4-7 (borne haute du couple 3|4)
    [5, 0.00031], //  intérieur palier 4-7
    [6, 0.00031], //  intérieur palier 4-7
    [7, 0.00031], //  palier 4-7 (borne basse du couple 7|8)
    [8, 0.000206], // palier ≥8 (borne haute du couple 7|8)
    [9, 0.000206], // intérieur palier ≥8
    [50, 0.000206], // grand n
  ];

  it.each(cas)('nbEnfants = %i ⇒ taux %f', (n, attendu) => {
    expect(bareme.taux(n)).toBe(attendu);
  });
});

describe('MBT DT-08 — BVA aux bornes de palier', () => {
  it('frontière 3|4 : taux(3) ≠ taux(4) et changement de palier', () => {
    expect(bareme.taux(3)).toBe(0.000413);
    expect(bareme.taux(4)).toBe(0.00031);
    expect(bareme.taux(3)).not.toBe(bareme.taux(4));
  });

  it('frontière 7|8 : taux(7) ≠ taux(8) et changement de palier', () => {
    expect(bareme.taux(7)).toBe(0.00031);
    expect(bareme.taux(8)).toBe(0.000206);
    expect(bareme.taux(7)).not.toBe(bareme.taux(8));
  });
});

describe('MBT DT-08 — valeurs invalides (INV-02)', () => {
  const invalides: ReadonlyArray<[string, number]> = [
    ['zéro (borne basse −1)', 0],
    ['négatif', -1],
    ['non entier (2.5)', 2.5],
  ];

  it.each(invalides)('%s ⇒ TauxEffortInconnuError', (_l, n) => {
    expect(() => bareme.taux(n)).toThrow(TauxEffortInconnuError);
  });
});
