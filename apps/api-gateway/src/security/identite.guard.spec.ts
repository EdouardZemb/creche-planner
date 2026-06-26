import { type ExecutionContext, Logger } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FoyerClient } from '../clients/foyer.client.js';
import { IdentiteGuard } from './identite.guard.js';
import { type RequeteIdentifiable } from './identite.js';

/** Faux Reflector renvoyant un `estPublic` fixe pour `getAllAndOverride`. */
function fakeReflector(estPublic: boolean): Reflector {
  return { getAllAndOverride: () => estPublic } as unknown as Reflector;
}

/** Faux FoyerClient ne renvoyant que la résolution `foyersParEmail`. */
function fakeFoyers(
  foyersParEmail: (email: string) => Promise<string[]>,
): FoyerClient {
  return { foyersParEmail: vi.fn(foyersParEmail) } as unknown as FoyerClient;
}

/** Construit un faux ExecutionContext exposant `req` (muté par le guard). */
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

describe('IdentiteGuard (observe-only, PR5)', () => {
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
    // Hors prod par défaut → en-tête de dev autorisé ; pas de CF configuré.
    process.env['NODE_ENV'] = 'test';
    delete process.env['CF_ACCESS_TEAM_DOMAIN'];
    delete process.env['CF_ACCESS_AUD'];
  });

  afterEach(() => {
    process.env = envInitial;
    vi.restoreAllMocks();
  });

  it('laisse passer une route @Public() sans poser d’identité', async () => {
    const guard = new IdentiteGuard(
      fakeReflector(true),
      fakeFoyers(async () => []),
    );
    const req = requete({ headers: { 'x-dev-user-email': 'parent@test.fr' } });
    await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    expect(req.identite).toBeUndefined();
  });

  it('pose request.identite depuis X-Dev-User-Email hors production', async () => {
    const guard = new IdentiteGuard(
      fakeReflector(false),
      fakeFoyers(async () => []),
    );
    const req = requete({ headers: { 'x-dev-user-email': 'parent@test.fr' } });
    await guard.canActivate(fakeContext(req));
    expect(req.identite).toEqual({ email: 'parent@test.fr' });
  });

  it('ignore X-Dev-User-Email en production (pas d’identité de dev spoofable)', async () => {
    process.env['NODE_ENV'] = 'production';
    const guard = new IdentiteGuard(
      fakeReflector(false),
      fakeFoyers(async () => []),
    );
    const req = requete({ headers: { 'x-dev-user-email': 'parent@test.fr' } });
    const ok = await guard.canActivate(fakeContext(req));
    expect(ok).toBe(true);
    expect(req.identite).toBeUndefined();
  });

  it('sans aucune identité : laisse passer, n’appelle pas svc-foyer', async () => {
    const foyers = fakeFoyers(async () => ['f-1']);
    const guard = new IdentiteGuard(fakeReflector(false), foyers);
    const req = requete({
      query: { foyer: 'f-1' },
      url: '/api/v1/couts?foyer=f-1',
    });
    await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    expect(req.identite).toBeUndefined();
    expect(foyers.foyersParEmail).not.toHaveBeenCalled();
  });

  it('observe-only : foyer autorisé → laisse passer (pas de warn)', async () => {
    const foyers = fakeFoyers(async () => ['f-1', 'f-2']);
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const guard = new IdentiteGuard(fakeReflector(false), foyers);
    const req = requete({
      headers: { 'x-dev-user-email': 'parent@test.fr' },
      query: { foyer: 'f-1' },
      url: '/api/v1/couts?foyer=f-1',
    });
    await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    expect(foyers.foyersParEmail).toHaveBeenCalledWith('parent@test.fr');
    expect(warn).not.toHaveBeenCalled();
  });

  it('observe-only : foyer NON autorisé → journalise « aurait refusé » mais laisse passer', async () => {
    const foyers = fakeFoyers(async () => ['f-2']);
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const guard = new IdentiteGuard(fakeReflector(false), foyers);
    const req = requete({
      headers: { 'x-dev-user-email': 'intrus@test.fr' },
      params: { id: 'f-1' },
      url: '/api/v1/foyers/f-1',
    });
    const ok = await guard.canActivate(fakeContext(req));
    expect(ok).toBe(true);
    expect(req.identite).toEqual({ email: 'intrus@test.fr' });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/AURAIT REFUSÉ.*f-1/);
  });

  it('observe-only : résolution svc-foyer en échec → journalise, ne lève pas', async () => {
    const foyers = fakeFoyers(async () => {
      throw new Error('svc-foyer indisponible');
    });
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const guard = new IdentiteGuard(fakeReflector(false), foyers);
    const req = requete({
      headers: { 'x-dev-user-email': 'parent@test.fr' },
      query: { foyer: 'f-1' },
      url: '/api/v1/couts?foyer=f-1',
    });
    await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('identité posée sans foyerId ciblé → pas de résolution', async () => {
    const foyers = fakeFoyers(async () => ['f-1']);
    const guard = new IdentiteGuard(fakeReflector(false), foyers);
    const req = requete({
      headers: { 'x-dev-user-email': 'parent@test.fr' },
      url: '/api/v1/foyers',
    });
    await guard.canActivate(fakeContext(req));
    expect(req.identite).toEqual({ email: 'parent@test.fr' });
    expect(foyers.foyersParEmail).not.toHaveBeenCalled();
  });
});
