import { describe, expect, it } from 'vitest';
import { publierGrilleAbcmSchema } from './referentiel.dto.js';

/** Corps valide de référence (publication d'une grille ABCM T3). */
const GRILLE_VALIDE = {
  tranche: 3,
  valideDu: '2025-09-01',
  valideAu: '2026-08-31',
  cantineTotal: 12.68,
  periMatin: 2.5,
  periSoir: 4.62,
  alshJourneeComplete: 26.5,
  alshDemiJournee: 16.5,
  alshRepas: 5.5,
};

/**
 * AQ-04 (doc 27) — les bornes de validité d'une grille doivent être des dates
 * calendaires réelles, pas seulement la forme `\d{4}-\d{2}-\d{2}`.
 */
describe('publierGrilleAbcmSchema — dates calendaires (AQ-04)', () => {
  it('accepte une grille aux bornes valides (dont valideAu null)', () => {
    expect(publierGrilleAbcmSchema.safeParse(GRILLE_VALIDE).success).toBe(true);
    expect(
      publierGrilleAbcmSchema.safeParse({ ...GRILLE_VALIDE, valideAu: null })
        .success,
    ).toBe(true);
  });

  it('accepte un 29 février bissextile', () => {
    expect(
      publierGrilleAbcmSchema.safeParse({
        ...GRILLE_VALIDE,
        valideDu: '2024-02-29',
      }).success,
    ).toBe(true);
  });

  it.each([
    ['valideDu', '2026-13-45'],
    ['valideDu', '2026-02-30'],
    ['valideAu', '2023-02-29'],
    ['valideAu', '2026-12-32'],
  ])('rejette %s = « %s » (date non calendaire)', (champ, valeur) => {
    const resultat = publierGrilleAbcmSchema.safeParse({
      ...GRILLE_VALIDE,
      [champ]: valeur,
    });
    expect(resultat.success).toBe(false);
    if (!resultat.success) {
      expect(resultat.error.issues[0]?.path).toEqual([champ]);
    }
  });
});
