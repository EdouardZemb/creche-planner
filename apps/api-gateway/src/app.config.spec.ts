import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { configurerApp } from './app.config.js';

/**
 * AN-15 — `req.ip` sert de clé au `RateLimitGuard`. Sans `trust proxy`, Express
 * renvoie le **pair TCP** : derrière le reverse-proxy du déploiement, la même
 * adresse pour 100 % du trafic, donc une fenêtre de débit unique partagée par tous
 * les clients au lieu d'une par client.
 *
 * Le guard, lui, était vert : sa spec fabrique un `req.ip` distinct par cas de test,
 * ce que la pile réelle ne fait jamais. C'est ici, au câblage de l'application, que
 * la propriété se joue — d'où cette spec (LE-23).
 */
function fakeApp(): {
  app: INestApplication;
  set: ReturnType<typeof vi.fn>;
} {
  const set = vi.fn();
  const app = {
    getHttpAdapter: () => ({ getInstance: () => ({ set }) }),
    setGlobalPrefix: vi.fn(),
    enableVersioning: vi.fn(),
    enableCors: vi.fn(),
  } as unknown as INestApplication;
  return { app, set };
}

describe('configurerApp — trust proxy (AN-15)', () => {
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
    delete process.env['RATE_LIMIT_PROXY_HOPS'];
  });

  afterEach(() => {
    process.env = envInitial;
  });

  it('règle trust proxy sur le nombre de relais configuré', () => {
    process.env['RATE_LIMIT_PROXY_HOPS'] = '2';
    const { app, set } = fakeApp();

    configurerApp(app);

    expect(set).toHaveBeenCalledWith('trust proxy', 2);
  });

  it('sans configuration, ne fait confiance à aucun relais', () => {
    const { app, set } = fakeApp();

    configurerApp(app);

    expect(set).toHaveBeenCalledWith('trust proxy', 0);
  });
});
