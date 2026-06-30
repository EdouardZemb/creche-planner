import {
  ConflictException,
  type ExecutionContext,
  Logger,
} from '@nestjs/common';
import { type Reflector } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoyerClient } from '../clients/foyer.client.js';
import { CreationFoyerUniqueGuard } from './creation-foyer-unique.guard.js';
import { type RequeteIdentifiable } from './identite.js';

/** Faux Reflector renvoyant un `actif` fixe pour `getAllAndOverride`. */
function fakeReflector(actif: boolean): Reflector {
  return { getAllAndOverride: () => actif } as unknown as Reflector;
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

/** Faux FoyerClient ne portant que `foyersParEmail` (seul appelé par la garde). */
function fakeFoyers(
  foyersParEmail: FoyerClient['foyersParEmail'],
): FoyerClient {
  return { foyersParEmail } as unknown as FoyerClient;
}

describe('CreationFoyerUniqueGuard (P5, besoin B)', () => {
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
    delete process.env['ADMIN_EMAILS'];
  });

  afterEach(() => {
    process.env = envInitial;
    vi.restoreAllMocks();
  });

  it('laisse passer une route non marquée @CreationFoyerUnique()', async () => {
    const foyersParEmail = vi.fn();
    const guard = new CreationFoyerUniqueGuard(
      fakeReflector(false),
      fakeFoyers(foyersParEmail),
    );
    await expect(guard.canActivate(fakeContext(requete()))).resolves.toBe(true);
    expect(foyersParEmail).not.toHaveBeenCalled();
  });

  it('aucune identité établie ⇒ mode hérité, laisse passer (sans appel amont)', async () => {
    const foyersParEmail = vi.fn();
    const guard = new CreationFoyerUniqueGuard(
      fakeReflector(true),
      fakeFoyers(foyersParEmail),
    );
    await expect(guard.canActivate(fakeContext(requete()))).resolves.toBe(true);
    expect(foyersParEmail).not.toHaveBeenCalled();
  });

  it('identité admin ⇒ création illimitée, laisse passer (sans appel amont)', async () => {
    process.env['ADMIN_EMAILS'] = 'admin@example.test';
    const foyersParEmail = vi.fn();
    const guard = new CreationFoyerUniqueGuard(
      fakeReflector(true),
      fakeFoyers(foyersParEmail),
    );
    const req = requete({ identite: { email: 'Admin@Example.TEST' } });
    await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    expect(foyersParEmail).not.toHaveBeenCalled();
  });

  it('non-admin sans foyer ⇒ laisse passer (1ʳᵉ création self-service)', async () => {
    const foyersParEmail = vi.fn().mockResolvedValue([]);
    const guard = new CreationFoyerUniqueGuard(
      fakeReflector(true),
      fakeFoyers(foyersParEmail),
    );
    const req = requete({ identite: { email: 'parent@example.test' } });
    await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    expect(foyersParEmail).toHaveBeenCalledWith('parent@example.test');
  });

  it('non-admin possédant déjà un foyer ⇒ 409 (create-once)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const foyersParEmail = vi.fn().mockResolvedValue(['foyer-1']);
    const guard = new CreationFoyerUniqueGuard(
      fakeReflector(true),
      fakeFoyers(foyersParEmail),
    );
    const req = requete({ identite: { email: 'parent@example.test' } });
    await expect(guard.canActivate(fakeContext(req))).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(warn).toHaveBeenCalledOnce();
  });

  it('résolution impossible ⇒ fail-open : laisse passer (incident transitoire)', async () => {
    const foyersParEmail = vi
      .fn()
      .mockRejectedValue(new Error('svc-foyer down'));
    const guard = new CreationFoyerUniqueGuard(
      fakeReflector(true),
      fakeFoyers(foyersParEmail),
    );
    const req = requete({ identite: { email: 'parent@example.test' } });
    await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
  });
});
