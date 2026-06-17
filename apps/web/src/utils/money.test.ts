import { describe, it, expect } from 'vitest';
import { centimesEnEuros, deltaEnEuros, sensDelta, repereDelta } from './money';

describe('money — formatage (inchangé)', () => {
  it('formate des centimes en euros fr-FR', () => {
    expect(centimesEnEuros(123456)).toMatch(/1\s?234,56\s?€/);
  });

  it('préfixe le delta positif par « + » (UT-09 CA1)', () => {
    expect(deltaEnEuros(1230)).toMatch(/^\+/);
  });

  it('conserve le « - » du delta négatif (UT-09 CA1)', () => {
    expect(deltaEnEuros(-400)).toMatch(/^-/);
  });

  it("n'ajoute aucun signe au delta nul", () => {
    const s = deltaEnEuros(0);
    expect(s.startsWith('+')).toBe(false);
    expect(s.startsWith('-')).toBe(false);
  });
});

describe('sensDelta (UT-09)', () => {
  it('classe un delta négatif en économie', () => {
    expect(sensDelta(-50)).toBe('economie');
  });

  it('classe un delta positif en dépassement', () => {
    expect(sensDelta(50)).toBe('depassement');
  });

  it('classe un delta nul en égalité', () => {
    expect(sensDelta(0)).toBe('egalite');
  });
});

describe('repereDelta — repère NON COLORÉ (UT-09 CA2)', () => {
  it('rend un symbole et un libellé pour une économie', () => {
    const r = repereDelta(-50);
    expect(r.symbole).toBe('▼');
    expect(r.libelle).toBe('économie');
  });

  it('rend un symbole et un libellé pour un dépassement', () => {
    const r = repereDelta(50);
    expect(r.symbole).toBe('▲');
    expect(r.libelle).toBe('dépassement');
  });

  it("rend un repère explicite pour le cas d'égalité (pas de couleur seule)", () => {
    const r = repereDelta(0);
    expect(r.symbole).toBe('=');
    expect(r.libelle).toBe('identique');
  });
});
