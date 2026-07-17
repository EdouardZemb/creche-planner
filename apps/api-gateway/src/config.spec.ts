import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, verifierConfigProduction } from './config.js';

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

  it('démarre en production avec jeton ET identité Cloudflare configurés', () => {
    expect(() => {
      verifierConfigProduction({
        NODE_ENV: 'production',
        GATEWAY_TOKEN: 'secret',
        CF_ACCESS_TEAM_DOMAIN: 'https://equipe.cloudflareaccess.com',
        CF_ACCESS_AUD: 'aud-app',
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

/**
 * PR5 (identité B1) — garde-fou de démarrage : en production, faire confiance à
 * l'email vérifié par Cloudflare Access exige d'avoir configuré contre quoi
 * valider sa signature (`CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD`). Même
 * échappatoire que le jeton : `GATEWAY_AUTH_DISABLED=1` (gateway non exposée).
 */
describe('verifierConfigProduction — identité Cloudflare Access (PR5)', () => {
  it('refuse le démarrage en production avec un jeton mais sans config CF', () => {
    expect(() => {
      verifierConfigProduction({
        NODE_ENV: 'production',
        GATEWAY_TOKEN: 'secret',
      });
    }).toThrow(/CF_ACCESS_TEAM_DOMAIN et CF_ACCESS_AUD requis/);
  });

  it('refuse si le team domain est présent mais pas l’aud (et inversement)', () => {
    expect(() => {
      verifierConfigProduction({
        NODE_ENV: 'production',
        GATEWAY_TOKEN: 'secret',
        CF_ACCESS_TEAM_DOMAIN: 'https://equipe.cloudflareaccess.com',
      });
    }).toThrow(/CF_ACCESS_TEAM_DOMAIN et CF_ACCESS_AUD requis/);
    expect(() => {
      verifierConfigProduction({
        NODE_ENV: 'production',
        GATEWAY_TOKEN: 'secret',
        CF_ACCESS_AUD: 'aud-app',
      });
    }).toThrow(/CF_ACCESS_TEAM_DOMAIN et CF_ACCESS_AUD requis/);
  });

  it('refuse une config CF vide ou blanche (var posée mais non remplie)', () => {
    expect(() => {
      verifierConfigProduction({
        NODE_ENV: 'production',
        GATEWAY_TOKEN: 'secret',
        CF_ACCESS_TEAM_DOMAIN: '   ',
        CF_ACCESS_AUD: 'aud-app',
      });
    }).toThrow(/CF_ACCESS_TEAM_DOMAIN et CF_ACCESS_AUD requis/);
  });

  it("n'exige pas la config CF si l'auth est désactivée explicitement (cas prod actuel)", () => {
    expect(() => {
      verifierConfigProduction({
        NODE_ENV: 'production',
        GATEWAY_AUTH_DISABLED: '1',
      });
    }).not.toThrow();
  });
});

/**
 * PR6 (provisioning admin) — `ADMIN_EMAILS` : allowlist normalisée (minuscules,
 * dédoublonnée). Vide par défaut ⇒ gating admin **inactif** (opt-in).
 */
describe('loadConfig — allowlist admin (PR6)', () => {
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
    delete process.env['ADMIN_EMAILS'];
  });

  afterEach(() => {
    process.env = envInitial;
  });

  it('renvoie une liste vide sans ADMIN_EMAILS (gating inactif par défaut)', () => {
    expect(loadConfig().adminEmails).toEqual([]);
  });

  it('parse un CSV en minuscules, trim et dédoublonne', () => {
    process.env['ADMIN_EMAILS'] =
      ' Admin@Example.test ,chef@example.test, admin@example.test ';
    expect(loadConfig().adminEmails).toEqual([
      'admin@example.test',
      'chef@example.test',
    ]);
  });
});

/**
 * PR7 (enforcement appartenance) — `FOYER_AUTHZ_ENFORCE` : flag opt-in,
 * désactivé par défaut (observe-only). N'est `true` que posé explicitement à `1`.
 */
describe('loadConfig — flag d’enforcement par foyer (PR7)', () => {
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
    delete process.env['FOYER_AUTHZ_ENFORCE'];
  });

  afterEach(() => {
    process.env = envInitial;
  });

  it('désactivé par défaut (observe-only)', () => {
    expect(loadConfig().foyerAuthzEnforce).toBe(false);
  });

  it('activé uniquement sur la valeur exacte « 1 »', () => {
    process.env['FOYER_AUTHZ_ENFORCE'] = '1';
    expect(loadConfig().foyerAuthzEnforce).toBe(true);
  });

  it('ignore toute autre valeur (« true », « 0 », vide)', () => {
    for (const v of ['true', '0', '', 'oui']) {
      process.env['FOYER_AUTHZ_ENFORCE'] = v;
      expect(loadConfig().foyerAuthzEnforce).toBe(false);
    }
  });
});

/**
 * Fondations lot 3 — `ASSERTION_IDENTITE_SECRET` : secret HMAC signant les
 * assertions propagées aux services. Absent/vide ⇒ `undefined` (aucun en-tête émis,
 * mode legacy aval).
 */
describe('loadConfig — secret d’assertion inter-services (lot 3)', () => {
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
    delete process.env['ASSERTION_IDENTITE_SECRET'];
  });

  afterEach(() => {
    process.env = envInitial;
  });

  it('undefined par défaut (aucun en-tête émis)', () => {
    expect(loadConfig().assertionSecret).toBeUndefined();
  });

  it('lu quand posé, trimé, vide/blanc → undefined', () => {
    process.env['ASSERTION_IDENTITE_SECRET'] = '  s3cr3t  ';
    expect(loadConfig().assertionSecret).toBe('s3cr3t');
    process.env['ASSERTION_IDENTITE_SECRET'] = '   ';
    expect(loadConfig().assertionSecret).toBeUndefined();
  });
});
