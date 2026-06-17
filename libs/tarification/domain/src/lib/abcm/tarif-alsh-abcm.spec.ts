import { describe, expect, it } from 'vitest';
import { Tranche } from '@creche-planner/shared-kernel';
import { GrilleAbcm } from './grille-abcm.js';
import { TarifAlshAbcm } from './tarif-alsh-abcm.js';
import { QuantiteInvalideError } from '../core/tarification-error.js';

const alsh = new TarifAlshAbcm(GrilleAbcm.pour(Tranche.T3));

describe('TarifAlshAbcm (doc 02 §4.3)', () => {
  it('CT-12 — 5 journées complètes × 26,50 € = 132,50 €', () => {
    expect(
      alsh.calculerCoutMois({ nbJourneesCompletes: 5 }).total.centimes,
    ).toBe(13250);
  });

  it('additionne journées, demi-journées et repas', () => {
    // 2×26,50 + 3×9,50 + 4×7,50 = 53 + 28,50 + 30 = 111,50 €
    const cout = alsh.calculerCoutMois({
      nbJourneesCompletes: 2,
      nbDemiJournees: 3,
      nbRepas: 4,
    });
    expect(cout.total.centimes).toBe(11150);
  });

  it('rejette une quantité invalide (INV-01)', () => {
    expect(() => alsh.calculerCoutMois({ nbJourneesCompletes: -2 })).toThrow(
      QuantiteInvalideError,
    );
  });

  it('porte le mode ALSH', () => {
    expect(alsh.mode).toBe('ALSH');
  });
});

// Triage mutation AQ-13 (doc 27) : libellés (contrat d'affichage du détail de
// coût) et champ fautif des erreurs n'étaient pas assertés.
describe('TarifAlshAbcm — triage mutation AQ-13', () => {
  it('libelle les trois lignes ALSH', () => {
    const cout = alsh.calculerCoutMois({
      nbJourneesCompletes: 1,
      nbDemiJournees: 1,
      nbRepas: 1,
    });
    expect(cout.lignes.map((l) => l.libelle)).toEqual([
      'ALSH journée complète',
      'ALSH demi-journée',
      'ALSH repas',
    ]);
  });

  it('nomme le champ fautif dans l’erreur (INV-01)', () => {
    expect(() => alsh.calculerCoutMois({ nbJourneesCompletes: -2 })).toThrow(
      'nbJourneesCompletes',
    );
    expect(() =>
      alsh.calculerCoutMois({ nbJourneesCompletes: 1, nbDemiJournees: -1 }),
    ).toThrow('nbDemiJournees');
    expect(() =>
      alsh.calculerCoutMois({ nbJourneesCompletes: 1, nbRepas: -1 }),
    ).toThrow('nbRepas');
  });
});
