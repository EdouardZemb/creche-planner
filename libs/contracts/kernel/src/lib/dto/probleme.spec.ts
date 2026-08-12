import { describe, expect, it } from 'vitest';
import {
  CODES_PROBLEME,
  estCodeProbleme,
  MEDIA_TYPE_PROBLEME,
  problemeSchema,
  typeProbleme,
  type CodeProbleme,
} from './probleme.js';

describe('contrat Probleme (RFC 9457)', () => {
  it('accepte un problème minimal — les seuls membres exigés par la RFC', () => {
    expect(
      problemeSchema.parse({
        type: 'about:blank',
        title: 'Ressource introuvable',
        status: 404,
      }),
    ).toMatchObject({ status: 404 });
  });

  it('accepte les deux membres d’extension du produit (code, erreurs)', () => {
    const probleme = problemeSchema.parse({
      type: 'urn:probleme:creche-planner:email-deja-utilise',
      title: 'adresse e-mail déjà utilisée dans ce foyer',
      status: 409,
      code: 'EMAIL_DEJA_UTILISE',
      erreurs: [{ champ: 'email', message: 'déjà utilisée' }],
    });
    expect(probleme.code).toBe('EMAIL_DEJA_UTILISE');
    expect(probleme.erreurs).toHaveLength(1);
  });

  // Le `code` est ce que les écrans discriminent : un code hors registre les
  // ferait retomber silencieusement sur un message générique.
  it('refuse un code hors registre', () => {
    expect(
      problemeSchema.safeParse({
        type: 'about:blank',
        title: 'Conflit',
        status: 409,
        code: 'INVENTE_AILLEURS',
      }).success,
    ).toBe(false);
  });

  it('estCodeProbleme reconnaît le registre, et lui seul', () => {
    expect(estCodeProbleme('DERNIER_PARENT_ACTIF')).toBe(true);
    expect(estCodeProbleme('INVENTE_AILLEURS')).toBe(false);
    expect(estCodeProbleme(undefined)).toBe(false);
    expect(estCodeProbleme(409)).toBe(false);
  });

  // L'URI est DÉRIVÉE du code : aucune table à tenir en regard du registre,
  // donc aucune divergence possible entre les deux.
  it('dérive une URN stable et distincte pour chaque code du registre', () => {
    const codes = Object.keys(CODES_PROBLEME) as CodeProbleme[];
    const uris = codes.map(typeProbleme);

    expect(typeProbleme('PERIODE_CHEVAUCHANTE')).toBe(
      'urn:probleme:creche-planner:periode-chevauchante',
    );
    expect(new Set(uris).size).toBe(codes.length);
    expect(uris.every((uri) => uri.startsWith('urn:probleme:'))).toBe(true);
  });

  it('fige le type de média imposé par la RFC', () => {
    expect(MEDIA_TYPE_PROBLEME).toBe('application/problem+json');
  });
});
