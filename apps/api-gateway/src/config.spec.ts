import { describe, expect, it } from 'vitest';
import { verifierConfigProduction } from './config.js';

/**
 * AQ-01 (doc 27) — garde-fou de démarrage : en production, l'absence de
 * `GATEWAY_TOKEN` doit être un choix explicite (`GATEWAY_AUTH_DISABLED=1`),
 * jamais un oubli de configuration. L'env est passé en paramètre : aucun test
 * ne mute `process.env`.
 */
describe('verifierConfigProduction (AQ-01)', () => {
  it('refuse le démarrage en production sans jeton ni échappatoire', () => {
    expect(() => {
      verifierConfigProduction({ NODE_ENV: 'production' });
    }).toThrow(/GATEWAY_TOKEN requis en production/);
  });

  it('refuse un jeton vide ou blanc en production (var posée mais non remplie)', () => {
    expect(() => {
      verifierConfigProduction({ NODE_ENV: 'production', GATEWAY_TOKEN: '' });
    }).toThrow(/GATEWAY_TOKEN requis/);
    expect(() => {
      verifierConfigProduction({
        NODE_ENV: 'production',
        GATEWAY_TOKEN: '   ',
      });
    }).toThrow(/GATEWAY_TOKEN requis/);
  });

  it('démarre en production avec un jeton défini', () => {
    expect(() => {
      verifierConfigProduction({
        NODE_ENV: 'production',
        GATEWAY_TOKEN: 'secret',
      });
    }).not.toThrow();
  });

  it("démarre en production sans jeton si l'échappatoire explicite est posée", () => {
    expect(() => {
      verifierConfigProduction({
        NODE_ENV: 'production',
        GATEWAY_AUTH_DISABLED: '1',
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

  it("ignore une valeur d'échappatoire autre que '1' (pas de désactivation accidentelle)", () => {
    expect(() => {
      verifierConfigProduction({
        NODE_ENV: 'production',
        GATEWAY_AUTH_DISABLED: 'true',
      });
    }).toThrow(/GATEWAY_TOKEN requis/);
  });
});
