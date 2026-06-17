import { describe, expect, it } from 'vitest';
import { Tranche } from '@creche-planner/shared-kernel';
import { GrilleAbcm } from './grille-abcm.js';
import { TarifPeriscolaireAbcm } from './tarif-periscolaire-abcm.js';
import { QuantiteInvalideError } from '../core/tarification-error.js';

const peri = new TarifPeriscolaireAbcm(GrilleAbcm.pour(Tranche.T3));

describe('TarifPeriscolaireAbcm (doc 02 §4.2)', () => {
  it('CT-11 — soir ×12 (7,05) + matin ×8 (3,33) = 111,24 €', () => {
    const cout = peri.calculerCoutMois({ nbMatins: 8, nbSoirs: 12 });
    expect(cout.total.centimes).toBe(11124);
  });

  it('rejette des séances invalides (INV-01)', () => {
    expect(() => peri.calculerCoutMois({ nbMatins: -1, nbSoirs: 0 })).toThrow(
      QuantiteInvalideError,
    );
    expect(() => peri.calculerCoutMois({ nbMatins: 0, nbSoirs: 1.5 })).toThrow(
      QuantiteInvalideError,
    );
  });

  it('porte le mode PERISCOLAIRE', () => {
    expect(peri.mode).toBe('PERISCOLAIRE');
  });
});

// Triage mutation AQ-13 (doc 27) : libellés et champ fautif non assertés.
describe('TarifPeriscolaireAbcm — triage mutation AQ-13', () => {
  it('libelle les lignes matin et soir', () => {
    const cout = peri.calculerCoutMois({ nbMatins: 1, nbSoirs: 1 });
    expect(cout.lignes.map((l) => l.libelle)).toEqual([
      'Périscolaire matin',
      'Périscolaire soir',
    ]);
  });

  it('nomme le champ fautif dans l’erreur (INV-01)', () => {
    expect(() => peri.calculerCoutMois({ nbMatins: -1, nbSoirs: 0 })).toThrow(
      'nbMatins',
    );
    expect(() => peri.calculerCoutMois({ nbMatins: 0, nbSoirs: -1 })).toThrow(
      'nbSoirs',
    );
  });
});
