import { describe, expect, it } from 'vitest';
import {
  exigerEntierNonNegatif,
  exigerEntierStrictementPositif,
  exigerNombreNonNegatif,
} from './garde.js';
import { QuantiteInvalideError } from './tarification-error.js';

describe('gardes de saisie (INV-01)', () => {
  describe('exigerEntierNonNegatif', () => {
    it('accepte 0 et un entier positif', () => {
      expect(() => exigerEntierNonNegatif(0, 'n')).not.toThrow();
      expect(() => exigerEntierNonNegatif(16, 'n')).not.toThrow();
    });

    it('rejette un négatif ou un non-entier', () => {
      expect(() => exigerEntierNonNegatif(-1, 'n')).toThrow(
        QuantiteInvalideError,
      );
      expect(() => exigerEntierNonNegatif(2.5, 'n')).toThrow(
        QuantiteInvalideError,
      );
    });
  });

  describe('exigerEntierStrictementPositif', () => {
    it('accepte un entier ≥ 1', () => {
      expect(() => exigerEntierStrictementPositif(1, 'n')).not.toThrow();
    });

    it('rejette 0, un négatif ou un non-entier', () => {
      expect(() => exigerEntierStrictementPositif(0, 'n')).toThrow(
        QuantiteInvalideError,
      );
      expect(() => exigerEntierStrictementPositif(-3, 'n')).toThrow(
        QuantiteInvalideError,
      );
      expect(() => exigerEntierStrictementPositif(1.5, 'n')).toThrow(
        QuantiteInvalideError,
      );
    });
  });

  describe('exigerNombreNonNegatif', () => {
    it('accepte 0 et un décimal positif', () => {
      expect(() => exigerNombreNonNegatif(0, 'h')).not.toThrow();
      expect(() => exigerNombreNonNegatif(118.79, 'h')).not.toThrow();
    });

    it('rejette un négatif, NaN ou l’infini', () => {
      expect(() => exigerNombreNonNegatif(-0.1, 'h')).toThrow(
        QuantiteInvalideError,
      );
      expect(() => exigerNombreNonNegatif(Number.NaN, 'h')).toThrow(
        QuantiteInvalideError,
      );
      expect(() =>
        exigerNombreNonNegatif(Number.POSITIVE_INFINITY, 'h'),
      ).toThrow(QuantiteInvalideError);
    });
  });
});

// Triage mutation AQ-13 (doc 27) : le message porte le diagnostic (champ +
// valeur reçue) — des mutants StringLiteral y survivaient.
describe('messages d’erreur des gardes — triage mutation AQ-13', () => {
  it('nomment le champ fautif et la valeur reçue', () => {
    expect(() => exigerEntierNonNegatif(-1, 'nbJours')).toThrow(
      'nbJours doit être un entier ≥ 0 (reçu : -1)',
    );
    expect(() => exigerEntierStrictementPositif(0, 'nbMensualites')).toThrow(
      'nbMensualites doit être un entier ≥ 1 (reçu : 0)',
    );
    expect(() => exigerNombreNonNegatif(-0.1, 'heuresRealisees')).toThrow(
      'heuresRealisees doit être un nombre ≥ 0 (reçu : -0.1)',
    );
  });
});
