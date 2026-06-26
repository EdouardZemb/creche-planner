import {
  type ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { type Reflector } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminGuard } from './admin.guard.js';
import { type RequeteIdentifiable } from './identite.js';

/** Faux Reflector renvoyant un `adminSeulement` fixe pour `getAllAndOverride`. */
function fakeReflector(adminSeulement: boolean): Reflector {
  return { getAllAndOverride: () => adminSeulement } as unknown as Reflector;
}

function fakeContext(req: RequeteIdentifiable): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function requete(p: Partial<RequeteIdentifiable> = {}): RequeteIdentifiable {
  return { headers: {}, ...p };
}

describe('AdminGuard (PR6, option b-ii)', () => {
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
    delete process.env['ADMIN_EMAILS'];
  });

  afterEach(() => {
    process.env = envInitial;
    vi.restoreAllMocks();
  });

  it('laisse passer une route non marquée @AdminSeulement()', () => {
    process.env['ADMIN_EMAILS'] = 'admin@example.test';
    const guard = new AdminGuard(fakeReflector(false));
    // Aucune identité, mais route non gardée → passe.
    expect(guard.canActivate(fakeContext(requete()))).toBe(true);
  });

  it('opt-in : allowlist vide ⇒ gating inactif, laisse passer (prod actuelle)', () => {
    const guard = new AdminGuard(fakeReflector(true));
    const req = requete({ identite: { email: 'quiconque@example.test' } });
    expect(guard.canActivate(fakeContext(req))).toBe(true);
  });

  it('gating actif + identité admin ⇒ laisse passer', () => {
    process.env['ADMIN_EMAILS'] = 'admin@example.test, chef@example.test';
    const guard = new AdminGuard(fakeReflector(true));
    const req = requete({ identite: { email: 'Admin@Example.TEST' } });
    expect(guard.canActivate(fakeContext(req))).toBe(true);
  });

  it('gating actif + identité non-admin ⇒ 403', () => {
    process.env['ADMIN_EMAILS'] = 'admin@example.test';
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const guard = new AdminGuard(fakeReflector(true));
    const req = requete({ identite: { email: 'parent@example.test' } });
    expect(() => guard.canActivate(fakeContext(req))).toThrow(
      ForbiddenException,
    );
    expect(warn).toHaveBeenCalledOnce();
  });

  it('gating actif + aucune identité établie ⇒ 403', () => {
    process.env['ADMIN_EMAILS'] = 'admin@example.test';
    const guard = new AdminGuard(fakeReflector(true));
    expect(() => guard.canActivate(fakeContext(requete()))).toThrow(
      ForbiddenException,
    );
  });
});
