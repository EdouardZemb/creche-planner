import { describe, expect, it } from 'vitest';
import { messageValidationHebdo } from './inbox.message.js';

const FOYER_ID = '22222222-2222-4222-8222-222222222222';

describe('messageValidationHebdo', () => {
  it('un enfant : phrase au singulier avec le prénom et la semaine', () => {
    const m = messageValidationHebdo({
      foyerId: FOYER_ID,
      noms: ['Léa'],
      semaineIso: '2026-W27',
    });
    expect(m.sujet).toBe('Planning de la semaine 2026-W27 à valider');
    expect(m.corps).toBe(
      'Le planning de Léa pour la semaine 2026-W27 est à valider.',
    );
  });

  it('plusieurs enfants : énumération « A et B » au pluriel', () => {
    const m = messageValidationHebdo({
      foyerId: FOYER_ID,
      noms: ['Léa', 'Tom'],
      semaineIso: '2026-W27',
    });
    expect(m.corps).toBe(
      'Les plannings de Léa et Tom pour la semaine 2026-W27 sont à valider.',
    );
  });

  it('trois enfants : « A, B et C »', () => {
    const m = messageValidationHebdo({
      foyerId: FOYER_ID,
      noms: ['Léa', 'Tom', 'Zoé'],
      semaineIso: '2026-W27',
    });
    expect(m.corps).toContain('Léa, Tom et Zoé');
  });

  it('liste vide : corps générique (sans prénom)', () => {
    const m = messageValidationHebdo({
      foyerId: FOYER_ID,
      noms: [],
      semaineIso: '2026-W27',
    });
    expect(m.corps).toBe('Le planning de la semaine 2026-W27 est à valider.');
  });

  it('produit un lien profond relatif vers l’éditeur de la semaine du foyer', () => {
    const m = messageValidationHebdo({
      foyerId: FOYER_ID,
      noms: ['Léa'],
      semaineIso: '2026-W27',
    });
    // Chemin relatif (le web le rend tel quel, pas d'URL absolue en base).
    expect(m.lien).toBe(`/foyers/${FOYER_ID}/planning?semaine=2026-W27`);
  });
});
