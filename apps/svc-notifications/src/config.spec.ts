import { afterEach, describe, expect, it } from 'vitest';
import {
  estUrlEmailPublique,
  loadConfig,
  verifierConfigProduction,
} from './config.js';

describe('loadConfig (svc-notifications)', () => {
  const cles = [
    'PORT',
    'DATABASE_URL',
    'NATS_URL',
    'PLANIFICATION_URL',
    'NOTIF_APP_URL',
    'NOTIF_SCHEDULER_HEURE',
    'NOTIF_SCHEDULER_FORCER',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASSWORD',
    'NOTIF_EMAIL_FROM',
    'NOTIF_EMAIL_PARENT',
    'NOTIF_EMAIL_DRY_RUN',
    'NOTIF_EMAIL_ALLOWLIST',
  ] as const;
  const sauvegarde = new Map(cles.map((c) => [c, process.env[c]]));

  afterEach(() => {
    for (const c of cles) {
      const v = sauvegarde.get(c);
      if (v === undefined) delete process.env[c];
      else process.env[c] = v;
    }
  });

  it('applique les défauts de dev local quand l’environnement est vide', () => {
    for (const c of cles) delete process.env[c];

    const config = loadConfig();

    expect(config.port).toBe(3006);
    expect(config.databaseUrl).toContain('localhost:5437/notifications');
    expect(config.natsUrl).toBe('nats://localhost:4222');
    expect(config.planificationUrl).toBe('http://localhost:3004');
    expect(config.appUrl).toBe('http://localhost:4200');
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
    process.env['PORT'] = '4006';
    process.env['DATABASE_URL'] = 'postgres://u:p@db:5432/notifications';
    process.env['NATS_URL'] = 'nats://broker:4222';
    process.env['PLANIFICATION_URL'] = 'http://svc-planification:3004';
    process.env['NOTIF_APP_URL'] = 'https://creche.testlens.dev';
    process.env['NOTIF_SCHEDULER_HEURE'] = '9';
    process.env['NOTIF_SCHEDULER_FORCER'] = '1';

    const config = loadConfig();

    expect(config.port).toBe(4006);
    expect(config.databaseUrl).toBe('postgres://u:p@db:5432/notifications');
    expect(config.natsUrl).toBe('nats://broker:4222');
    expect(config.planificationUrl).toBe('http://svc-planification:3004');
    expect(config.appUrl).toBe('https://creche.testlens.dev');
    expect(config.schedulerHeure).toBe(9);
    expect(config.schedulerForcer).toBe(true);
  });

  it('lit la configuration e-mail et n’active l’envoi réel que sur DRY_RUN=false explicite', () => {
    process.env['SMTP_HOST'] = 'smtp.example.org';
    process.env['SMTP_PORT'] = '2525';
    process.env['SMTP_USER'] = 'expediteur@example.org';
    process.env['SMTP_PASSWORD'] = 'secret-app-pwd';
    process.env['NOTIF_EMAIL_FROM'] = 'Crèche Planner <no-reply@example.org>';
    process.env['NOTIF_EMAIL_PARENT'] = 'parent@example.org';
    process.env['NOTIF_EMAIL_DRY_RUN'] = 'false';
    process.env['NOTIF_EMAIL_ALLOWLIST'] =
      'parent@example.org, test@example.org';

    const config = loadConfig();

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
    process.env['NOTIF_EMAIL_DRY_RUN'] = 'true';
    expect(loadConfig().email.dryRun).toBe(true);

    process.env['NOTIF_EMAIL_DRY_RUN'] = '0';
    expect(loadConfig().email.dryRun).toBe(true);
  });
});

/**
 * Lot 7 — le lien du mail de rappel doit pointer vers une URL de base publique
 * (https + domaine), jamais l'IP LAN du serveur (`192.168.1.129`, certificat non
 * fiable, injoignable hors-LAN) ni `localhost`. `estUrlEmailPublique` est le
 * critère pur ; `verifierConfigProduction` en fait un garde-fou de démarrage
 * **prod-only**.
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

describe('verifierConfigProduction (svc-notifications — URL des liens e-mail)', () => {
  const dev = {
    appUrl: 'http://localhost:4200',
    publicApiUrl: 'http://localhost:3000',
  };
  const prod = {
    appUrl: 'https://creche.testlens.dev',
    publicApiUrl: 'https://creche.testlens.dev',
  };

  it('refuse de démarrer en production sur une IP LAN (NOTIF_APP_URL)', () => {
    expect(() => {
      verifierConfigProduction(
        { appUrl: 'https://192.168.1.129', publicApiUrl: prod.publicApiUrl },
        { NODE_ENV: 'production' },
      );
    }).toThrow(/NOTIF_APP_URL=https:\/\/192\.168\.1\.129/);
  });

  it('refuse de démarrer en production sur une IP LAN (NOTIF_PUBLIC_API_URL)', () => {
    expect(() => {
      verifierConfigProduction(
        { appUrl: prod.appUrl, publicApiUrl: 'https://192.168.1.129' },
        { NODE_ENV: 'production' },
      );
    }).toThrow(/NOTIF_PUBLIC_API_URL=https:\/\/192\.168\.1\.129/);
  });

  it('refuse aussi le défaut http://localhost en production', () => {
    expect(() => {
      verifierConfigProduction(dev, { NODE_ENV: 'production' });
    }).toThrow(/URL https à nom de domaine public/);
  });

  it('démarre en production avec un domaine public https', () => {
    expect(() => {
      verifierConfigProduction(prod, { NODE_ENV: 'production' });
    }).not.toThrow();
  });

  it("n'exige rien hors production (dev local, test, NODE_ENV absent)", () => {
    // Le défaut http://localhost:4200 et les stacks e2e restent valides.
    expect(() => {
      verifierConfigProduction(dev, {});
    }).not.toThrow();
    expect(() => {
      verifierConfigProduction(dev, { NODE_ENV: 'development' });
    }).not.toThrow();
    expect(() => {
      verifierConfigProduction(dev, { NODE_ENV: 'test' });
    }).not.toThrow();
  });
});
