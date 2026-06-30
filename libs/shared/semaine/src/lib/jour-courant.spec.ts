import { describe, it, expect } from 'vitest';
import { jourCourantParis } from './jour-courant.js';

describe('jourCourantParis', () => {
  it('renvoie le jour Paris d’un instant UTC en pleine journée', () => {
    expect(jourCourantParis(new Date('2026-06-30T10:00:00Z'))).toBe(
      '2026-06-30',
    );
  });

  it('bascule au lendemain : 23:30 UTC = déjà le jour suivant à Paris (été, UTC+2)', () => {
    // 2026-06-30T23:30Z → 2026-07-01 01:30 à Paris.
    expect(jourCourantParis(new Date('2026-06-30T23:30:00Z'))).toBe(
      '2026-07-01',
    );
  });

  it('avant minuit Paris : 21:30 UTC reste le même jour (été, UTC+2)', () => {
    // 2026-06-30T21:30Z → 2026-06-30 23:30 à Paris.
    expect(jourCourantParis(new Date('2026-06-30T21:30:00Z'))).toBe(
      '2026-06-30',
    );
  });

  it('hiver (UTC+1) : minuit UTC est déjà le jour suivant à Paris', () => {
    // 2026-01-15T23:30Z → 2026-01-16 00:30 à Paris.
    expect(jourCourantParis(new Date('2026-01-15T23:30:00Z'))).toBe(
      '2026-01-16',
    );
  });

  it('DST printemps : avant le saut d’heure (UTC+1) puis après (UTC+2)', () => {
    // Bascule été 2026 : dimanche 29 mars 02:00 → 03:00 (Europe/Paris).
    // 00:30 UTC le 29/03 = 01:30 Paris (encore UTC+1) → 29/03.
    expect(jourCourantParis(new Date('2026-03-29T00:30:00Z'))).toBe(
      '2026-03-29',
    );
    // 12:00 UTC le 29/03 = 14:00 Paris (UTC+2) → toujours 29/03.
    expect(jourCourantParis(new Date('2026-03-29T12:00:00Z'))).toBe(
      '2026-03-29',
    );
  });

  it('DST automne : la fin de l’heure d’été (UTC+2 → UTC+1) ne décale pas le jour', () => {
    // Bascule hiver 2026 : dimanche 25 octobre 03:00 → 02:00 (Europe/Paris).
    // 22:30 UTC le 25/10 = 23:30 Paris (déjà repassé en UTC+1) → 25/10.
    expect(jourCourantParis(new Date('2026-10-25T22:30:00Z'))).toBe(
      '2026-10-25',
    );
    // 23:30 UTC le 25/10 = 00:30 Paris le 26/10 → bascule au lendemain.
    expect(jourCourantParis(new Date('2026-10-25T23:30:00Z'))).toBe(
      '2026-10-26',
    );
  });

  it('bord d’année : 31 décembre 23:30 UTC = 1ᵉʳ janvier à Paris (UTC+1)', () => {
    // 2025-12-31T23:30Z → 2026-01-01 00:30 à Paris.
    expect(jourCourantParis(new Date('2025-12-31T23:30:00Z'))).toBe(
      '2026-01-01',
    );
  });

  it('zéro-padding du mois et du jour à un chiffre', () => {
    expect(jourCourantParis(new Date('2026-02-05T12:00:00Z'))).toBe(
      '2026-02-05',
    );
  });
});
