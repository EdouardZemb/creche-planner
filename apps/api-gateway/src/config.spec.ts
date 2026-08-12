import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

/**
 * Déclaration d'environnement de la passerelle (`AM-44`, lot 5 standards).
 *
 * Depuis le lot 5, `loadConfig(env)` **est** le garde-fou de démarrage : il n'y a
 * plus de `verifierConfigProduction()` à appeler séparément, donc plus de garde
 * qu'un `main.ts` puisse oublier. Toutes les specs ci-dessous passent leur env en
 * paramètre : **aucune ne mute `process.env`** (ce qu'elles faisaient encore pour
 * la moitié d'entre elles, avec sauvegarde/restauration à chaque bloc).
 *
 * La règle de lecture elle-même (blanc ≡ absent, entier strict, non-citation des
 * valeurs sensibles) est éprouvée une seule fois, dans
 * `libs/nest-commons/src/lib/config/env.spec.ts`.
 */

/**
 * Les cinq URL amont, telles que le compose les pose. En production, ne pas les
 * poser est désormais un refus de démarrage (leur repli vise `localhost`) : un
 * env de production réaliste doit donc les porter.
 */
const AMONTS = {
  REFERENTIEL_URL: 'http://svc-referentiel:3001',
  FOYER_URL: 'http://svc-foyer:3002',
  PLANIFICATION_URL: 'http://svc-planification:3004',
  TARIFICATION_URL: 'http://svc-tarification:3005',
  NOTIFICATIONS_URL: 'http://svc-notifications:3006',
} as const;

const PROD = { NODE_ENV: 'production', ...AMONTS } as const;

describe('loadConfig — jeton machine en production (AQ-01)', () => {
  it('refuse le démarrage en production sans jeton ni échappatoire', () => {
    expect(() => loadConfig(PROD)).toThrow(
      /GATEWAY_TOKEN requis en production/u,
    );
  });

  it('refuse un jeton vide ou blanc en production (var posée mais non remplie)', () => {
    expect(() => loadConfig({ ...PROD, GATEWAY_TOKEN: '' })).toThrow(
      /GATEWAY_TOKEN requis/u,
    );
    expect(() => loadConfig({ ...PROD, GATEWAY_TOKEN: '   ' })).toThrow(
      /GATEWAY_TOKEN requis/u,
    );
  });

  it('démarre en production avec jeton ET identité Cloudflare configurés', () => {
    expect(() =>
      loadConfig({
        ...PROD,
        GATEWAY_TOKEN: 'secret',
        CF_ACCESS_TEAM_DOMAIN: 'https://equipe.cloudflareaccess.com',
        CF_ACCESS_AUD: 'aud-app',
      }),
    ).not.toThrow();
  });

  it("démarre en production sans jeton si l'échappatoire explicite est posée", () => {
    expect(() =>
      loadConfig({ ...PROD, GATEWAY_AUTH_DISABLED: '1' }),
    ).not.toThrow();
  });

  it("n'exige rien hors production (dev local, test, NODE_ENV absent)", () => {
    expect(() => loadConfig({})).not.toThrow();
    expect(() => loadConfig({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => loadConfig({ NODE_ENV: 'test' })).not.toThrow();
  });

  it("ignore une valeur d'échappatoire autre que '1' (pas de désactivation accidentelle)", () => {
    expect(() =>
      loadConfig({ ...PROD, GATEWAY_AUTH_DISABLED: 'true' }),
    ).toThrow(/GATEWAY_TOKEN requis/u);
  });
});

/**
 * PR5 (identité B1) — en production, faire confiance à l'e-mail vérifié par
 * Cloudflare Access exige d'avoir configuré contre quoi valider sa signature
 * (`CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD`). Même échappatoire que le jeton :
 * `GATEWAY_AUTH_DISABLED=1` (gateway non exposée).
 */
describe('loadConfig — identité Cloudflare Access en production (PR5)', () => {
  it('refuse le démarrage en production avec un jeton mais sans config CF', () => {
    expect(() => loadConfig({ ...PROD, GATEWAY_TOKEN: 'secret' })).toThrow(
      /CF_ACCESS_TEAM_DOMAIN et CF_ACCESS_AUD requis/u,
    );
  });

  it('refuse si le team domain est présent mais pas l’aud (et inversement)', () => {
    expect(() =>
      loadConfig({
        ...PROD,
        GATEWAY_TOKEN: 'secret',
        CF_ACCESS_TEAM_DOMAIN: 'https://equipe.cloudflareaccess.com',
      }),
    ).toThrow(/CF_ACCESS_TEAM_DOMAIN et CF_ACCESS_AUD requis/u);
    expect(() =>
      loadConfig({ ...PROD, GATEWAY_TOKEN: 'secret', CF_ACCESS_AUD: 'aud' }),
    ).toThrow(/CF_ACCESS_TEAM_DOMAIN et CF_ACCESS_AUD requis/u);
  });

  it('refuse une config CF vide ou blanche (var posée mais non remplie)', () => {
    expect(() =>
      loadConfig({
        ...PROD,
        GATEWAY_TOKEN: 'secret',
        CF_ACCESS_TEAM_DOMAIN: '   ',
        CF_ACCESS_AUD: 'aud-app',
      }),
    ).toThrow(/CF_ACCESS_TEAM_DOMAIN et CF_ACCESS_AUD requis/u);
  });

  it("n'exige pas la config CF si l'auth est désactivée explicitement (cas prod actuel)", () => {
    expect(() =>
      loadConfig({ ...PROD, GATEWAY_AUTH_DISABLED: '1' }),
    ).not.toThrow();
  });
});

/**
 * `AM-44` — les URL amont avaient un repli `localhost` qui, en production,
 * désigne le conteneur lui-même : la passerelle démarrait, répondait `200` à sa
 * readiness, et échouait sur **chaque** requête d'agrégation. Le refus est
 * désormais au démarrage.
 */
describe('loadConfig — replis localhost en production (AM-44)', () => {
  it('refuse le démarrage si une URL amont n’est pas posée', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', GATEWAY_AUTH_DISABLED: '1' }),
    ).toThrow(/REFERENTIEL_URL/u);
  });

  it('nomme les cinq amonts manquants d’un coup', () => {
    let message = '';
    try {
      loadConfig({ NODE_ENV: 'production', GATEWAY_AUTH_DISABLED: '1' });
    } catch (erreur) {
      message = (erreur as Error).message;
    }
    for (const nom of Object.keys(AMONTS)) {
      expect(message).toContain(nom);
    }
  });

  it('accepte les replis localhost hors production (pile de dev)', () => {
    const config = loadConfig({});
    expect(config.foyerUrl).toBe('http://localhost:3002');
  });
});

/**
 * PR6 (provisioning admin) — `ADMIN_EMAILS` : allowlist normalisée (minuscules,
 * dédoublonnée). Vide par défaut ⇒ gating admin **inactif** (opt-in).
 */
describe('loadConfig — allowlist admin (PR6)', () => {
  it('renvoie une liste vide sans ADMIN_EMAILS (gating inactif par défaut)', () => {
    expect(loadConfig({}).adminEmails).toEqual([]);
  });

  it('parse un CSV en minuscules, trim et dédoublonne', () => {
    expect(
      loadConfig({
        ADMIN_EMAILS:
          ' Admin@Example.test ,chef@example.test, admin@example.test ',
      }).adminEmails,
    ).toEqual(['admin@example.test', 'chef@example.test']);
  });
});

/**
 * PR7 (enforcement appartenance) — `FOYER_AUTHZ_ENFORCE` : flag opt-in,
 * désactivé par défaut (observe-only). N'est `true` que posé explicitement à `1`.
 */
describe('loadConfig — flag d’enforcement par foyer (PR7)', () => {
  it('désactivé par défaut (observe-only)', () => {
    expect(loadConfig({}).foyerAuthzEnforce).toBe(false);
  });

  it('activé uniquement sur la valeur exacte « 1 »', () => {
    expect(loadConfig({ FOYER_AUTHZ_ENFORCE: '1' }).foyerAuthzEnforce).toBe(
      true,
    );
  });

  it('ignore toute autre valeur (« true », « 0 », vide)', () => {
    for (const v of ['true', '0', '', 'oui']) {
      expect(loadConfig({ FOYER_AUTHZ_ENFORCE: v }).foyerAuthzEnforce).toBe(
        false,
      );
    }
  });
});

/**
 * Fondations lot 3 — `ASSERTION_IDENTITE_SECRET` : secret HMAC signant les
 * assertions propagées aux services. Absent/vide ⇒ `undefined` (aucun en-tête émis,
 * mode legacy aval).
 */
describe('loadConfig — secret d’assertion inter-services (lot 3)', () => {
  it('undefined par défaut (aucun en-tête émis)', () => {
    expect(loadConfig({}).assertionSecret).toBeUndefined();
  });

  it('lu quand posé, vide/blanc → undefined', () => {
    expect(
      loadConfig({ ASSERTION_IDENTITE_SECRET: 's3cr3t' }).assertionSecret,
    ).toBe('s3cr3t');
    expect(
      loadConfig({ ASSERTION_IDENTITE_SECRET: '   ' }).assertionSecret,
    ).toBeUndefined();
  });

  // Ce secret est la clé HMAC des assertions d'identité, partagée avec les cinq
  // services : rognée d'un côté seulement, elle ferait échouer toutes les
  // vérifications. Une valeur entourée d'espaces refuse donc le démarrage.
  it('refuse un secret entouré d’espaces', () => {
    expect(() =>
      loadConfig({ ASSERTION_IDENTITE_SECRET: '  s3cr3t  ' }),
    ).toThrow(/ASSERTION_IDENTITE_SECRET.*espaces/su);
  });
});

describe('loadConfig — jeton machine, vide ≡ absent (AN-20)', () => {
  it('lit le jeton posé', () => {
    expect(loadConfig({ GATEWAY_TOKEN: 'jeton' }).authToken).toBe('jeton');
  });

  // Un jeton entouré d'espaces n'est PAS rogné en silence : sur un secret, les
  // espaces changent la valeur comparée, et rogner ferait dépendre le
  // comportement de la lecture. Le démarrage est refusé, la variable nommée.
  it('refuse un jeton entouré d’espaces (valeur ambiguë)', () => {
    expect(() => loadConfig({ GATEWAY_TOKEN: '  jeton  ' })).toThrow(
      /GATEWAY_TOKEN.*espaces/su,
    );
  });

  // Depuis le lot 5, il n'y a plus qu'UNE lecture : celle de la trousse. AN-20
  // est né de deux lectures divergentes de la même variable — le garde-fou
  // traitait `GATEWAY_TOKEN=` comme absent, `loadConfig` comme un jeton vide, et
  // le guard rejetait alors tout le trafic. L'invariant vit maintenant dans
  // `lireEnv`, ce test en constate l'effet ici.
  it('vide ou blanc ⇒ undefined', () => {
    expect(loadConfig({ GATEWAY_TOKEN: '' }).authToken).toBeUndefined();
    expect(loadConfig({ GATEWAY_TOKEN: '   ' }).authToken).toBeUndefined();
  });
});

describe('loadConfig — relais de confiance (AN-15)', () => {
  it('0 par défaut : aucun relais de confiance', () => {
    expect(loadConfig({}).proxyHops).toBe(0);
  });

  it('lit un entier positif', () => {
    expect(loadConfig({ RATE_LIMIT_PROXY_HOPS: '2' }).proxyHops).toBe(2);
  });

  // ÉCART ASSUMÉ AU LOT 5 — jusqu'ici une valeur inexploitable retombait sur `0`
  // (« je ne fais confiance à personne »), ce qui était le repli le plus sûr
  // *tant qu'on démarrait quand même*. Ce n'est plus le cas : une valeur qu'on ne
  // sait pas lire refuse le démarrage. Le repli silencieux était sûr côté
  // confiance, mais il rouvrait AN-15 sans le dire — `req.ip` redevenait
  // l'adresse de nginx pour tout le trafic, et le rate-limit une fenêtre unique
  // partagée. Un opérateur qui écrit « deux » veut deux, pas zéro.
  it.each(['abc', '-1', '1.5', 'deux'])(
    'refuse le démarrage pour une valeur inexploitable (%s)',
    (valeur) => {
      expect(() => loadConfig({ RATE_LIMIT_PROXY_HOPS: valeur })).toThrow(
        /RATE_LIMIT_PROXY_HOPS/u,
      );
    },
  );

  it('vide ⇒ absent ⇒ défaut 0 (une variable posée non remplie n’est pas une erreur)', () => {
    expect(loadConfig({ RATE_LIMIT_PROXY_HOPS: '' }).proxyHops).toBe(0);
  });
});

describe('loadConfig — rate-limit (le NaN silencieux d’AM-44)', () => {
  it('lit les deux réglages, avec leurs défauts de prod', () => {
    expect(loadConfig({}).rateLimit).toEqual({
      fenetreMs: 60000,
      maxRequetes: 120,
    });
  });

  // `RATE_LIMIT_MAX=cent` donnait `maxRequetes = NaN`, et `recents.length >= NaN`
  // est TOUJOURS faux : le rate-limit était désactivé, sans un mot dans les logs.
  it.each(['cent', '0', '-5', '12.5'])(
    'refuse le démarrage plutôt que de désactiver le rate-limit (%s)',
    (valeur) => {
      expect(() => loadConfig({ RATE_LIMIT_MAX: valeur })).toThrow(
        /RATE_LIMIT_MAX/u,
      );
    },
  );

  it('refuse une fenêtre illisible ou hors bornes', () => {
    expect(() => loadConfig({ RATE_LIMIT_FENETRE_MS: 'une minute' })).toThrow(
      /RATE_LIMIT_FENETRE_MS/u,
    );
    expect(() => loadConfig({ RATE_LIMIT_FENETRE_MS: '3600001' })).toThrow(
      /RATE_LIMIT_FENETRE_MS/u,
    );
  });
});

describe('loadConfig — CORS et identité de dev', () => {
  it('reflète toutes les origines sans CORS_ORIGINS', () => {
    expect(loadConfig({}).corsOrigins).toEqual(['*']);
  });

  it('lit la liste blanche posée, dans l’ordre', () => {
    expect(
      loadConfig({ CORS_ORIGINS: 'https://b.test, https://a.test' })
        .corsOrigins,
    ).toEqual(['https://b.test', 'https://a.test']);
  });

  it('l’en-tête d’identité de dev n’est autorisé qu’hors production', () => {
    expect(loadConfig({}).identite.devHeaderAutorise).toBe(true);
    expect(
      loadConfig({ ...PROD, GATEWAY_AUTH_DISABLED: '1' }).identite
        .devHeaderAutorise,
    ).toBe(false);
  });

  it('refuse une URL amont qui n’est pas une URL', () => {
    expect(() => loadConfig({ FOYER_URL: 'svc-foyer:3002' })).toThrow(
      /FOYER_URL/u,
    );
  });
});
