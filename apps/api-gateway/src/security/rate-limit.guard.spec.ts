import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ExecutionContext, HttpException } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard.js';

/** Faux ExecutionContext HTTP avec une IP cliente fixe. */
function fakeContext(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip }) }),
  } as unknown as ExecutionContext;
}

describe('RateLimitGuard', () => {
  let maxInitial: string | undefined;
  let fenetreInitiale: string | undefined;

  beforeEach(() => {
    maxInitial = process.env['RATE_LIMIT_MAX'];
    fenetreInitiale = process.env['RATE_LIMIT_FENETRE_MS'];
    process.env['RATE_LIMIT_MAX'] = '2';
    process.env['RATE_LIMIT_FENETRE_MS'] = '1000';
  });

  afterEach(() => {
    if (maxInitial === undefined) {
      delete process.env['RATE_LIMIT_MAX'];
    } else {
      process.env['RATE_LIMIT_MAX'] = maxInitial;
    }
    if (fenetreInitiale === undefined) {
      delete process.env['RATE_LIMIT_FENETRE_MS'];
    } else {
      process.env['RATE_LIMIT_FENETRE_MS'] = fenetreInitiale;
    }
  });

  it('autorise jusqu’au maximum puis renvoie un 429', () => {
    const horloge = 0;
    const guard = new RateLimitGuard(() => horloge);
    const ctx = fakeContext('10.0.0.1');

    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);

    try {
      guard.canActivate(ctx);
      expect.unreachable('le 3e appel aurait dû lever une exception');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(429);
    }
  });

  it('réautorise une fois la fenêtre dépassée', () => {
    let horloge = 0;
    const guard = new RateLimitGuard(() => horloge);
    const ctx = fakeContext('10.0.0.1');

    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);

    // Au-delà de la fenêtre (1000 ms) : les anciens hits sont purgés.
    horloge = 1001;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('isole les compteurs par IP', () => {
    const horloge = 0;
    const guard = new RateLimitGuard(() => horloge);

    const a = fakeContext('10.0.0.1');
    const b = fakeContext('10.0.0.2');

    expect(guard.canActivate(a)).toBe(true);
    expect(guard.canActivate(a)).toBe(true);
    // B a son propre bucket : non impacté par la saturation de A.
    expect(guard.canActivate(b)).toBe(true);
    expect(guard.canActivate(b)).toBe(true);

    expect(() => guard.canActivate(a)).toThrow(HttpException);
  });
});
