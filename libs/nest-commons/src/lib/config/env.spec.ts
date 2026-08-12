import { describe, expect, it } from 'vitest';
import {
  type ChampEnv,
  champEnv,
  ErreurEnvironnement,
  estProduction,
  lireEnv,
} from './env.js';

/**
 * Spec de la trousse de validation d'environnement (`AM-44`, lot 5 standards).
 *
 * Elle éprouve la **règle de lecture** partagée par les six applications, là où
 * chaque `config.spec.ts` d'app éprouve la **déclaration** de son app. La
 * dernière spec de ce fichier ferme la porte de l'oubli : toute fabrique ajoutée
 * à `champEnv` doit apparaître dans le tableau éprouvé ici, et cet attendu est
 * dérivé des clés du module — jamais recopié (`MO-3`).
 */

/** Déclaration minimale réutilisée : un port et une URL amont. */
const CHAMPS_BASE = {
  PORT: champEnv.port(3000),
  FOYER_URL: champEnv.urlService('http://localhost:3002'),
} as const;

describe('lireEnv — lecture et défauts', () => {
  it('applique les défauts quand aucune variable n’est posée', () => {
    const valeurs = lireEnv('sonde', CHAMPS_BASE, { env: {} });

    expect(valeurs.PORT).toBe(3000);
    expect(valeurs.FOYER_URL).toBe('http://localhost:3002');
  });

  it('lit NODE_ENV sans que l’app ait à le déclarer, et ne l’énumère pas', () => {
    expect(lireEnv('sonde', CHAMPS_BASE, { env: {} }).NODE_ENV).toBe(
      'development',
    );
    // `staging` n'est pas `production` : acceptée telle quelle, aucun refus.
    const staging = lireEnv('sonde', CHAMPS_BASE, {
      env: { NODE_ENV: 'staging' },
    });
    expect(staging.NODE_ENV).toBe('staging');
    expect(estProduction(staging)).toBe(false);
    expect(
      estProduction(
        lireEnv('sonde', CHAMPS_BASE, {
          env: { NODE_ENV: 'production', FOYER_URL: 'http://svc-foyer:3002' },
        }),
      ),
    ).toBe(true);
  });

  it('traite une valeur blanche comme absente (AN-20)', () => {
    const champs = {
      JETON: champEnv.secret(),
      ENFORCE: champEnv.bascule(),
      PORT: champEnv.port(3000),
    } as const;

    const valeurs = lireEnv('sonde', champs, {
      env: { JETON: '   ', ENFORCE: '', PORT: ' 4000 ' },
    });

    // Le jeton vide vaut « non fourni » : c'est la divergence de lecture qui
    // avait fait rejeter tout le trafic de la gateway (AN-20).
    expect(valeurs.JETON).toBeUndefined();
    expect(valeurs.ENFORCE).toBe(false);
    expect(valeurs.PORT).toBe(4000);
  });
});

describe('lireEnv — refus de démarrage', () => {
  it('nomme TOUS les champs fautifs, pas seulement le premier', () => {
    let erreur: ErreurEnvironnement | undefined;
    try {
      lireEnv('sonde', CHAMPS_BASE, {
        env: { PORT: 'cent', FOYER_URL: 'pas-une-url' },
      });
    } catch (leve) {
      erreur = leve as ErreurEnvironnement;
    }

    expect(erreur).toBeInstanceOf(ErreurEnvironnement);
    expect(erreur?.constats).toHaveLength(2);
    expect(erreur?.message).toContain('PORT');
    expect(erreur?.message).toContain('FOYER_URL');
    expect(erreur?.app).toBe('sonde');
  });

  it('refuse un entier non décimal au lieu de propager un NaN', () => {
    // `Number('0x10')` vaut 16 et `Number('12.5')` vaut 12.5 : deux valeurs que
    // l'ancienne lecture acceptait en silence.
    for (const brut of ['0x10', '12.5', '-1', 'cent', '1e3']) {
      expect(() =>
        lireEnv('sonde', CHAMPS_BASE, { env: { PORT: brut } }),
      ).toThrow(/PORT/u);
    }
  });

  it('refuse un port hors bornes en citant la borne', () => {
    expect(() =>
      lireEnv('sonde', CHAMPS_BASE, { env: { PORT: '65536' } }),
    ).toThrow(/PORT.*65535/su);
    expect(() => lireEnv('sonde', CHAMPS_BASE, { env: { PORT: '0' } })).toThrow(
      /PORT.*≥ 1/su,
    );
  });

  it('cite la valeur reçue d’un champ mécanique', () => {
    expect(() =>
      lireEnv('sonde', CHAMPS_BASE, { env: { PORT: 'cent' } }),
    ).toThrow(/reçu « cent »/u);
  });

  it('ne cite JAMAIS la valeur d’une URL de base de données (mot de passe)', () => {
    const champs = {
      DATABASE_URL: champEnv.urlPostgres('postgres://a:b@localhost:5432/a'),
    } as const;

    let message = '';
    try {
      lireEnv('sonde', champs, {
        env: { DATABASE_URL: 'postgres//secret-en-clair@hote/base' },
      });
    } catch (leve) {
      message = (leve as Error).message;
    }

    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('secret-en-clair');
    expect(message).toMatch(/caractère\(s\)/u);
  });
});

describe('lireEnv — formes de variables', () => {
  it('bascule : seule la valeur « 1 » active', () => {
    const champs = { ENFORCE: champEnv.bascule() } as const;
    for (const [brut, attendu] of [
      ['1', true],
      ['0', false],
      ['true', false],
      ['oui', false],
      [undefined, false],
    ] as const) {
      expect(lireEnv('sonde', champs, { env: { ENFORCE: brut } }).ENFORCE).toBe(
        attendu,
      );
    }
  });

  it('basculeExtinction : le garde-fou est actif sauf mot exact', () => {
    const champs = { DRY_RUN: champEnv.basculeExtinction('false') } as const;
    for (const [brut, attendu] of [
      [undefined, true],
      ['', true],
      ['0', true],
      ['FALSE', true],
      ['false', false],
    ] as const) {
      expect(lireEnv('sonde', champs, { env: { DRY_RUN: brut } }).DRY_RUN).toBe(
        attendu,
      );
    }
  });

  it('liste : ordre conservé, éléments blancs ignorés, casse intacte', () => {
    const champs = { ORIGINS: champEnv.liste() } as const;
    expect(
      lireEnv('sonde', champs, { env: { ORIGINS: 'https://B, ,https://a' } })
        .ORIGINS,
    ).toEqual(['https://B', 'https://a']);
    expect(lireEnv('sonde', champs, { env: {} }).ORIGINS).toEqual([]);
  });

  it('allowlist : minuscules, dédoublonnée, ordre de première apparition', () => {
    const champs = { ADMINS: champEnv.allowlist() } as const;
    expect(
      lireEnv('sonde', champs, {
        env: { ADMINS: 'B@x.fr, a@x.fr ,b@X.fr' },
      }).ADMINS,
    ).toEqual(['b@x.fr', 'a@x.fr']);
  });

  it('urlService borne le protocole (l’oubli du « http:// » ne passe pas)', () => {
    // `z.url()` seul accepte `svc-foyer:3002` : `new URL()` y voit le schéma
    // `svc-foyer:` et le chemin `3002`. C'est la faute de frappe la plus
    // probable sur ces variables.
    expect(() =>
      lireEnv('sonde', CHAMPS_BASE, { env: { FOYER_URL: 'svc-foyer:3002' } }),
    ).toThrow(/FOYER_URL/u);
    expect(() =>
      lireEnv('sonde', CHAMPS_BASE, { env: { FOYER_URL: 'nats://svc:4222' } }),
    ).toThrow(/FOYER_URL/u);
    expect(
      lireEnv('sonde', CHAMPS_BASE, {
        env: { FOYER_URL: 'https://svc-foyer:3002' },
      }).FOYER_URL,
    ).toBe('https://svc-foyer:3002');
  });

  it('urlNats et urlPostgres bornent leur schéma d’URL', () => {
    const champs = {
      NATS_URL: champEnv.urlNats('nats://localhost:4222'),
      DATABASE_URL: champEnv.urlPostgres('postgres://a:b@localhost:5432/a'),
    } as const;

    expect(() =>
      lireEnv('sonde', champs, { env: { NATS_URL: 'http://nats:4222' } }),
    ).toThrow(/NATS_URL/u);
    expect(() =>
      lireEnv('sonde', champs, {
        env: { DATABASE_URL: 'mysql://a:b@hote:3306/a' },
      }),
    ).toThrow(/DATABASE_URL/u);
    expect(
      lireEnv('sonde', champs, {
        env: { DATABASE_URL: 'postgresql://a:b@hote:5432/a' },
      }).DATABASE_URL,
    ).toBe('postgresql://a:b@hote:5432/a');
  });

  it('refuse un secret entouré d’espaces au lieu de le rogner en silence', () => {
    // Rogner changerait la CLÉ : un `DESABONNEMENT_TOKEN_SECRET` stocké avec une
    // espace finale signerait autrement qu'avant, et tous les liens de
    // désabonnement déjà partis (TTL 30 j) cesseraient de vérifier sans une ligne
    // de log qui pointe la cause.
    const champs = {
      SIGNATURE: champEnv.secretAvecRepli('dev'),
      JETON: champEnv.secret(),
    } as const;

    let message = '';
    try {
      lireEnv('sonde', champs, { env: { SIGNATURE: ' vrai-secret ' } });
    } catch (leve) {
      message = (leve as Error).message;
    }
    expect(message).toContain('SIGNATURE');
    expect(message).toContain('espaces');
    // Le secret lui-même n'apparaît pas dans le refus.
    expect(message).not.toContain('vrai-secret');

    expect(() =>
      lireEnv('sonde', champs, { env: { JETON: 'jeton\t' } }),
    ).toThrow(/JETON/u);

    // Une valeur ENTIÈREMENT blanche reste « absente » : aucune ambiguïté sur
    // l'intention, c'est l'invariant AN-20.
    expect(
      lireEnv('sonde', champs, { env: { JETON: '   ' } }).JETON,
    ).toBeUndefined();
    // Et une valeur propre passe, évidemment.
    expect(lireEnv('sonde', champs, { env: { JETON: 'jeton' } }).JETON).toBe(
      'jeton',
    );
  });

  it('texte, secret et secretAvecRepli : repli et absence', () => {
    const champs = {
      SMTP_HOST: champEnv.texte('smtp.example.org'),
      JETON: champEnv.secret(),
      SIGNATURE: champEnv.secretAvecRepli('secret-de-dev'),
    } as const;

    const defauts = lireEnv('sonde', champs, { env: {} });
    expect(defauts.SMTP_HOST).toBe('smtp.example.org');
    expect(defauts.JETON).toBeUndefined();
    expect(defauts.SIGNATURE).toBe('secret-de-dev');

    const posees = lireEnv('sonde', champs, {
      env: { SMTP_HOST: 'smtp.autre.fr', JETON: 'jwt', SIGNATURE: 'vrai' },
    });
    expect([posees.SMTP_HOST, posees.JETON, posees.SIGNATURE]).toEqual([
      'smtp.autre.fr',
      'jwt',
      'vrai',
    ]);
  });
});

describe('lireEnv — repli local en production', () => {
  const CHAMPS = {
    FOYER_URL: champEnv.urlService('http://localhost:3002'),
    DATABASE_URL: champEnv.urlPostgres(
      'postgres://foyer:foyer@localhost:5434/foyer',
    ),
  } as const;

  it('refuse le démarrage quand un repli localhost s’appliquerait', () => {
    let erreur: ErreurEnvironnement | undefined;
    try {
      lireEnv('sonde', CHAMPS, { env: { NODE_ENV: 'production' } });
    } catch (leve) {
      erreur = leve as ErreurEnvironnement;
    }

    expect(erreur?.constats).toHaveLength(2);
    expect(erreur?.message).toContain('FOYER_URL');
    expect(erreur?.message).toContain('DATABASE_URL');
  });

  it('cite le repli d’un champ mécanique, jamais celui qui porte un secret', () => {
    let message = '';
    try {
      lireEnv('sonde', CHAMPS, { env: { NODE_ENV: 'production' } });
    } catch (leve) {
      message = (leve as Error).message;
    }

    expect(message).toContain('http://localhost:3002');
    // Le repli de dev de la base porte un couple utilisateur/mot de passe : il
    // est nommé, pas imprimé.
    expect(message).not.toContain('foyer:foyer@');
  });

  it('se tait dès que la variable est réellement posée', () => {
    const valeurs = lireEnv('sonde', CHAMPS, {
      env: {
        NODE_ENV: 'production',
        FOYER_URL: 'http://svc-foyer:3002',
        DATABASE_URL: 'postgres://foyer:x@postgres-foyer:5432/foyer',
      },
    });
    expect(valeurs.FOYER_URL).toBe('http://svc-foyer:3002');
  });

  it('ne dit rien hors production (la pile de dev EST localhost)', () => {
    expect(() => lireEnv('sonde', CHAMPS, { env: {} })).not.toThrow();
    expect(() =>
      lireEnv('sonde', CHAMPS, { env: { NODE_ENV: 'test' } }),
    ).not.toThrow();
  });

  it('ignore un repli qui n’est pas purement local', () => {
    const champs = {
      SMTP_HOST: champEnv.texte('smtp.gmail.com'),
      APP_URL: champEnv.urlService('https://exemple.test'),
    } as const;
    expect(() =>
      lireEnv('sonde', champs, { env: { NODE_ENV: 'production' } }),
    ).not.toThrow();
  });
});

describe('lireEnv — règles de production', () => {
  const CHAMPS = {
    FOYER_URL: champEnv.urlService('http://svc-foyer:3002'),
    JETON: champEnv.secret(),
    ECHAPPATOIRE: champEnv.bascule(),
  } as const;

  const REGLE = {
    nom: 'jeton machine (AQ-01)',
    verifier: (v: {
      readonly JETON: string | undefined;
      readonly ECHAPPATOIRE: boolean;
    }) =>
      v.JETON === undefined && !v.ECHAPPATOIRE
        ? 'JETON requis, ou échappatoire explicite'
        : undefined,
  } as const;

  it('joue la règle en production et refuse en la nommant', () => {
    expect(() =>
      lireEnv('sonde', CHAMPS, {
        env: { NODE_ENV: 'production' },
        regles: [REGLE],
      }),
    ).toThrow(/jeton machine \(AQ-01\).*JETON requis/su);
  });

  it('accepte dès que l’échappatoire est posée', () => {
    expect(() =>
      lireEnv('sonde', CHAMPS, {
        env: { NODE_ENV: 'production', ECHAPPATOIRE: '1' },
        regles: [REGLE],
      }),
    ).not.toThrow();
  });

  it('ne joue aucune règle hors production', () => {
    expect(() =>
      lireEnv('sonde', CHAMPS, { env: {}, regles: [REGLE] }),
    ).not.toThrow();
  });

  it('ne joue aucune règle si un champ n’a pas pu être lu', () => {
    // Une règle qui lirait une valeur non validée raisonnerait sur du vide :
    // le refus de champ passe d'abord, seul.
    let erreur: ErreurEnvironnement | undefined;
    try {
      lireEnv(
        'sonde',
        { ...CHAMPS, PORT: champEnv.port(3000) },
        {
          env: { NODE_ENV: 'production', PORT: 'cent' },
          regles: [REGLE],
        },
      );
    } catch (leve) {
      erreur = leve as ErreurEnvironnement;
    }
    expect(erreur?.constats).toEqual([
      expect.stringContaining('PORT') as unknown as string,
    ]);
  });
});

describe('champEnv — aucune fabrique hors des sondes ci-dessus', () => {
  it('éprouve toutes les formes déclarées par la trousse', () => {
    // Attendu DÉRIVÉ des clés du module : une fabrique ajoutée sans sonde fait
    // rougir cette spec au lieu d'arriver muette dans six déclarations.
    const eprouvees: readonly (keyof typeof champEnv)[] = [
      'environnement',
      'port',
      'entier',
      'urlService',
      'urlNats',
      'urlPostgres',
      'bascule',
      'basculeExtinction',
      'liste',
      'allowlist',
      'texte',
      'secret',
      'secretAvecRepli',
    ];

    expect([...eprouvees].sort()).toEqual(Object.keys(champEnv).sort());
  });

  it('entier borné : la fabrique générique respecte ses bornes', () => {
    const champs = {
      HEURE: champEnv.entier({ defaut: 8, min: 0, max: 23 }),
    } as const;
    expect(lireEnv('sonde', champs, { env: {} }).HEURE).toBe(8);
    expect(lireEnv('sonde', champs, { env: { HEURE: '0' } }).HEURE).toBe(0);
    expect(() => lireEnv('sonde', champs, { env: { HEURE: '24' } })).toThrow(
      /HEURE/u,
    );
  });

  it('expose un champ par variable déclarée, sans en inventer', () => {
    const champs: Record<string, ChampEnv<unknown>> = {
      PORT: champEnv.port(3000),
    };
    expect(Object.keys(lireEnv('sonde', champs, { env: {} })).sort()).toEqual([
      'NODE_ENV',
      'PORT',
    ]);
  });
});
