import { describe, expect, it } from 'vitest';
import { Money } from '@creche-planner/shared-kernel';
import { UnitesAssociativesAbcm } from './unites-associatives-abcm.js';
import { QuantiteInvalideError } from '../core/tarification-error.js';

const ua = new UnitesAssociativesAbcm();

describe('UnitesAssociativesAbcm (doc 02 §4.5)', () => {
  it('CT-15 — 14 h réalisées sur 20 ⇒ 6 × 31,25 = 187,50 €', () => {
    expect(ua.calculerCoutMois({ heuresRealisees: 14 }).total.centimes).toBe(
      18750,
    );
  });

  it('CT-16 — 20 h réalisées ⇒ 0 € (caution rendue)', () => {
    const cout = ua.calculerCoutMois({ heuresRealisees: 20 });
    expect(cout.estVide()).toBe(true);
    expect(cout.total.estZero()).toBe(true);
  });

  it('plafonne à 0 € au-delà du quota réalisé', () => {
    expect(ua.calculerCoutMois({ heuresRealisees: 25 }).total.estZero()).toBe(
      true,
    );
  });

  it('rejette des heures réalisées négatives (INV-01)', () => {
    expect(() => ua.calculerCoutMois({ heuresRealisees: -1 })).toThrow(
      QuantiteInvalideError,
    );
  });

  it('accepte un quota et une valeur d’UA configurés', () => {
    const variante = new UnitesAssociativesAbcm({
      quotaHeures: 10,
      valeurUa: Money.depuisEuros(31.25),
    });
    // (10 − 4) × 31,25 = 187,50 €
    expect(
      variante.calculerCoutMois({ heuresRealisees: 4 }).total.centimes,
    ).toBe(18750);
    expect(variante.mode).toBe('UNITES_ASSOCIATIVES');
  });
});

// Triage mutation AQ-13 (doc 27) : champ fautif non asserté.
describe('UnitesAssociativesAbcm — triage mutation AQ-13', () => {
  it('nomme le champ fautif dans l’erreur (INV-01)', () => {
    expect(() => ua.calculerCoutMois({ heuresRealisees: -1 })).toThrow(
      'heuresRealisees',
    );
  });
});
