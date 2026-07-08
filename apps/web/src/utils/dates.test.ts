import { describe, it, expect } from 'vitest';
import {
  dateLongueFr,
  formaterDateFr,
  formaterDateCourtFr,
  formaterHeureFr,
  jourSuivant,
  libelleDate,
  libelleSemaine,
} from './dates';

describe('jourSuivant', () => {
  it('avance d’un jour au sein du mois', () => {
    expect(jourSuivant('2026-07-04')).toBe('2026-07-05');
  });

  it('franchit la fin de mois', () => {
    expect(jourSuivant('2026-07-31')).toBe('2026-08-01');
  });

  it('franchit la fin d’année', () => {
    expect(jourSuivant('2026-12-31')).toBe('2027-01-01');
  });

  it('respecte le 29 février des années bissextiles', () => {
    expect(jourSuivant('2028-02-28')).toBe('2028-02-29');
    expect(jourSuivant('2027-02-28')).toBe('2027-03-01');
  });
});

describe('formaterHeureFr', () => {
  it('formate l’heure locale en hh:mm', () => {
    expect(formaterHeureFr(new Date(2026, 6, 3, 21, 43, 12))).toBe('21:43');
  });

  it('zéro-pad les heures et les minutes', () => {
    expect(formaterHeureFr(new Date(2026, 6, 3, 9, 5))).toBe('09:05');
  });
});

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

describe('libelleDate', () => {
  it('rend une date en mots de parent : jour nommé + date réelle, sans année', () => {
    expect(libelleDate('2026-07-06')).toBe('lundi 6 juillet');
  });

  it('dit « 1er » pour le premier jour du mois', () => {
    expect(libelleDate('2026-08-01')).toBe('samedi 1er août');
  });
});

describe('dateLongueFr', () => {
  it('rend une date longue : jour nommé + quantième en chiffres + mois', () => {
    // 2026-07-01 = mercredi ; quantième « 1 » (et non « 1er »).
    expect(dateLongueFr('2026-07-01')).toBe('mercredi 1 juillet');
    expect(dateLongueFr('2026-06-29')).toBe('lundi 29 juin');
  });

  it('ne décale pas le jour quel que soit le fuseau (formatage UTC)', () => {
    // Une date « minuit » mal formatée basculerait sur la veille en fuseau négatif.
    expect(dateLongueFr('2026-07-01')).not.toContain('30 juin');
  });

  it('replie sur la chaîne brute si le format n’est pas YYYY-MM-DD', () => {
    expect(dateLongueFr('pas-une-date')).toBe('pas-une-date');
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
