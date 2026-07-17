import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { NatsService } from '../messaging/nats.service.js';
import type { OptionsOutbox } from './outbox.options.js';
import { OutboxRelay } from './outbox.relay.js';

/**
 * Lot 2 (fondations, métriques) : le relais outbox émet deux instruments OTel —
 * `outbox_publications_echecs_total` (incrément dans le `catch` du drain) et la jauge
 * observable `outbox_backlog` (callback `count(*) where published_at is null`). On
 * mocke l'API OTel pour capter l'incrément et le callback sans câbler de MeterProvider.
 *
 * `vi.hoisted` expose les spies au factory `vi.mock` (hissé au-dessus des imports).
 */
const { addEchec, addCallback, removeCallback } = vi.hoisted(() => ({
  addEchec: vi.fn(),
  addCallback: vi.fn(),
  removeCallback: vi.fn(),
}));

vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: () => ({
      createCounter: () => ({ add: addEchec }),
      createObservableGauge: () => ({ addCallback, removeCallback }),
    }),
  },
}));

/** Builder Drizzle factice : chaînable et thenable, résout `resultat` à l'`await`. */
function fakeBuilder(resultat: readonly unknown[]): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  const self = (): Record<string, unknown> => b;
  b['from'] = self;
  b['where'] = self;
  b['orderBy'] = self;
  b['limit'] = self;
  b['set'] = self;
  b['then'] = (
    onF: (v: readonly unknown[]) => unknown,
    onR?: (e: unknown) => unknown,
  ) => Promise.resolve(resultat).then(onF, onR);
  return b;
}

/** Événement outbox minimal (ce que `drainer()` lit et publie). */
function evenement(id: string): Record<string, unknown> {
  return {
    id,
    type: 'test.Event.v1',
    occurredAt: new Date('2026-07-17T08:00:00Z'),
    traceId: 'trace-1',
    payload: { foo: 'bar' },
  };
}

interface OptionsDb {
  readonly evenements?: readonly unknown[];
  readonly backlog?: number;
  readonly selectThrows?: boolean;
}

/** Faux `db` dispatchant `select()` (drain) vs `select({n})` (backlog). */
function fakeDb(opts: OptionsDb = {}): PostgresJsDatabase {
  const evenements = opts.evenements ?? [];
  const backlog = opts.backlog ?? 0;
  return {
    select: vi.fn((arg?: unknown) => {
      if (opts.selectThrows) {
        throw new Error('base indisponible');
      }
      return fakeBuilder(arg === undefined ? evenements : [{ n: backlog }]);
    }),
    update: vi.fn(() => fakeBuilder([])),
  } as unknown as PostgresJsDatabase;
}

interface OptionsNats {
  readonly connecte?: boolean;
  readonly publier?: Mock;
}

function fakeNats(opts: OptionsNats = {}): NatsService {
  return {
    estConnecte: () => opts.connecte ?? true,
    publier: opts.publier ?? vi.fn(() => Promise.resolve()),
  } as unknown as NatsService;
}

/** Table factice : seules les colonnes lues comme arguments SQL sont présentes. */
const options: OptionsOutbox = {
  source: 'test.source',
  table: {
    id: {},
    publishedAt: {},
    occurredAt: {},
  },
} as unknown as OptionsOutbox;

describe('OutboxRelay — métriques (lot 2)', () => {
  beforeEach(() => {
    addEchec.mockClear();
    addCallback.mockClear();
    removeCallback.mockClear();
  });

  it('drain nominal : publie, ne compte aucun échec', async () => {
    const publier = vi.fn(() => Promise.resolve());
    const relay = new OutboxRelay(
      fakeDb({ evenements: [evenement('e-1')] }),
      fakeNats({ publier }),
      options,
    );

    await relay.drainer();

    expect(publier).toHaveBeenCalledTimes(1);
    expect(addEchec).not.toHaveBeenCalled();
  });

  it('échec de publication : incrémente outbox_publications_echecs_total', async () => {
    const publier = vi.fn(() => Promise.reject(new Error('NATS injoignable')));
    const relay = new OutboxRelay(
      fakeDb({ evenements: [evenement('e-1')] }),
      fakeNats({ publier }),
      options,
    );

    await relay.drainer();

    expect(addEchec).toHaveBeenCalledTimes(1);
    expect(addEchec).toHaveBeenCalledWith(1);
  });

  it('NATS non connecté : ne draine pas et ne compte aucun échec', async () => {
    const publier = vi.fn(() => Promise.resolve());
    const relay = new OutboxRelay(
      fakeDb(),
      fakeNats({ connecte: false, publier }),
      options,
    );

    await relay.drainer();

    expect(publier).not.toHaveBeenCalled();
    expect(addEchec).not.toHaveBeenCalled();
  });

  it('compterBacklog : renvoie le count des lignes non publiées', async () => {
    const relay = new OutboxRelay(fakeDb({ backlog: 7 }), fakeNats(), options);

    await expect(relay.compterBacklog()).resolves.toBe(7);
  });

  it('compterBacklog : 0 quand la requête ne renvoie aucune ligne', async () => {
    const db = {
      select: vi.fn(() => fakeBuilder([])),
    } as unknown as PostgresJsDatabase;
    const relay = new OutboxRelay(db, fakeNats(), options);

    await expect(relay.compterBacklog()).resolves.toBe(0);
  });

  it('bootstrap enregistre le callback de jauge, shutdown le retire', () => {
    const relay = new OutboxRelay(fakeDb({ backlog: 3 }), fakeNats(), options);

    relay.onApplicationBootstrap();
    expect(addCallback).toHaveBeenCalledTimes(1);

    relay.onApplicationShutdown();
    expect(removeCallback).toHaveBeenCalledTimes(1);
    // Le callback enregistré et retiré est le même (sinon la jauge fuiterait).
    expect(removeCallback.mock.calls[0]?.[0]).toBe(
      addCallback.mock.calls[0]?.[0],
    );
  });

  it('callback de jauge : observe le backlog courant', async () => {
    const relay = new OutboxRelay(fakeDb({ backlog: 12 }), fakeNats(), options);
    relay.onApplicationBootstrap();
    relay.onApplicationShutdown(); // stoppe le timer de drain, garde le callback capté

    const callback = addCallback.mock.calls[0]?.[0] as (r: {
      observe: (v: number) => void;
    }) => Promise<void>;
    const observe = vi.fn();
    await callback({ observe });

    expect(observe).toHaveBeenCalledWith(12);
  });

  it('callback de jauge : base indisponible → n’observe rien et ne lève pas', async () => {
    const relay = new OutboxRelay(
      fakeDb({ selectThrows: true }),
      fakeNats(),
      options,
    );
    relay.onApplicationBootstrap();
    relay.onApplicationShutdown();

    const callback = addCallback.mock.calls[0]?.[0] as (r: {
      observe: (v: number) => void;
    }) => Promise<void>;
    const observe = vi.fn();
    await expect(callback({ observe })).resolves.toBeUndefined();

    expect(observe).not.toHaveBeenCalled();
  });
});
