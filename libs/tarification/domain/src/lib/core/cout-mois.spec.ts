import { describe, expect, it } from 'vitest';
import { Money, MontantNegatifError } from '@creche-planner/shared-kernel';
import { CoutMois, LigneDeCout } from './cout-mois.js';

describe('LigneDeCout', () => {
  it('crée une ligne de débit', () => {
    const ligne = LigneDeCout.debit('Mensualité', Money.depuisEuros(10));
    expect(ligne.libelle).toBe('Mensualité');
    expect(ligne.montant.centimes).toBe(1000);
    expect(ligne.sens).toBe('debit');
    expect(ligne.estCredit()).toBe(false);
  });

  it('crée une ligne de crédit (déduction)', () => {
    const ligne = LigneDeCout.credit('Déduction', Money.depuisEuros(3));
    expect(ligne.sens).toBe('credit');
    expect(ligne.estCredit()).toBe(true);
  });
});

describe('CoutMois', () => {
  it('somme les débits et soustrait les crédits', () => {
    const cout = new CoutMois([
      LigneDeCout.debit('Base', Money.depuisEuros(100)),
      LigneDeCout.debit('Complément', Money.depuisEuros(5)),
      LigneDeCout.credit('Déduction', Money.depuisEuros(20)),
    ]);
    expect(cout.total.centimes).toBe(8500);
  });

  it('est vide sans ligne et retourne un total nul', () => {
    const cout = new CoutMois([]);
    expect(cout.estVide()).toBe(true);
    expect(cout.total.estZero()).toBe(true);
  });

  it('signale un coût négatif (INV-06) quand les crédits dépassent les débits', () => {
    const cout = new CoutMois([
      LigneDeCout.debit('Base', Money.depuisEuros(10)),
      LigneDeCout.credit('Déduction', Money.depuisEuros(15)),
    ]);
    expect(() => cout.total).toThrow(MontantNegatifError);
  });
});

// Triage mutation AQ-13 (doc 27) : `estVide()` n'était asserté qu'à `true` —
// le mutant « return true » survivait alors que cout.service.ts s'appuie sur
// le cas non vide pour émettre la ligne de frais fixes.
describe('CoutMois.estVide — triage mutation AQ-13', () => {
  it('est faux dès qu’une ligne existe', () => {
    const cout = new CoutMois([
      LigneDeCout.debit('Mensualité', Money.depuisEuros(10)),
    ]);
    expect(cout.estVide()).toBe(false);
  });
});
