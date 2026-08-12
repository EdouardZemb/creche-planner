import { describe, expect, it } from 'vitest';
import { estUrlEmailPublique, loadConfig } from './config.js';

/**
 * Déclaration d'environnement de `svc-notifications` (`AM-44`, lot 5 standards).
 *
 * Depuis le lot 5, `loadConfig(env)` **est** le garde-fou de démarrage et prend
 * son environnement en paramètre : la machinerie de sauvegarde/restauration de
 * `process.env` que portait cette spec (une liste de quinze clés, un `afterEach`
 * et un `Reflect.deleteProperty` pour contourner `no-dynamic-delete`) a disparu
 * avec elle.
 */

/** Ce que le compose pose réellement en production (base, bus, amonts). */
const AMONTS = {
  DATABASE_URL: 'postgres://u:secret@postgres-notifications:5432/notifications',
  NATS_URL: 'nats://nats:4222',
  PLANIFICATION_URL: 'http://svc-planification:3004',
  FOYER_URL: 'http://svc-foyer:3002',
} as const;

/** Production nominale : amonts posés et liens d'e-mail publics. */
const PROD = {
  NODE_ENV: 'production',
  ...AMONTS,
  NOTIF_APP_URL: 'https://creche.testlens.dev',
  NOTIF_PUBLIC_API_URL: 'https://creche.testlens.dev',
} as const;

describe('loadConfig (svc-notifications)', () => {
  it('applique les défauts de dev local quand l’environnement est vide', () => {
    const config = loadConfig({});

    expect(config.port).toBe(3006);
    expect(config.databaseUrl).toContain('localhost:5437/notifications');
    expect(config.natsUrl).toBe('nats://localhost:4222');
    expect(config.planificationUrl).toBe('http://localhost:3004');
    expect(config.foyerUrl).toBe('http://localhost:3002');
    expect(config.appUrl).toBe('http://localhost:4200');
    expect(config.publicApiUrl).toBe('http://localhost:3000');
    expect(config.unsubscribeMailto).toBe('');
    expect(config.schedulerHeure).toBe(8);
    // Garde-fou : l'affordance de test du scheduler est INACTIVE par défaut.
    expect(config.schedulerForcer).toBe(false);
    expect(config.email.host).toBe('smtp.gmail.com');
    expect(config.email.port).toBe(587);
    expect(config.email.parent).toBe('edouard.zemb@gmail.com');
    // Garde-fou : dry-run actif par défaut, allowlist vide (aucun filtrage).
    expect(config.email.dryRun).toBe(true);
    expect(config.email.allowlist).toEqual([]);
  });

  it('lit le port et les URL depuis l’environnement', () => {
    const config = loadConfig({
      PORT: '4006',
      DATABASE_URL: 'postgres://u:p@db:5432/notifications',
      NATS_URL: 'nats://broker:4222',
      PLANIFICATION_URL: 'http://svc-planification:3004',
      NOTIF_APP_URL: 'https://creche.testlens.dev',
      NOTIF_SCHEDULER_HEURE: '9',
      NOTIF_SCHEDULER_FORCER: '1',
    });

    expect(config.port).toBe(4006);
    expect(config.databaseUrl).toBe('postgres://u:p@db:5432/notifications');
    expect(config.natsUrl).toBe('nats://broker:4222');
    expect(config.planificationUrl).toBe('http://svc-planification:3004');
    expect(config.appUrl).toBe('https://creche.testlens.dev');
    expect(config.schedulerHeure).toBe(9);
    expect(config.schedulerForcer).toBe(true);
  });

  it('lit la configuration e-mail et n’active l’envoi réel que sur DRY_RUN=false explicite', () => {
    const config = loadConfig({
      SMTP_HOST: 'smtp.example.org',
      SMTP_PORT: '2525',
      SMTP_USER: 'expediteur@example.org',
      SMTP_PASSWORD: 'secret-app-pwd',
      NOTIF_EMAIL_FROM: 'Crèche Planner <no-reply@example.org>',
      NOTIF_EMAIL_PARENT: 'parent@example.org',
      NOTIF_EMAIL_DRY_RUN: 'false',
      NOTIF_EMAIL_ALLOWLIST: 'parent@example.org, test@example.org',
    });

    expect(config.email).toEqual({
      host: 'smtp.example.org',
      port: 2525,
      user: 'expediteur@example.org',
      password: 'secret-app-pwd',
      from: 'Crèche Planner <no-reply@example.org>',
      parent: 'parent@example.org',
      dryRun: false,
      allowlist: ['parent@example.org', 'test@example.org'],
    });
  });

  it('toute valeur de DRY_RUN autre que "false" laisse le dry-run actif', () => {
    for (const valeur of ['true', '0', 'FALSE', '']) {
      expect(loadConfig({ NOTIF_EMAIL_DRY_RUN: valeur }).email.dryRun).toBe(
        true,
      );
    }
  });

  it('refuse le démarrage sur une heure de scheduler impossible', () => {
    // `NOTIF_SCHEDULER_HEURE=25` donnait 25 : la fenêtre « mardi ≥ heure » ne
    // s'ouvrait jamais, et aucun récap ne partait plus — sans une ligne de log.
    for (const valeur of ['25', 'huit', '-1']) {
      expect(() => loadConfig({ NOTIF_SCHEDULER_HEURE: valeur })).toThrow(
        /NOTIF_SCHEDULER_HEURE/u,
      );
    }
    expect(loadConfig({ NOTIF_SCHEDULER_HEURE: '0' }).schedulerHeure).toBe(0);
  });

  it('nomme la variable fautive sans citer le secret qu’elle porte', () => {
    // Le champ éprouvé ici est `DATABASE_URL` : il **peut** échouer (schéma d'URL
    // borné) ET sa valeur porte un mot de passe. Une assertion sur `SMTP_PASSWORD`
    // serait vide de sens — ce champ n'a aucune contrainte, il ne peut jamais
    // produire de constat, donc jamais rien fuiter.
    let message = '';
    try {
      loadConfig({ DATABASE_URL: 'mysql://u:mot-de-passe-secret@db:3306/n' });
    } catch (erreur) {
      message = (erreur as Error).message;
    }
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('mot-de-passe-secret');
    expect(message).toMatch(/caractère\(s\)/u);
  });

  it('refuse un mot de passe SMTP entouré d’espaces', () => {
    // Rogné en silence, il ferait échouer l'authentification SMTP au premier
    // envoi réel — loin du démarrage, et sans rapport apparent avec la config.
    expect(() =>
      loadConfig({ SMTP_PASSWORD: 'mot-de-passe-applicatif ' }),
    ).toThrow(/SMTP_PASSWORD.*espaces/su);
  });
});

/**
 * Lot 7 — le lien du mail de rappel doit pointer vers une URL de base publique
 * (https + domaine), jamais l'IP LAN du serveur (`192.168.1.129`, certificat non
 * fiable, injoignable hors-LAN) ni `localhost`. `estUrlEmailPublique` est le
 * critère **pur** ; la règle de production `REGLE_URLS_LIENS_EMAIL` en fait un
 * garde-fou de démarrage.
 *
 * ⚠️ Ce critère est **métier** : un `z.url()` accepterait `https://192.168.1.129`
 * sans broncher. Le lot 5 l'a donc gardé comme règle explicite au lieu de le
 * dissoudre dans la validation de forme.
 */
describe('estUrlEmailPublique (svc-notifications — URL des liens e-mail)', () => {
  it('accepte une URL https à nom de domaine public', () => {
    expect(estUrlEmailPublique('https://creche.testlens.dev')).toBe(true);
    expect(estUrlEmailPublique('https://creche.testlens.dev/foyers/1')).toBe(
      true,
    );
    expect(estUrlEmailPublique('https://sous.domaine.example.org')).toBe(true);
  });

  it('refuse une IP littérale (IPv4, dont l’IP LAN du serveur, ou IPv6)', () => {
    expect(estUrlEmailPublique('https://192.168.1.129')).toBe(false);
    expect(estUrlEmailPublique('https://192.168.1.129/foyers/1')).toBe(false);
    expect(estUrlEmailPublique('https://10.0.0.1')).toBe(false);
    expect(estUrlEmailPublique('https://[2001:db8::1]')).toBe(false);
  });

  it('refuse http:// (protocole non https)', () => {
    expect(estUrlEmailPublique('http://creche.testlens.dev')).toBe(false);
    expect(estUrlEmailPublique('http://localhost:4200')).toBe(false);
  });

  it('refuse localhost et une URL non parsable', () => {
    expect(estUrlEmailPublique('https://localhost')).toBe(false);
    expect(estUrlEmailPublique('https://localhost:4200')).toBe(false);
    expect(estUrlEmailPublique('pas-une-url')).toBe(false);
    expect(estUrlEmailPublique('')).toBe(false);
  });
});

describe('loadConfig — URL des liens e-mail en production', () => {
  it('refuse de démarrer en production sur une IP LAN (NOTIF_APP_URL)', () => {
    expect(() =>
      loadConfig({ ...PROD, NOTIF_APP_URL: 'https://192.168.1.129' }),
    ).toThrow(/NOTIF_APP_URL=https:\/\/192\.168\.1\.129/u);
  });

  it('refuse de démarrer en production sur une IP LAN (NOTIF_PUBLIC_API_URL)', () => {
    expect(() =>
      loadConfig({ ...PROD, NOTIF_PUBLIC_API_URL: 'https://192.168.1.129' }),
    ).toThrow(/NOTIF_PUBLIC_API_URL=https:\/\/192\.168\.1\.129/u);
  });

  it('refuse aussi le repli http://localhost en production', () => {
    // Deux constats se cumulent ici, et c'est voulu : le repli localhost non posé
    // (constat automatique de la trousse) ET la règle métier des liens d'e-mail.
    expect(() => loadConfig({ NODE_ENV: 'production', ...AMONTS })).toThrow(
      /URL https à nom de domaine public/u,
    );
  });

  it('démarre en production avec un domaine public https', () => {
    expect(() => loadConfig(PROD)).not.toThrow();
  });

  it("n'exige rien hors production (dev local, test, NODE_ENV absent)", () => {
    // Le repli http://localhost:4200 et les piles e2e restent valides.
    for (const env of [{}, { NODE_ENV: 'development' }, { NODE_ENV: 'test' }]) {
      expect(() => loadConfig(env)).not.toThrow();
    }
  });
});
