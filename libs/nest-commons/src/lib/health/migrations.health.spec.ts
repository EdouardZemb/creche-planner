import { describe, expect, it, vi } from 'vitest';
import type { HealthIndicatorService } from '@nestjs/terminus';
import type { MigrationService } from '../database/migration.service.js';
import { MigrationsHealthIndicator } from './migrations.health.js';

/**
 * Lot A7 : la readiness reflète l'état du schéma — down tant que les migrations
 * ne sont pas appliquées (avec la cause), up ensuite. Terminus est mocké au plus
 * simple : `check(key)` rend un indicateur dont up/down renvoient un résultat typé.
 */
function fakeMigrations(opts: {
  appliquees: boolean;
  erreur?: string;
}): MigrationService {
  return {
    sontAppliquees: () => opts.appliquees,
    derniereErreur: () => opts.erreur,
  } as unknown as MigrationService;
}

function fakeTerminus(): {
  service: HealthIndicatorService;
  up: ReturnType<typeof vi.fn>;
  down: ReturnType<typeof vi.fn>;
} {
  const up = vi.fn(() => ({ migrations: { status: 'up' } }));
  const down = vi.fn((details: Record<string, unknown>) => ({
    migrations: { status: 'down', ...details },
  }));
  return {
    service: {
      check: () => ({ up, down }),
    } as unknown as HealthIndicatorService,
    up,
    down,
  };
}

describe('MigrationsHealthIndicator — readiness du schéma (lot A7)', () => {
  it('migrations appliquées : up', () => {
    const terminus = fakeTerminus();
    const indicator = new MigrationsHealthIndicator(
      fakeMigrations({ appliquees: true }),
      terminus.service,
    );

    indicator.isHealthy('migrations');

    expect(terminus.up).toHaveBeenCalledTimes(1);
    expect(terminus.down).not.toHaveBeenCalled();
  });

  it('migration en échec : down avec la cause', () => {
    const terminus = fakeTerminus();
    const indicator = new MigrationsHealthIndicator(
      fakeMigrations({ appliquees: false, erreur: 'relation manquante' }),
      terminus.service,
    );

    indicator.isHealthy('migrations');

    expect(terminus.down).toHaveBeenCalledWith({
      message: 'relation manquante',
    });
    expect(terminus.up).not.toHaveBeenCalled();
  });

  it('pas encore appliquées (boot en cours) : down avec message par défaut', () => {
    const terminus = fakeTerminus();
    const indicator = new MigrationsHealthIndicator(
      fakeMigrations({ appliquees: false }),
      terminus.service,
    );

    indicator.isHealthy('migrations');

    expect(terminus.down).toHaveBeenCalledWith({
      message: 'migrations non encore appliquées',
    });
  });
});
