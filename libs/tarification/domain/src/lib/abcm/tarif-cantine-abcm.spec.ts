import { describe, expect, it } from 'vitest';
import { Tranche } from '@creche-planner/shared-kernel';
import { GrilleAbcm } from './grille-abcm.js';
import { TarifCantineAbcm } from './tarif-cantine-abcm.js';
import { QuantiteInvalideError } from '../core/tarification-error.js';

const cantine = new TarifCantineAbcm(GrilleAbcm.pour(Tranche.T3));

describe('TarifCantineAbcm (doc 02 §4.1)', () => {
  it('CT-10 — 16 jours × 12,68 € = 202,88 €', () => {
    expect(cantine.calculerCoutMois({ nbJours: 16 }).total.centimes).toBe(
      20288,
    );
  });

  it('CT-17 — réservé = facturé : 16 jours réservés facturés intégralement', () => {
    // Aucune notion de présence : la facturation porte sur les jours réservés.
    expect(cantine.calculerCoutMois({ nbJours: 16 }).total.centimes).toBe(
      20288,
    );
  });

  it('CT-18 — PAI panier-repas : 16 jours × 8,01 € (part garde) = 128,16 €', () => {
    expect(
      cantine.calculerCoutMois({ nbJours: 16, pai: true }).total.centimes,
    ).toBe(12816);
  });

  it('rejette un nombre de jours invalide (INV-01)', () => {
    expect(() => cantine.calculerCoutMois({ nbJours: -1 })).toThrow(
      QuantiteInvalideError,
    );
  });

  it('porte le mode CANTINE', () => {
    expect(cantine.mode).toBe('CANTINE');
  });
});

// Triage mutation AQ-13 (doc 27) : champ fautif non asserté.
describe('TarifCantineAbcm — triage mutation AQ-13', () => {
  it('nomme le champ fautif dans l’erreur (INV-01)', () => {
    expect(() => cantine.calculerCoutMois({ nbJours: -1 })).toThrow('nbJours');
  });
});
