import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OptionsDatabase } from './database.options.js';
import { MigrationService } from './migration.service.js';

/**
 * Lot A7 (consolidation, risques prod) : l'état des migrations est observable —
 * jauge `migrations_en_attente` (0/1), compteur `migrations_echecs_total`, et
 * accesseurs `sontAppliquees()` / `derniereErreur()` consommés par la sonde
 * readiness. On mocke l'API OTel (modèle : outbox.relay.spec.ts) ainsi que
 * postgres/drizzle pour piloter le succès ou l'échec de `migrate`.
 */
const { addEchec, addCallback, removeCallback, migrateMock, endMock } =
  vi.hoisted(() => ({
    addEchec: vi.fn(),
    addCallback: vi.fn(),
    removeCallback: vi.fn(),
    migrateMock: vi.fn(),
    endMock: vi.fn(() => Promise.resolve()),
  }));

vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: () => ({
      createCounter: () => ({ add: addEchec }),
      createObservableGauge: () => ({ addCallback, removeCallback }),
    }),
  },
}));

vi.mock('postgres', () => ({
  default: vi.fn(() => ({ end: endMock })),
}));

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: vi.fn(() => ({})),
}));

vi.mock('drizzle-orm/postgres-js/migrator', () => ({
  migrate: migrateMock,
}));

const options: OptionsDatabase = {
  schema: {},
  urlBase: () => 'postgres://test',
  dossierMigrations: '/dist/database/migrations',
};

/** Rejoue le callback de la jauge capté par le mock et renvoie la valeur observée. */
function valeurJauge(): number | undefined {
  const callback = addCallback.mock.calls[0]?.[0] as (r: {
    observe: (v: number) => void;
  }) => void;
  const observe = vi.fn();
  callback({ observe });
  return observe.mock.calls[0]?.[0] as number | undefined;
}

describe('MigrationService — état observable des migrations (lot A7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    addEchec.mockClear();
    addCallback.mockClear();
    removeCallback.mockClear();
    migrateMock.mockReset();
    endMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('succès : migrations appliquées, aucun échec compté, connexion refermée', async () => {
    migrateMock.mockResolvedValue(undefined);
    const service = new MigrationService(options);

    await service.onModuleInit();

    expect(service.sontAppliquees()).toBe(true);
    expect(service.derniereErreur()).toBeUndefined();
    expect(addEchec).not.toHaveBeenCalled();
    expect(endMock).toHaveBeenCalledTimes(1);
  });

  it('jauge : observe 1 avant application, 0 après', async () => {
    migrateMock.mockResolvedValue(undefined);
    const service = new MigrationService(options);

    expect(service.sontAppliquees()).toBe(false);
    await service.onModuleInit();

    expect(addCallback).toHaveBeenCalledTimes(1);
    expect(valeurJauge()).toBe(0);
  });

  it('échec : compte migrations_echecs_total, expose la cause, jauge à 1', async () => {
    migrateMock.mockRejectedValue(new Error('relation manquante'));
    const service = new MigrationService(options);

    await service.onModuleInit();

    expect(service.sontAppliquees()).toBe(false);
    expect(service.derniereErreur()).toBe('relation manquante');
    expect(addEchec).toHaveBeenCalledTimes(1);
    expect(addEchec).toHaveBeenCalledWith(1);
    expect(valeurJauge()).toBe(1);
    service.onApplicationShutdown();
  });

  it('retry : réessaie 5 s après un échec, puis passe appliqué au succès', async () => {
    migrateMock
      .mockRejectedValueOnce(new Error('base indisponible'))
      .mockResolvedValueOnce(undefined);
    const service = new MigrationService(options);

    await service.onModuleInit();
    expect(service.sontAppliquees()).toBe(false);
    expect(migrateMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);

    expect(migrateMock).toHaveBeenCalledTimes(2);
    expect(service.sontAppliquees()).toBe(true);
    expect(service.derniereErreur()).toBeUndefined();
    expect(addEchec).toHaveBeenCalledTimes(1);
  });

  it('shutdown : annule le retry en attente et retire le callback de jauge', async () => {
    migrateMock.mockRejectedValue(new Error('base indisponible'));
    const service = new MigrationService(options);

    await service.onModuleInit();
    service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(15000);

    expect(migrateMock).toHaveBeenCalledTimes(1);
    expect(removeCallback).toHaveBeenCalledTimes(1);
    // Le callback enregistré et retiré est le même (sinon la jauge fuiterait).
    expect(removeCallback.mock.calls[0]?.[0]).toBe(
      addCallback.mock.calls[0]?.[0],
    );
  });
});
