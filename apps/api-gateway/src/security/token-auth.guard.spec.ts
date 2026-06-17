import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';
import { TokenAuthGuard } from './token-auth.guard.js';

/** Construit un faux ExecutionContext minimal pour les gardes HTTP. */
function fakeContext(headers: Record<string, string | string[] | undefined>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

/** Faux Reflector renvoyant une valeur fixe pour `getAllAndOverride`. */
function fakeReflector(estPublic: boolean): Reflector {
  return {
    getAllAndOverride: () => estPublic,
  } as unknown as Reflector;
}

describe('TokenAuthGuard', () => {
  let jetonInitial: string | undefined;

  beforeEach(() => {
    jetonInitial = process.env['GATEWAY_TOKEN'];
  });

  afterEach(() => {
    if (jetonInitial === undefined) {
      delete process.env['GATEWAY_TOKEN'];
    } else {
      process.env['GATEWAY_TOKEN'] = jetonInitial;
    }
  });

  it('laisse passer une route marquée @Public()', () => {
    const guard = new TokenAuthGuard(fakeReflector(true));
    expect(guard.canActivate(fakeContext({}))).toBe(true);
  });

  it('laisse passer quand GATEWAY_TOKEN est absent (auth désactivée)', () => {
    delete process.env['GATEWAY_TOKEN'];
    const guard = new TokenAuthGuard(fakeReflector(false));
    expect(guard.canActivate(fakeContext({}))).toBe(true);
  });

  it("rejette quand le jeton est défini mais l'en-tête est manquant", () => {
    process.env['GATEWAY_TOKEN'] = 'secret';
    const guard = new TokenAuthGuard(fakeReflector(false));
    expect(() => guard.canActivate(fakeContext({}))).toThrow(
      UnauthorizedException,
    );
  });

  it("rejette quand l'en-tête porte un jeton invalide", () => {
    process.env['GATEWAY_TOKEN'] = 'secret';
    const guard = new TokenAuthGuard(fakeReflector(false));
    expect(() =>
      guard.canActivate(fakeContext({ authorization: 'Bearer mauvais' })),
    ).toThrow(UnauthorizedException);
  });

  it('laisse passer avec un en-tête Bearer correct', () => {
    process.env['GATEWAY_TOKEN'] = 'secret';
    const guard = new TokenAuthGuard(fakeReflector(false));
    expect(
      guard.canActivate(fakeContext({ authorization: 'Bearer secret' })),
    ).toBe(true);
  });
});
