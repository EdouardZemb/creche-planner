import { describe, expect, it } from 'vitest';
import { libelleSemaineFr } from './libelle-semaine.js';

describe('libelleSemaineFr', () => {
  it('semaine intra-mois : mois affiché une seule fois, année de fin', () => {
    // 2026-W26 : lundi 22 juin → dimanche 28 juin (même mois).
    expect(libelleSemaineFr('2026-W26')).toBe('semaine du 22 au 28 juin 2026');
  });

  it('semaine à cheval sur deux mois : mois de début ET de fin', () => {
    // 2026-W27 : lundi 29 juin → dimanche 5 juillet.
    expect(libelleSemaineFr('2026-W27')).toBe(
      'semaine du 29 juin au 5 juillet 2026',
    );
  });

  it('semaine à cheval sur deux années : année de la borne de fin', () => {
    // 2026-W01 : lundi 29 décembre 2025 → dimanche 4 janvier 2026.
    expect(libelleSemaineFr('2026-W01')).toBe(
      'semaine du 29 décembre au 4 janvier 2026',
    );
  });

  it('n’affiche jamais le numéro de semaine ISO (jargon)', () => {
    expect(libelleSemaineFr('2026-W27')).not.toMatch(/\d{4}-W\d{2}/);
  });

  it('repli sur la chaîne brute si la forme n’est pas YYYY-Www', () => {
    expect(libelleSemaineFr('pas-une-semaine')).toBe('pas-une-semaine');
  });
});
