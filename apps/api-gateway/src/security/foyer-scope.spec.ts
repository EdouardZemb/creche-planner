import { describe, expect, it } from 'vitest';
import { extraireRefFoyer } from './foyer-scope.js';
import type { RequeteIdentifiable } from './identite.js';

/**
 * `extraireRefFoyer` est l'extraction **pure** du foyer ciblé déclarée par
 * `@FoyerScope(...)` : param / query / corps livrent un foyerId direct, `contrat:`
 * livre un contratId à résoudre. Valeur absente/vide ⇒ `undefined` (le guard
 * laisse alors passer plutôt que de casser une route mal annotée).
 */
function req(p: Partial<RequeteIdentifiable> = {}): RequeteIdentifiable {
  return { headers: {}, ...p };
}

describe('extraireRefFoyer', () => {
  it('param:id → foyerId direct (route /foyers/:id)', () => {
    expect(
      extraireRefFoyer('param:id', req({ params: { id: 'f-9' } })),
    ).toEqual({ kind: 'foyer', valeur: 'f-9' });
  });

  it('param:foyerId → foyerId direct (routes notifications)', () => {
    expect(
      extraireRefFoyer('param:foyerId', req({ params: { foyerId: 'f-7' } })),
    ).toEqual({ kind: 'foyer', valeur: 'f-7' });
  });

  it('query:foyer → foyerId direct (contrats, coûts)', () => {
    expect(
      extraireRefFoyer('query:foyer', req({ query: { foyer: 'f-1' } })),
    ).toEqual({ kind: 'foyer', valeur: 'f-1' });
  });

  it('body:foyerId → foyerId direct (POST contrats, envois)', () => {
    expect(
      extraireRefFoyer('body:foyerId', req({ body: { foyerId: 'f-2' } })),
    ).toEqual({ kind: 'foyer', valeur: 'f-2' });
  });

  it('contrat:id → contratId à résoudre (route /contrats/:id)', () => {
    expect(
      extraireRefFoyer('contrat:id', req({ params: { id: 'c-7' } })),
    ).toEqual({ kind: 'contrat', valeur: 'c-7' });
  });

  it('contrat:contratId → contratId à résoudre (route /validations/:contratId)', () => {
    expect(
      extraireRefFoyer(
        'contrat:contratId',
        req({ params: { contratId: 'c-3' } }),
      ),
    ).toEqual({ kind: 'contrat', valeur: 'c-3' });
  });

  it('valeur absente → undefined', () => {
    expect(extraireRefFoyer('query:foyer', req())).toBeUndefined();
    expect(extraireRefFoyer('param:id', req({ params: {} }))).toBeUndefined();
    expect(extraireRefFoyer('body:foyerId', req({ body: {} }))).toBeUndefined();
  });

  it('valeur vide ou blanche → undefined', () => {
    expect(
      extraireRefFoyer('query:foyer', req({ query: { foyer: '   ' } })),
    ).toBeUndefined();
  });

  it('query non-chaîne (tableau) → undefined', () => {
    expect(
      extraireRefFoyer('query:foyer', req({ query: { foyer: ['a', 'b'] } })),
    ).toBeUndefined();
  });
});
