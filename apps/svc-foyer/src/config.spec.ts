import { describe, expect, it } from 'vitest';
import {
  SECRET_DESABONNEMENT_DEV,
  verifierConfigProduction,
} from './config.js';

/**
 * L5 (miroir de `api-gateway`) — garde-fou de démarrage : en production, le
 * secret HMAC qui signe les jetons de désabonnement one-click (RFC 8058) doit
 * être un **vrai** secret, jamais le fallback de dev (absent, vide ou resté au
 * défaut). L'env est passé en **paramètre** : aucun test ne mute `process.env`.
 */
describe('verifierConfigProduction (svc-foyer — secret désabonnement)', () => {
  it('refuse le démarrage en production sans secret', () => {
    expect(() => {
      verifierConfigProduction({ NODE_ENV: 'production' });
    }).toThrow(/DESABONNEMENT_TOKEN_SECRET requis en production/);
  });

  it('refuse un secret vide ou blanc (var posée mais non remplie)', () => {
    expect(() => {
      verifierConfigProduction({
        NODE_ENV: 'production',
        DESABONNEMENT_TOKEN_SECRET: '',
      });
    }).toThrow(/DESABONNEMENT_TOKEN_SECRET requis/);
    expect(() => {
      verifierConfigProduction({
        NODE_ENV: 'production',
        DESABONNEMENT_TOKEN_SECRET: '   ',
      });
    }).toThrow(/DESABONNEMENT_TOKEN_SECRET requis/);
  });

  it('refuse le fallback de dev laissé en production', () => {
    expect(() => {
      verifierConfigProduction({
        NODE_ENV: 'production',
        DESABONNEMENT_TOKEN_SECRET: SECRET_DESABONNEMENT_DEV,
      });
    }).toThrow(/DESABONNEMENT_TOKEN_SECRET requis/);
  });

  it('démarre en production avec un vrai secret', () => {
    expect(() => {
      verifierConfigProduction({
        NODE_ENV: 'production',
        DESABONNEMENT_TOKEN_SECRET: 'un-vrai-secret-de-prod-long-et-aleatoire',
      });
    }).not.toThrow();
  });

  it("n'exige rien hors production (dev local, test, NODE_ENV absent)", () => {
    expect(() => {
      verifierConfigProduction({});
    }).not.toThrow();
    expect(() => {
      verifierConfigProduction({ NODE_ENV: 'development' });
    }).not.toThrow();
    expect(() => {
      verifierConfigProduction({ NODE_ENV: 'test' });
    }).not.toThrow();
  });
});
