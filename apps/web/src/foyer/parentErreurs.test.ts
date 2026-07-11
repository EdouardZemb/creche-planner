import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { messageErreurParent, retraduireErreurParent } from './parentErreurs';

/**
 * `messageErreurParent` traduit les 409 **structurés** de `svc-foyer` (relayés
 * corps compris par le BFF) en messages parent, par `code` machine. Un 409 sans
 * code retombe sur le message fusionné historique.
 */
describe('messageErreurParent', () => {
  it('EMAIL_DEJA_UTILISE → message e-mail déjà pris', () => {
    const err = new ApiError(409, {
      statusCode: 409,
      code: 'EMAIL_DEJA_UTILISE',
    });
    expect(messageErreurParent(err)).toBe(
      'Cette adresse e-mail est déjà utilisée par un autre parent.',
    );
  });

  it('PARENT_PRINCIPAL_EXISTANT → message contact principal', () => {
    const err = new ApiError(409, {
      statusCode: 409,
      code: 'PARENT_PRINCIPAL_EXISTANT',
    });
    expect(messageErreurParent(err)).toMatch(/contact principal existe déjà/i);
  });

  it('DERNIER_PARENT_ACTIF → message dernier parent', () => {
    const err = new ApiError(409, {
      statusCode: 409,
      code: 'DERNIER_PARENT_ACTIF',
    });
    expect(messageErreurParent(err)).toMatch(
      /Impossible de retirer le dernier parent/i,
    );
  });

  it('409 SANS code → repli fusionné (deux causes historiques)', () => {
    const err = new ApiError(409, { message: 'erreur du service amont' });
    expect(messageErreurParent(err)).toMatch(
      /déjà utilisée.*parent principal/i,
    );
  });

  it('autre statut → message standard (5xx = indisponibilité)', () => {
    const err = new ApiError(500, 'Internal');
    expect(messageErreurParent(err)).toMatch(/indisponible/i);
  });
});

describe('retraduireErreurParent (inchangé)', () => {
  it('réindexe parents.<i>.<champ> vers parent.<id>.<champ>', () => {
    expect(
      retraduireErreurParent(
        { champ: 'parents.0.email', message: 'invalide' },
        ['p1'],
      ),
    ).toEqual({ champ: 'parent.p1.email', message: 'invalide' });
  });
});
