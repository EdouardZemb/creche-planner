import { describe, expect, it } from 'vitest';
import { messageValidationHebdo } from './inbox.message.js';

describe('messageValidationHebdo', () => {
  it('un enfant : phrase au singulier avec le prénom et la semaine', () => {
    const m = messageValidationHebdo({ noms: ['Léa'], semaineIso: '2026-W27' });
    expect(m.sujet).toBe('Planning de la semaine 2026-W27 à valider');
    expect(m.corps).toBe(
      'Le planning de Léa pour la semaine 2026-W27 est à valider.',
    );
  });

  it('plusieurs enfants : énumération « A et B » au pluriel', () => {
    const m = messageValidationHebdo({
      noms: ['Léa', 'Tom'],
      semaineIso: '2026-W27',
    });
    expect(m.corps).toBe(
      'Les plannings de Léa et Tom pour la semaine 2026-W27 sont à valider.',
    );
  });

  it('trois enfants : « A, B et C »', () => {
    const m = messageValidationHebdo({
      noms: ['Léa', 'Tom', 'Zoé'],
      semaineIso: '2026-W27',
    });
    expect(m.corps).toContain('Léa, Tom et Zoé');
  });

  it('liste vide : corps générique (sans prénom)', () => {
    const m = messageValidationHebdo({ noms: [], semaineIso: '2026-W27' });
    expect(m.corps).toBe('Le planning de la semaine 2026-W27 est à valider.');
  });
});
