// MBT — DT-12 (Decision Table + BVA 3 points au quota) ;
// Critère : partition heures < / = / > quota + BVA 3 points (quota−1 / quota / quota+1) + property (coût ≥ 0) ;
// Traçabilité doc 17 ; SUT : abcm/unites-associatives-abcm.ts
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Money } from '@creche-planner/shared-kernel';
import { UnitesAssociativesAbcm } from './unites-associatives-abcm.js';
import { QuantiteInvalideError } from '../core/tarification-error.js';

/**
 * Modèle DT-12 — unités associatives (unites-associatives-abcm.ts L35-50).
 *   heuresManquantes = max(0, quota − heuresRealisees)
 *   coût = heuresManquantes × valeurUa  (0 € si quota atteint/dépassé)
 * Défauts : quota = 20 h, valeurUa = 31,25 €.
 *
 * Frontière sensible : le quota, encadré par quota−1 / quota / quota+1 (BVA 3 points).
 */

const QUOTA = 20;
const VALEUR_UA = 3125; // 31,25 € en centimes

const ua = new UnitesAssociativesAbcm();

describe('MBT DT-12 — partition heures réalisées vs quota', () => {
  const cas: ReadonlyArray<[string, number, number, number]> = [
    // [libellé, heuresRealisees, heuresManquantes attendues, coût centimes attendu]
    ['aucune heure ⇒ quota entier manquant', 0, 20, 20 * VALEUR_UA],
    ['heures < quota ⇒ manque partiel', 12, 8, 8 * VALEUR_UA],
    ['heures = quota ⇒ 0 manquante, coût nul', 20, 0, 0],
    ['heures > quota ⇒ 0 manquante, coût nul', 25, 0, 0],
  ];

  it.each(cas)('%s', (_l, realisees, _manq, coutAttendu) => {
    const cout = ua.calculerCoutMois({ heuresRealisees: realisees });
    expect(cout.total.centimes).toBe(coutAttendu);
  });

  it('quota atteint ⇒ coût vide (caution rendue)', () => {
    expect(ua.calculerCoutMois({ heuresRealisees: 20 }).estVide()).toBe(true);
  });

  it('quota non atteint ⇒ une ligne « UA non réalisées »', () => {
    const lignes = ua.calculerCoutMois({ heuresRealisees: 0 }).lignes;
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.libelle).toBe('UA non réalisées');
  });
});

describe('MBT DT-12 — BVA 3 points au quota (19 | 20 | 21)', () => {
  const cas: ReadonlyArray<[string, number, number]> = [
    ['quota − 1 (19 h) ⇒ 1 h manquante', QUOTA - 1, 1 * VALEUR_UA],
    ['quota exact (20 h) ⇒ 0 manquante', QUOTA, 0],
    ['quota + 1 (21 h) ⇒ 0 manquante', QUOTA + 1, 0],
  ];
  it.each(cas)('%s', (_l, realisees, coutAttendu) => {
    expect(
      ua.calculerCoutMois({ heuresRealisees: realisees }).total.centimes,
    ).toBe(coutAttendu);
  });
});

describe('MBT DT-12 — valeurs invalides', () => {
  const invalides: ReadonlyArray<[string, number]> = [
    ['négatif', -1],
    ['NaN', Number.NaN],
    ['infini', Number.POSITIVE_INFINITY],
  ];
  it.each(invalides)('heuresRealisees %s ⇒ QuantiteInvalideError', (_l, h) => {
    expect(() => ua.calculerCoutMois({ heuresRealisees: h })).toThrow(
      QuantiteInvalideError,
    );
  });
});

describe('MBT DT-12 — config personnalisée (quota / valeur pilotables)', () => {
  it('quota 10 h, valeur 50 € : 4 h réalisées ⇒ 6 h × 50 € = 300 €', () => {
    const sur = new UnitesAssociativesAbcm({
      quotaHeures: 10,
      valeurUa: Money.depuisEuros(50),
    });
    expect(sur.calculerCoutMois({ heuresRealisees: 4 }).total.centimes).toBe(
      30000,
    );
  });
});

describe('MBT DT-12 — property : coût ≥ 0 et = max(0, quota−h) × valeur', () => {
  it('pour toute heure réalisée ≥ 0, le coût correspond au modèle et reste ≥ 0', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1000, noNaN: true, noDefaultInfinity: true }),
        (h) => {
          const cout = ua.calculerCoutMois({ heuresRealisees: h });
          const manquantes = Math.max(0, QUOTA - h);
          const attendu =
            manquantes === 0 ? 0 : Math.round(VALEUR_UA * manquantes);
          expect(cout.total.centimes).toBe(attendu);
          expect(cout.total.centimes).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});
