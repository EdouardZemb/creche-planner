import { describe, expect, it } from 'vitest';
import { Money } from '@creche-planner/shared-kernel';
import { FraisFixesAbcm } from './frais-fixes-abcm.js';
import { QuantiteInvalideError } from '../core/tarification-error.js';

const fraisFixes = new FraisFixesAbcm();

describe('FraisFixesAbcm (doc 02 §4.4)', () => {
  it('CT-13 — cotisation annuelle 286 € rattachée à septembre', () => {
    const cout = fraisFixes.calculerCoutMois({ mois: 9, premiereAnnee: false });
    expect(cout.total.centimes).toBe(28600);
  });

  it('CT-14 — septembre 2026 (1ère année) : cotisation + 1ère inscription = 436 €', () => {
    const cout = fraisFixes.calculerCoutMois({ mois: 9, premiereAnnee: true });
    expect(cout.total.centimes).toBe(43600);
  });

  it('ne facture aucun frais fixe hors septembre', () => {
    const cout = fraisFixes.calculerCoutMois({ mois: 6, premiereAnnee: true });
    expect(cout.estVide()).toBe(true);
    expect(cout.total.estZero()).toBe(true);
  });

  it('rejette un mois hors plage 1–12', () => {
    expect(() =>
      fraisFixes.calculerCoutMois({ mois: 0, premiereAnnee: false }),
    ).toThrow(QuantiteInvalideError);
    expect(() =>
      fraisFixes.calculerCoutMois({ mois: 13, premiereAnnee: false }),
    ).toThrow(QuantiteInvalideError);
    expect(() =>
      fraisFixes.calculerCoutMois({ mois: 9.5, premiereAnnee: false }),
    ).toThrow(QuantiteInvalideError);
  });

  it('accepte des montants configurés (ex. cotisation 2 enfants = 473 €)', () => {
    const frais = new FraisFixesAbcm({
      cotisationAnnuelle: Money.depuisEuros(473),
      fraisPremiereInscription: Money.depuisEuros(150),
    });
    expect(
      frais.calculerCoutMois({ mois: 9, premiereAnnee: false }).total.centimes,
    ).toBe(47300);
    expect(frais.mode).toBe('FRAIS_FIXES_ABCM');
  });
});

// Triage mutation AQ-13 (doc 27) : message hors plage et libellés des deux
// lignes de frais n'étaient pas assertés.
describe('FraisFixesAbcm — triage mutation AQ-13', () => {
  it('explicite le mois reçu dans l’erreur hors plage', () => {
    expect(() =>
      fraisFixes.calculerCoutMois({ mois: 13, premiereAnnee: false }),
    ).toThrow('mois calendaire hors plage 1–12 (reçu : 13)');
  });

  it('libelle cotisation et frais de 1ère inscription', () => {
    const cout = fraisFixes.calculerCoutMois({ mois: 9, premiereAnnee: true });
    expect(cout.lignes.map((l) => l.libelle)).toEqual([
      'Cotisation annuelle ABCM',
      'Frais de 1ère inscription',
    ]);
  });
});
