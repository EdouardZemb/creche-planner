import { describe, expect, it, vi } from 'vitest';
import type {
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import type { Sql } from 'postgres';
import type { MigrationsHealthIndicator } from './migrations.health.js';
import { DatabaseHealthIndicator } from './database.health.js';
import { NatsHealthIndicator } from './nats.health.js';
import { HealthController } from './health.controller.js';
import type { NatsService } from '../messaging/nats.service.js';

/**
 * Sondes de santé des services (`svc-*`). Deux propriétés valent d'être
 * verrouillées ici, parce qu'une régression sur l'une ou l'autre est invisible
 * en développement et coûteuse en prod :
 *
 * - **liveness ≠ readiness** : `/api/health/live` ne sonde AUCUNE dépendance.
 *   Les healthchecks compose et la sonde blackbox pointent dessus ; y ajouter un
 *   amont déclencherait des restarts en cascade (contrainte héritée du lot A7).
 * - **readiness = DB + migrations + NATS**, dans cet ordre : c'est ce triplet qui
 *   fait qu'un service au schéma en retard n'encaisse pas de trafic.
 */

/** Terminus mocké au plus simple (même patron que `migrations.health.spec`). */
function fakeTerminus(cle: string): {
  service: HealthIndicatorService;
  up: ReturnType<typeof vi.fn>;
  down: ReturnType<typeof vi.fn>;
} {
  const up = vi.fn(() => ({ [cle]: { status: 'up' } }));
  const down = vi.fn((details?: Record<string, unknown>) => ({
    [cle]: { status: 'down', ...details },
  }));
  return {
    service: {
      check: () => ({ up, down }),
    } as unknown as HealthIndicatorService,
    up,
    down,
  };
}

describe('DatabaseHealthIndicator', () => {
  it('up quand le `select 1` passe', async () => {
    const { service, up } = fakeTerminus('database');
    const sql = vi.fn(() => Promise.resolve([{ '?column?': 1 }]));

    await new DatabaseHealthIndicator(sql as unknown as Sql, service).isHealthy(
      'database',
    );

    expect(up).toHaveBeenCalledOnce();
  });

  it('down AVEC la cause quand la base refuse la requête', async () => {
    const { service, down } = fakeTerminus('database');
    const sql = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')));

    await new DatabaseHealthIndicator(sql as unknown as Sql, service).isHealthy(
      'database',
    );

    expect(down).toHaveBeenCalledWith({ message: 'ECONNREFUSED' });
  });
});

describe('NatsHealthIndicator', () => {
  it.each([
    [true, 'up'],
    [false, 'down'],
  ])('connexion NATS = %s → %s', (connecte, attendu) => {
    const { service, up, down } = fakeTerminus('nats');
    const nats = { estConnecte: () => connecte } as unknown as NatsService;

    new NatsHealthIndicator(nats, service).isHealthy('nats');

    expect(attendu === 'up' ? up : down).toHaveBeenCalledOnce();
  });
});

describe('HealthController', () => {
  function controleur(): {
    ctrl: HealthController;
    check: ReturnType<typeof vi.fn>;
  } {
    const check = vi.fn(() => Promise.resolve({ status: 'ok' }));
    const ctrl = new HealthController(
      { check } as unknown as HealthCheckService,
      { isHealthy: vi.fn() } as unknown as DatabaseHealthIndicator,
      { isHealthy: vi.fn() } as unknown as MigrationsHealthIndicator,
      { isHealthy: vi.fn() } as unknown as NatsHealthIndicator,
    );
    return { ctrl, check };
  }

  it('la readiness sonde la base, les migrations puis NATS', async () => {
    const { ctrl, check } = controleur();

    await ctrl.readiness();

    expect(check).toHaveBeenCalledOnce();
    expect(check.mock.calls[0]?.[0]).toHaveLength(3);
  });

  it('la liveness ne sonde AUCUNE dépendance (sinon restarts en cascade)', async () => {
    const { ctrl, check } = controleur();

    await ctrl.liveness();

    expect(check).toHaveBeenCalledWith([]);
  });

  it('chaque sonde de readiness est bien celle de l’indicateur correspondant', async () => {
    const check = vi.fn((sondes: (() => unknown)[]) => {
      sondes.forEach((sonde) => sonde());
      return Promise.resolve({ status: 'ok' });
    });
    const database = { isHealthy: vi.fn() };
    const migrations = { isHealthy: vi.fn() };
    const nats = { isHealthy: vi.fn() };

    await new HealthController(
      { check } as unknown as HealthCheckService,
      database as unknown as DatabaseHealthIndicator,
      migrations as unknown as MigrationsHealthIndicator,
      nats as unknown as NatsHealthIndicator,
    ).readiness();

    expect(database.isHealthy).toHaveBeenCalledWith('database');
    expect(migrations.isHealthy).toHaveBeenCalledWith('migrations');
    expect(nats.isHealthy).toHaveBeenCalledWith('nats');
  });
});
