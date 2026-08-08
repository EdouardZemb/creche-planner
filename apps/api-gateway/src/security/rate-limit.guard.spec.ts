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

  // AN-19 — l'en-tête du guard annonçait un élagage des buckets vides que le code
  // ne faisait pas : la Map ne décroissait jamais. Inoffensif tant qu'AN-15 la
  // réduisait à une clé unique ; dès que la clé est l'IP cliente, c'est l'appelant
  // qui choisit combien d'entrées y créer. On lit la taille réelle de la Map, parce
  // que c'est la seule chose que le comportement HTTP ne montre pas.
  it('élague les clés sorties de la fenêtre (la Map ne croît pas sans borne)', () => {
    let horloge = 0;
    const guard = new RateLimitGuard(() => horloge);
    const buckets = (guard as unknown as { hits: Map<string, number[]> }).hits;

    for (let i = 0; i < 50; i += 1) {
      guard.canActivate(fakeContext(`10.0.0.${String(i)}`));
    }
    expect(buckets.size).toBe(50);

    // Une fenêtre plus tard, un seul client est encore actif : les 50 précédents
    // n'ont plus aucune entrée valide et ne doivent plus occuper la Map.
    horloge = 5000;
    guard.canActivate(fakeContext('10.0.0.200'));

    expect(buckets.size).toBe(1);
    expect([...buckets.keys()]).toEqual(['10.0.0.200']);
  });

  it('l’élagage ne rouvre pas la fenêtre d’un client encore actif', () => {
    let horloge = 0;
    const guard = new RateLimitGuard(() => horloge);
    const ctx = fakeContext('10.0.0.1');

    expect(guard.canActivate(ctx)).toBe(true);
    horloge = 900; // toujours dans la fenêtre de 1000 ms
    expect(guard.canActivate(ctx)).toBe(true);
    horloge = 950;
    expect(() => guard.canActivate(ctx)).toThrow(HttpException);
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
