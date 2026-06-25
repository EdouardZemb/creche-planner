import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig (svc-notifications)', () => {
  const cles = [
    'PORT',
    'DATABASE_URL',
    'NATS_URL',
    'PLANIFICATION_URL',
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
  });

  it('lit le port et les URL depuis l’environnement', () => {
    process.env['PORT'] = '4006';
    process.env['DATABASE_URL'] = 'postgres://u:p@db:5432/notifications';
    process.env['NATS_URL'] = 'nats://broker:4222';
    process.env['PLANIFICATION_URL'] = 'http://svc-planification:3004';

    const config = loadConfig();

    expect(config.port).toBe(4006);
    expect(config.databaseUrl).toBe('postgres://u:p@db:5432/notifications');
    expect(config.natsUrl).toBe('nats://broker:4222');
    expect(config.planificationUrl).toBe('http://svc-planification:3004');
  });
});
