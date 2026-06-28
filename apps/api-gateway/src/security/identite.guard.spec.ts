import { type ExecutionContext } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentiteGuard } from './identite.guard.js';
import { type RequeteIdentifiable } from './identite.js';

/** Faux Reflector renvoyant un `estPublic` fixe pour `getAllAndOverride`. */
function fakeReflector(estPublic: boolean): Reflector {
  return { getAllAndOverride: () => estPublic } as unknown as Reflector;
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

describe('IdentiteGuard (pose l’identité, ne refuse rien)', () => {
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
    const guard = new IdentiteGuard(fakeReflector(true));
    const req = requete({ headers: { 'x-dev-user-email': 'parent@test.fr' } });
    await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    expect(req.identite).toBeUndefined();
  });

  it('pose request.identite depuis X-Dev-User-Email hors production', async () => {
    const guard = new IdentiteGuard(fakeReflector(false));
    const req = requete({ headers: { 'x-dev-user-email': 'parent@test.fr' } });
    await guard.canActivate(fakeContext(req));
    expect(req.identite).toEqual({ email: 'parent@test.fr' });
  });

  it('ignore X-Dev-User-Email en production (pas d’identité de dev spoofable)', async () => {
    process.env['NODE_ENV'] = 'production';
    const guard = new IdentiteGuard(fakeReflector(false));
    const req = requete({ headers: { 'x-dev-user-email': 'parent@test.fr' } });
    const ok = await guard.canActivate(fakeContext(req));
    expect(ok).toBe(true);
    expect(req.identite).toBeUndefined();
  });

  it('sans aucune identité : laisse passer sans poser d’identité', async () => {
    const guard = new IdentiteGuard(fakeReflector(false));
    const req = requete({ url: '/api/v1/couts?foyer=f-1' });
    await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    expect(req.identite).toBeUndefined();
  });
});
