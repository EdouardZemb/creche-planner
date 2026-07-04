import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

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
