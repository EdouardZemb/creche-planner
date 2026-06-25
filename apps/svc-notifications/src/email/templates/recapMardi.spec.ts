import { describe, expect, it } from 'vitest';
import { recapMardi } from './recapMardi.js';

const BASE = {
  enfant: 'Léa',
  semaineIso: '2026-W27',
  lienApp: 'https://app.example.org/planning?semaine=2026-W27',
} as const;

describe('recapMardi', () => {
  it('rend le sujet « Valider le planning de la semaine … » et le lien', () => {
    const message = recapMardi({
      ...BASE,
      etablissementLibelle: 'Crèche Les Hirondelles',
      preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
    });

    expect(message.subject).toBe('Valider le planning de la semaine 2026-W27');
    expect(message.html).toContain(`href="${BASE.lienApp}"`);
    expect(message.html).toContain('2026-W27');
    expect(message.text).toContain(BASE.lienApp);
    expect(message.text).toContain('Léa');
  });

  it('rappelle le préavis en jours ouvrés (crèche, RM-03)', () => {
    const message = recapMardi({
      ...BASE,
      etablissementLibelle: 'Crèche Les Hirondelles',
      preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
    });

    expect(message.text).toContain('2 jours ouvrés');
    expect(message.text).toContain('Crèche Les Hirondelles');
  });

  it('rappelle le préavis jour+heure (ABCM, RM-07)', () => {
    const message = recapMardi({
      ...BASE,
      etablissementLibelle: 'École ABCM',
      preavisRegle: { type: 'JOUR_HEURE', jour: 'JEUDI', heure: '12:00' },
    });

    expect(message.text).toContain('avant jeudi 12:00');
    expect(message.text).toContain('École ABCM');
  });

  it('omet la ligne de préavis quand l’établissement n’est pas résolu', () => {
    const message = recapMardi({
      ...BASE,
      etablissementLibelle: null,
      preavisRegle: null,
    });

    expect(message.text).not.toContain('Pensez à signaler');
    expect(message.html).not.toContain('Pensez à signaler');
  });

  it('échappe le prénom dans le HTML (anti-injection)', () => {
    const message = recapMardi({
      ...BASE,
      enfant: '<b>x</b>',
      etablissementLibelle: null,
      preavisRegle: null,
    });

    expect(message.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(message.html).not.toContain('<b>x</b>');
  });

  it('accorde « 1 jour ouvré » au singulier', () => {
    const message = recapMardi({
      ...BASE,
      etablissementLibelle: 'Crèche',
      preavisRegle: { type: 'JOURS_OUVRES', valeur: 1 },
    });

    expect(message.text).toContain('1 jour ouvré');
    expect(message.text).not.toContain('1 jours');
  });
});
