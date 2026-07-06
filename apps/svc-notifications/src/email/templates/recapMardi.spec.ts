import { describe, expect, it } from 'vitest';
import { recapMardi, type RecapMardiEnfant } from './recapMardi.js';

const SEMAINE = '2026-W27';
// Lien profond réparé : préfixe `/foyers/:foyerId` (la route `/planning?semaine=` seule
// était introuvable côté front). Le foyerId est câblé par le scheduler à l'envoi.
const FOYER_ID = '22222222-2222-4222-8222-222222222222';
const LIEN = `https://app.example.org/foyers/${FOYER_ID}/planning?semaine=2026-W27`;

function enfant(partiel: Partial<RecapMardiEnfant> = {}): RecapMardiEnfant {
  return {
    enfant: 'Léa',
    etablissementLibelle: 'Crèche Les Hirondelles',
    preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
    ...partiel,
  };
}

function rendre(enfants: RecapMardiEnfant[]) {
  return recapMardi({ enfants, semaineIso: SEMAINE, lienApp: LIEN });
}

describe('recapMardi', () => {
  it('rend le sujet « Valider le planning de la semaine … » et le lien', () => {
    const message = rendre([enfant()]);

    expect(message.subject).toBe('Valider le planning de la semaine 2026-W27');
    expect(message.html).toContain(`href="${LIEN}"`);
    expect(message.html).toContain('2026-W27');
    expect(message.text).toContain(LIEN);
    expect(message.text).toContain('Léa');
    // Le lien pointe bien vers l'éditeur de la semaine du foyer (route existante).
    expect(message.text).toMatch(
      /\/foyers\/[0-9a-f-]+\/planning\?semaine=2026-W27/,
    );
  });

  it('un seul enfant : phrase au singulier', () => {
    const message = rendre([enfant({ enfant: 'Léa' })]);

    expect(message.text).toContain(
      'Le planning de Léa pour la semaine 2026-W27 est à valider.',
    );
    expect(message.text).not.toContain('Les plannings');
  });

  it('plusieurs enfants : un seul mail les énumère au pluriel', () => {
    const message = rendre([
      enfant({ enfant: 'Léa' }),
      enfant({ enfant: 'Tom' }),
      enfant({ enfant: 'Zoé' }),
    ]);

    expect(message.text).toContain(
      'Les plannings de Léa, Tom et Zoé pour la semaine 2026-W27 sont à valider.',
    );
    expect(message.html).toContain('<strong>Léa</strong>');
    expect(message.html).toContain('<strong>Tom</strong>');
    expect(message.html).toContain('<strong>Zoé</strong>');
  });

  it('rappelle le préavis en jours ouvrés (crèche, RM-03)', () => {
    const message = rendre([
      enfant({ preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 } }),
    ]);

    expect(message.text).toContain('2 jours ouvrés');
    expect(message.text).toContain('Crèche Les Hirondelles');
  });

  it('rappelle le préavis jour+heure (ABCM, RM-07)', () => {
    const message = rendre([
      enfant({
        enfant: 'Tom',
        etablissementLibelle: 'École ABCM',
        preavisRegle: { type: 'JOUR_HEURE', jour: 'JEUDI', heure: '12:00' },
      }),
    ]);

    expect(message.text).toContain('avant jeudi 12:00');
    expect(message.text).toContain('École ABCM');
  });

  it('dédupe les rappels de préavis identiques (deux enfants même crèche)', () => {
    const message = rendre([
      enfant({ enfant: 'Léa' }),
      enfant({ enfant: 'Tom' }),
    ]);

    const occurrences = message.text.split('2 jours ouvrés').length - 1;
    expect(occurrences).toBe(1);
  });

  it('cumule des préavis distincts (crèche + ABCM dans le même foyer)', () => {
    const message = rendre([
      enfant({ enfant: 'Léa' }),
      enfant({
        enfant: 'Tom',
        etablissementLibelle: 'École ABCM',
        preavisRegle: { type: 'JOUR_HEURE', jour: 'JEUDI', heure: '12:00' },
      }),
    ]);

    expect(message.text).toContain('2 jours ouvrés');
    expect(message.text).toContain('avant jeudi 12:00');
  });

  it('omet la ligne de préavis quand l’établissement n’est pas résolu', () => {
    const message = rendre([
      enfant({ etablissementLibelle: null, preavisRegle: null }),
    ]);

    expect(message.text).not.toContain('Pensez à signaler');
    expect(message.html).not.toContain('Pensez à signaler');
  });

  it('échappe le prénom dans le HTML (anti-injection)', () => {
    const message = rendre([
      enfant({
        enfant: '<b>x</b>',
        etablissementLibelle: null,
        preavisRegle: null,
      }),
    ]);

    expect(message.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(message.html).not.toContain('<b>x</b>');
  });

  it('accorde « 1 jour ouvré » au singulier', () => {
    const message = rendre([
      enfant({
        etablissementLibelle: 'Crèche',
        preavisRegle: { type: 'JOURS_OUVRES', valeur: 1 },
      }),
    ]);

    expect(message.text).toContain('1 jour ouvré');
    expect(message.text).not.toContain('1 jours');
  });
});
