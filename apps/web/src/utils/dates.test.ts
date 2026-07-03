import { describe, it, expect } from 'vitest';
import { formaterDateFr, formaterDateCourtFr, libelleSemaine } from './dates';

describe('formaterDateFr', () => {
  it('formate une date ISO en jj/mm/aaaa', () => {
    expect(formaterDateFr('2026-06-15')).toBe('15/06/2026');
  });

  it('zéro-pad le jour et le mois', () => {
    expect(formaterDateFr('2026-01-05')).toBe('05/01/2026');
  });
});

describe('formaterDateCourtFr', () => {
  it('formate une date ISO en jj/mm (sans année, affichage mobile)', () => {
    expect(formaterDateCourtFr('2026-06-15')).toBe('15/06');
  });

  it('zéro-pad le jour et le mois', () => {
    expect(formaterDateCourtFr('2026-01-05')).toBe('05/01');
  });
});

describe('libelleSemaine', () => {
  it('rend la semaine en dates réelles, mois unique en fin (parler parent)', () => {
    expect(libelleSemaine('2026-W28')).toBe('semaine du 6 au 12 juillet');
  });

  it('répète le mois quand la semaine en chevauche deux', () => {
    expect(libelleSemaine('2026-W27')).toBe('semaine du 29 juin au 5 juillet');
  });

  it('précise les années quand la semaine est à cheval sur deux années', () => {
    expect(libelleSemaine('2026-W01')).toBe(
      'semaine du 29 décembre 2025 au 4 janvier 2026',
    );
  });

  it('dit « 1er » pour le premier jour du mois', () => {
    // 2027-W22 : lundi 31 mai → dimanche 6 juin 2027.
    expect(libelleSemaine('2027-W22')).toBe('semaine du 31 mai au 6 juin');
    // 2026-W23 : lundi 1er juin → dimanche 7 juin 2026.
    expect(libelleSemaine('2026-W23')).toBe('semaine du 1er au 7 juin');
  });

  it("replie sur la chaîne brute si le format n'est pas YYYY-Www", () => {
    expect(libelleSemaine('n-importe-quoi')).toBe('n-importe-quoi');
    expect(libelleSemaine('2026-W60')).toBe('2026-W60');
  });
});
