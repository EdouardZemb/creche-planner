import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ACTEUR_INCONNU } from './acteur.js';
import { acteurDeContexte } from './acteur.decorator.js';
import { AssertionIdentiteGuard } from './assertion-identite.guard.js';
import type { RequeteAssertable } from './assertion-identite.guard.js';
import { ENTETE_ASSERTION, signerAssertion } from './assertion-identite.js';
import type { Reflector } from '@nestjs/core';

const SECRET = 'secret-de-test-piste-audit';

function fakeContext(req: RequeteAssertable): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

/** Guard réel, configuré avec (ou sans) secret — c'est lui qui pose `req.assertion`. */
function guard(secret: string | undefined): AssertionIdentiteGuard {
  return new AssertionIdentiteGuard(
    { getAllAndOverride: () => undefined } as unknown as Reflector,
    { chargerConfig: () => ({ assertion: { secret, enforce: false } }) },
  );
}

describe('acteurDeContexte', () => {
  it("lit l'acteur que le guard d'assertion a réellement posé sur la requête", () => {
    // Chaîne complète : la gateway signe, le guard vérifie et pose `req.assertion`,
    // le décorateur lit. Aucun maillon n'est simulé — un test qui poserait
    // `req.assertion` à la main ne prouverait rien du fil (`LE-39`).
    const req: RequeteAssertable = {
      headers: {
        [ENTETE_ASSERTION]: signerAssertion(
          { email: 'claire@example.test' },
          SECRET,
        ),
      },
      method: 'PUT',
      originalUrl: '/foyers/1',
    };
    const ctx = fakeContext(req);
    expect(guard(SECRET).canActivate(ctx)).toBe(true);
    expect(acteurDeContexte(ctx)).toEqual({
      type: 'parent',
      email: 'claire@example.test',
    });
  });

  it('rend « inconnu » quand le guard a laissé passer sans assertion (observe-only)', () => {
    // En-tête absent, mode observe : le guard journalise et laisse passer. La
    // mutation aura donc lieu sans acteur établi — la piste doit le nommer.
    const ctx = fakeContext({ headers: {}, method: 'PUT', originalUrl: '/x' });
    expect(guard(SECRET).canActivate(ctx)).toBe(true);
    expect(acteurDeContexte(ctx)).toEqual(ACTEUR_INCONNU);
  });

  it('rend « inconnu » en mode legacy (aucun secret configuré)', () => {
    const ctx = fakeContext({ headers: {}, method: 'POST', originalUrl: '/x' });
    expect(guard(undefined).canActivate(ctx)).toBe(true);
    expect(acteurDeContexte(ctx)).toEqual(ACTEUR_INCONNU);
  });
});
