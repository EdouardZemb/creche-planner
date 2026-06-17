import { describe, expect, it } from 'vitest';
import { DomainError, MontantNegatifError } from './domain-error.js';

describe('DomainError', () => {
  it('est une Error standard dont héritent les erreurs de domaine typées', () => {
    const erreur = new MontantNegatifError('montant négatif: -1');
    expect(erreur).toBeInstanceOf(Error);
    expect(erreur).toBeInstanceOf(DomainError);
    expect(erreur).toBeInstanceOf(MontantNegatifError);
  });

  it('porte le nom de la sous-classe et le message', () => {
    const erreur = new MontantNegatifError('montant négatif: -1');
    expect(erreur.name).toBe('MontantNegatifError');
    expect(erreur.message).toBe('montant négatif: -1');
  });
});
