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
function evenement(
  id: string,
  extra: { type?: string; payload?: unknown } = {},
): Record<string, unknown> {
  return {
    id,
    type: extra.type ?? 'test.Event.v1',
    occurredAt: new Date('2026-07-17T08:00:00Z'),
    traceId: 'trace-1',
    payload: extra.payload ?? { foo: 'bar' },
  };
}

interface OptionsDb {
  readonly evenements?: readonly unknown[];
  readonly backlog?: number;
  /** `null` = file vide (`min()` sur zéro ligne rend `NULL`). */
  readonly ageSecondes?: number | null;
  readonly selectThrows?: boolean;
}

/**
 * Faux `db` dispatchant les trois requêtes du relais sur la **forme de la
 * projection** demandée : `select()` (drain), `select({n})` (backlog),
 * `select({secondes})` (âge d'attente).
 */
function fakeDb(opts: OptionsDb = {}): PostgresJsDatabase {
  const evenements = opts.evenements ?? [];
  const backlog = opts.backlog ?? 0;
  const ageSecondes = opts.ageSecondes ?? null;
  return {
    select: vi.fn((arg?: unknown) => {
      if (opts.selectThrows) {
        throw new Error('base indisponible');
      }
      if (arg === undefined) {
        return fakeBuilder(evenements);
      }
      const projection = arg as Record<string, unknown>;
      return fakeBuilder(
        'secondes' in projection
          ? [{ secondes: ageSecondes }]
          : [{ n: backlog }],
      );
    }),
    update: vi.fn(() => fakeBuilder([])),
  } as unknown as PostgresJsDatabase;
}

/** Callback OTel enregistré par la n-ième jauge (0 = backlog, 1 = âge). */
function callbackJauge(
  index: number,
): (r: { observe: (v: number) => void }) => Promise<void> {
  return addCallback.mock.calls[index]?.[0] as (r: {
    observe: (v: number) => void;
  }) => Promise<void>;
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
    // Depuis `AM-61` l'échec est attribué au `type` du message refusé : l'alerte
    // dit alors *lequel* bloque, au lieu d'un décompte de cycles anonymes.
    expect(addEchec).toHaveBeenCalledWith(1, { type: 'test.Event.v1' });
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

  it('bootstrap enregistre les deux callbacks de jauge, shutdown les retire', () => {
    const relay = new OutboxRelay(fakeDb({ backlog: 3 }), fakeNats(), options);

    relay.onApplicationBootstrap();
    expect(addCallback).toHaveBeenCalledTimes(2);

    relay.onApplicationShutdown();
    expect(removeCallback).toHaveBeenCalledTimes(2);
    // Les callbacks enregistrés et retirés sont les mêmes (sinon les jauges fuiteraient).
    expect(removeCallback.mock.calls.map((appel): unknown => appel[0])).toEqual(
      addCallback.mock.calls.map((appel): unknown => appel[0]),
    );
  });

  it('callback de jauge : observe le backlog courant', async () => {
    const relay = new OutboxRelay(fakeDb({ backlog: 12 }), fakeNats(), options);
    relay.onApplicationBootstrap();
    relay.onApplicationShutdown(); // stoppe le timer de drain, garde le callback capté

    const observe = vi.fn();
    await callbackJauge(0)({ observe });

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

    const observe = vi.fn();
    await expect(callbackJauge(0)({ observe })).resolves.toBeUndefined();

    expect(observe).not.toHaveBeenCalled();
  });
});

/**
 * `AM-61` — la file peut être **courte et arrêtée**. `outbox_backlog` compte sans
 * dater : deux événements en attente, c'est normal une seconde après leur écriture
 * et grave trois jours plus tard, et l'alerte de volume (seuil 25) ne se déclenche
 * dans aucun des deux cas. La jauge d'âge est ce qui rend le blocage visible.
 */
describe("OutboxRelay — âge d'attente (AM-61)", () => {
  beforeEach(() => {
    addCallback.mockClear();
    removeCallback.mockClear();
  });

  it("rend l'âge de la plus vieille ligne non publiée", async () => {
    const relay = new OutboxRelay(
      fakeDb({ ageSecondes: 259_200 }),
      fakeNats(),
      options,
    );

    await expect(relay.ageAttenteSecondes()).resolves.toBe(259_200);
  });

  it('rend 0 quand la file est vide (min() sur zéro ligne vaut NULL)', async () => {
    const relay = new OutboxRelay(
      fakeDb({ ageSecondes: null }),
      fakeNats(),
      options,
    );

    await expect(relay.ageAttenteSecondes()).resolves.toBe(0);
  });

  it("la jauge d'âge observe cet âge", async () => {
    const relay = new OutboxRelay(
      fakeDb({ ageSecondes: 42 }),
      fakeNats(),
      options,
    );
    relay.onApplicationBootstrap();
    relay.onApplicationShutdown();

    const observe = vi.fn();
    await callbackJauge(1)({ observe });

    expect(observe).toHaveBeenCalledWith(42);
  });

  it("la jauge d'âge ne tombe pas si la base est indisponible", async () => {
    const relay = new OutboxRelay(
      fakeDb({ selectThrows: true }),
      fakeNats(),
      options,
    );
    relay.onApplicationBootstrap();
    relay.onApplicationShutdown();

    const observe = vi.fn();
    await expect(callbackJauge(1)({ observe })).resolves.toBeUndefined();

    expect(observe).not.toHaveBeenCalled();
  });

  it("l'âge est calculé en base, sur occurred_at et now() — pas en JS", async () => {
    let projection: Record<string, unknown> | undefined;
    const db = {
      select: vi.fn((arg?: unknown) => {
        projection = arg as Record<string, unknown>;
        return fakeBuilder([{ secondes: 1 }]);
      }),
    } as unknown as PostgresJsDatabase;
    const relay = new OutboxRelay(db, fakeNats(), options);

    await relay.ageAttenteSecondes();

    // Le SQL rendu doit dater l'événement (`occurred_at`) avec l'horloge de la base,
    // et forcer un `double precision` — `extract(epoch …)` rend un `numeric`, que
    // `postgres.js` mappe sur une chaîne, ce qui exporterait `NaN`.
    const rendu = JSON.stringify(projection?.['secondes'] ?? '');
    expect(rendu).toContain('now()');
    expect(rendu).toContain('double precision');
  });
});

/**
 * `AM-61` — un seul événement durablement refusé ne doit plus figer la file. Le
 * `catch` enveloppait la **boucle entière** : la tête de file étant resélectionnée
 * à chaque cycle (`order by occurred_at`), un refus permanent — sujet hors des
 * `subjects` du stream, payload au-delà de `max_payload` — arrêtait la
 * publication de **tout** ce qui suivait, indéfiniment.
 *
 * Ces trois cas sont la sonde négative de l'isolation : ils échouent sur le code
 * d'avant `AM-61` (le premier événement consomme tout le cycle), et le dernier
 * distingue l'échec **d'un message** de l'échec **du cycle** — un `select` qui
 * lève reste un incident de base, pas un rebut.
 */
describe('OutboxRelay — isolation par événement (AM-61)', () => {
  beforeEach(() => {
    addEchec.mockClear();
  });

  /** Publie tout sauf les types/ids listés, qui échouent durablement. */
  function publierSauf(refuses: readonly string[]): Mock {
    return vi.fn((_sujet: string, id: string) =>
      refuses.includes(id)
        ? Promise.reject(new Error(`sujet hors stream (${id})`))
        : Promise.resolve(),
    );
  }

  it('un événement refusé ne bloque pas les suivants du même cycle', async () => {
    const publier = publierSauf(['e-poison']);
    const relay = new OutboxRelay(
      fakeDb({
        evenements: [evenement('e-poison'), evenement('e-2'), evenement('e-3')],
      }),
      fakeNats({ publier }),
      options,
    );

    await relay.drainer();

    // Les trois sont tentés, pas seulement le premier.
    expect(publier).toHaveBeenCalledTimes(3);
    const idsTentes = publier.mock.calls.map((appel) => appel[1] as string);
    expect(idsTentes).toEqual(['e-poison', 'e-2', 'e-3']);
  });

  it('un événement refusé est compté avec son type, une fois par tentative', async () => {
    const publier = publierSauf(['e-poison']);
    const relay = new OutboxRelay(
      fakeDb({ evenements: [evenement('e-poison'), evenement('e-2')] }),
      fakeNats({ publier }),
      options,
    );

    await relay.drainer();

    expect(addEchec).toHaveBeenCalledTimes(1);
    expect(addEchec).toHaveBeenCalledWith(1, { type: 'test.Event.v1' });
  });

  it('la tête de file refusée à chaque cycle laisse la queue avancer', async () => {
    const publier = publierSauf(['e-poison']);
    // La tête n'est jamais marquée publiée : le `select` la resélectionne à
    // chaque cycle, exactement comme en production.
    const relay = new OutboxRelay(
      fakeDb({ evenements: [evenement('e-poison'), evenement('e-2')] }),
      fakeNats({ publier }),
      options,
    );

    await relay.drainer();
    await relay.drainer();
    await relay.drainer();

    const publiesE2 = publier.mock.calls.filter(
      (appel) => appel[1] === 'e-2',
    ).length;
    expect(publiesE2).toBe(3);
  });

  /**
   * L'isolation seule **réordonne**, et le réordonnancement n'est pas neutre : un
   * effacement de foyer qui dépasse un `Parent*` en échec fait effacer chez les
   * consommateurs puis **ré-insérer** l'adresse e-mail quand le retardataire passe.
   * Les gardes `occurred_at` ne protègent que des lignes encore présentes, et
   * `processed_event` ne dit rien d'une **première** livraison tardive. L'ordre est
   * donc tenu par foyer.
   */
  const FOYER = '11111111-1111-4111-8111-111111111111';
  const AUTRE_FOYER = '22222222-2222-4222-8222-222222222222';

  it('un effacement ne dépasse pas un événement en échec du même foyer', async () => {
    const publier = publierSauf(['parent-ko']);
    const relay = new OutboxRelay(
      fakeDb({
        evenements: [
          evenement('parent-ko', {
            type: 'foyer.ParentModifie.v1',
            payload: { foyerId: FOYER, email: 'parent@example.test' },
          }),
          evenement('effacement', {
            type: 'foyer.FoyerSupprime.v1',
            payload: { foyerId: FOYER, parentIds: [] },
          }),
        ],
      }),
      fakeNats({ publier }),
      options,
    );

    await relay.drainer();

    const idsTentes = publier.mock.calls.map((appel) => appel[1] as string);
    expect(idsTentes).toEqual(['parent-ko']);
  });

  it('un autre foyer avance malgré l’échec du premier', async () => {
    const publier = publierSauf(['parent-ko']);
    const relay = new OutboxRelay(
      fakeDb({
        evenements: [
          evenement('parent-ko', {
            type: 'foyer.ParentModifie.v1',
            payload: { foyerId: FOYER },
          }),
          evenement('voisin', {
            type: 'foyer.FoyerSupprime.v1',
            payload: { foyerId: AUTRE_FOYER, parentIds: [] },
          }),
        ],
      }),
      fakeNats({ publier }),
      options,
    );

    await relay.drainer();

    const idsTentes = publier.mock.calls.map((appel) => appel[1] as string);
    expect(idsTentes).toEqual(['parent-ko', 'voisin']);
  });

  it('un événement sans foyer identifiable reste pleinement isolé', async () => {
    const publier = publierSauf(['sans-foyer-ko']);
    const relay = new OutboxRelay(
      fakeDb({
        evenements: [
          evenement('sans-foyer-ko', { type: 'referentiel.GrillePubliee.v2' }),
          evenement('suivant', { type: 'referentiel.BaremePsuPublie.v1' }),
        ],
      }),
      fakeNats({ publier }),
      options,
    );

    await relay.drainer();

    const idsTentes = publier.mock.calls.map((appel) => appel[1] as string);
    expect(idsTentes).toEqual(['sans-foyer-ko', 'suivant']);
  });

  it('un select qui lève reste un échec de cycle, sans attribut de type', async () => {
    const relay = new OutboxRelay(
      fakeDb({ selectThrows: true }),
      fakeNats(),
      options,
    );

    await relay.drainer();

    expect(addEchec).toHaveBeenCalledTimes(1);
    expect(addEchec).toHaveBeenCalledWith(1);
  });
});
