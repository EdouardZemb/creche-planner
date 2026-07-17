import {
  type ExecutionContext,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { type Reflector } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENTETE_ASSERTION, signerAssertion } from './assertion-identite.js';
import {
  AssertionIdentiteGuard,
  type RequeteAssertable,
} from './assertion-identite.guard.js';
import { type ConfigAssertion } from './assertion-identite.options.js';

const SECRET = 'secret-guard-test';

/** Faux Reflector : la route est publique (exemptée) ou non. */
function fakeReflector(publique: boolean): Reflector {
  return { getAllAndOverride: () => publique } as unknown as Reflector;
}

function fakeContext(req: RequeteAssertable): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function requete(p: Partial<RequeteAssertable> = {}): RequeteAssertable {
  return { headers: {}, method: 'GET', originalUrl: '/api/couts', ...p };
}

/** Construit un guard avec la config assertion fournie. */
function guardAvec(
  assertion: ConfigAssertion,
  publique = false,
): AssertionIdentiteGuard {
  return new AssertionIdentiteGuard(fakeReflector(publique), {
    chargerConfig: () => ({ assertion }),
  });
}

/** En-têtes portant une assertion machine valide signée avec `SECRET`. */
function entetesValides(): Record<string, string> {
  return {
    [ENTETE_ASSERTION]: signerAssertion({ machine: 'api-gateway' }, SECRET),
  };
}

describe('AssertionIdentiteGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('mode legacy (secret absent)', () => {
    it('passe sans vérifier et journalise un debug UNIQUE', () => {
      const debug = vi.spyOn(Logger.prototype, 'debug');
      const guard = guardAvec({ secret: undefined, enforce: false });
      expect(guard.canActivate(fakeContext(requete()))).toBe(true);
      expect(guard.canActivate(fakeContext(requete()))).toBe(true);
      // Debug unique malgré deux requêtes.
      expect(debug).toHaveBeenCalledOnce();
    });
  });

  describe('mode observe (secret présent, enforce off)', () => {
    it('en-tête valide → passe et pose req.assertion', () => {
      const guard = guardAvec({ secret: SECRET, enforce: false });
      const req = requete({ headers: entetesValides() });
      expect(guard.canActivate(fakeContext(req))).toBe(true);
      expect(req.assertion?.machine).toBe('api-gateway');
    });

    it('en-tête absent → journalise « AURAIT REFUSÉ » et passe', () => {
      const warn = vi.spyOn(Logger.prototype, 'warn');
      const guard = guardAvec({ secret: SECRET, enforce: false });
      const req = requete({ method: 'POST', originalUrl: '/api/foyers' });
      expect(guard.canActivate(fakeContext(req))).toBe(true);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toMatch(
        /AURAIT REFUSÉ.*POST \/api\/foyers/,
      );
      expect(req.assertion).toBeUndefined();
    });

    it('en-tête invalide → journalise « AURAIT REFUSÉ » et passe', () => {
      const warn = vi.spyOn(Logger.prototype, 'warn');
      const guard = guardAvec({ secret: SECRET, enforce: false });
      const req = requete({ headers: { [ENTETE_ASSERTION]: 'jeton.bidon' } });
      expect(guard.canActivate(fakeContext(req))).toBe(true);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toMatch(/AURAIT REFUSÉ/);
    });

    it('assertion signée par un autre secret → « AURAIT REFUSÉ » et passe', () => {
      const warn = vi.spyOn(Logger.prototype, 'warn');
      const guard = guardAvec({ secret: SECRET, enforce: false });
      const req = requete({
        headers: {
          [ENTETE_ASSERTION]: signerAssertion(
            { machine: 'x' },
            'mauvais-secret',
          ),
        },
      });
      expect(guard.canActivate(fakeContext(req))).toBe(true);
      expect(warn).toHaveBeenCalledOnce();
    });
  });

  describe('mode enforce (INTERSERVICE_AUTHZ_ENFORCE=1)', () => {
    it('en-tête valide → passe et pose req.assertion', () => {
      const guard = guardAvec({ secret: SECRET, enforce: true });
      const req = requete({ headers: entetesValides() });
      expect(guard.canActivate(fakeContext(req))).toBe(true);
      expect(req.assertion?.machine).toBe('api-gateway');
    });

    it('en-tête absent → 401 (UnauthorizedException)', () => {
      const guard = guardAvec({ secret: SECRET, enforce: true });
      expect(() => guard.canActivate(fakeContext(requete()))).toThrow(
        UnauthorizedException,
      );
    });

    it('en-tête invalide/expiré → 401', () => {
      const guard = guardAvec({ secret: SECRET, enforce: true });
      const req = requete({ headers: { [ENTETE_ASSERTION]: 'x.y' } });
      expect(() => guard.canActivate(fakeContext(req))).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('exemptions', () => {
    it('route publique (@AssertionPubliqueInterServices) → passe sans en-tête même en enforce', () => {
      const guard = guardAvec({ secret: SECRET, enforce: true }, true);
      expect(guard.canActivate(fakeContext(requete()))).toBe(true);
    });
  });
});
