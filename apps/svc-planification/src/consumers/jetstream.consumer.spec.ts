import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConsumerMessages, JsMsg } from 'nats';
import type { NatsService } from '@creche-planner/nest-commons';
import { JetStreamConsumer } from './jetstream.consumer.js';
import type { ProjectionService } from './projection.service.js';

/**
 * Tests du **cycle de vie** du consommateur durable (binding, boucle ACK/NAK,
 * réessai, arrêt) avec un NATS factice. La projection elle-même est couverte par
 * `projection.service.spec.ts` ; ici elle est un stub piloté par test.
 */

const encoder = new TextEncoder();

/** Message JetStream factice : data JSON + espions ack/nak. */
function fauxMessage(donnees: unknown): JsMsg {
  return {
    data:
      typeof donnees === 'string'
        ? encoder.encode(donnees) // brut (permet un JSON invalide)
        : encoder.encode(JSON.stringify(donnees)),
    ack: vi.fn(),
    nak: vi.fn(),
  } as unknown as JsMsg;
}

/** Itérable de messages consommables, avec `close()` espionnable. */
function fauxIterateur(messages: JsMsg[]): ConsumerMessages {
  return {
    close: vi.fn(() => Promise.resolve()),
    [Symbol.asyncIterator]: async function* () {
      for (const message of messages) {
        yield message;
        await Promise.resolve();
      }
    },
  } as unknown as ConsumerMessages;
}

/** NATS factice : connexion + jetstream renvoyant l'itérable fourni. */
function fauxNats(messages: ConsumerMessages): {
  nats: NatsService;
  consumersAdd: ReturnType<typeof vi.fn>;
} {
  const consumersAdd = vi.fn(() => Promise.resolve());
  const nats = {
    getConnection: () => ({
      jetstreamManager: () =>
        Promise.resolve({ consumers: { add: consumersAdd } }),
    }),
    getJetStream: () => ({
      consumers: {
        get: () =>
          Promise.resolve({ consume: () => Promise.resolve(messages) }),
      },
    }),
  } as unknown as NatsService;
  return { nats, consumersAdd };
}

/** NATS factice « pas encore connecté » (binding impossible). */
function fauxNatsDeconnecte(): NatsService {
  return {
    getConnection: () => undefined,
    getJetStream: () => undefined,
  } as unknown as NatsService;
}

/** Attend que la boucle asynchrone ait traité les messages. */
async function laisserLaBoucleTourner(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await Promise.resolve();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('JetStreamConsumer (svc-planification, stream FOYER)', () => {
  it('lie le consommateur durable, ACK les messages appliqués et NAK les échecs transitoires', async () => {
    const applique = fauxMessage({ type: 'foyer.EnfantModifie.v1' });
    const enEchec = fauxMessage({ type: 'foyer.EnfantModifie.v1' });
    const { nats, consumersAdd } = fauxNats(fauxIterateur([applique, enEchec]));
    const projection = {
      traiter: vi
        .fn()
        .mockResolvedValueOnce(true) // 1ᵉʳ message : projeté → ACK
        .mockResolvedValueOnce(false), // 2ᵉ : erreur transitoire → NAK
    } as unknown as ProjectionService;
    const consommateur = new JetStreamConsumer(nats, projection);

    consommateur.onApplicationBootstrap();
    // La boucle est asynchrone : on attend l'effet observable final (le NAK du
    // dernier message) plutôt qu'un nombre arbitraire de microtâches.
    await vi.waitFor(() => {
      expect(enEchec.nak).toHaveBeenCalledTimes(1);
    });

    // Le consommateur durable a été créé (idempotent) sur le stream FOYER.
    expect(consumersAdd).toHaveBeenCalledWith(
      'FOYER',
      expect.objectContaining({ durable_name: 'planification-foyer' }),
    );
    expect(projection.traiter).toHaveBeenCalledTimes(2);
    expect(applique.ack).toHaveBeenCalledTimes(1);
    expect(enEchec.ack).not.toHaveBeenCalled();

    await consommateur.onApplicationShutdown();
  });

  it('ACK un message illisible (JSON invalide) sans le projeter, pour ne pas bloquer le stream', async () => {
    const illisible = fauxMessage('{pas du json');
    const { nats } = fauxNats(fauxIterateur([illisible]));
    const projection = {
      traiter: vi.fn(),
    } as unknown as ProjectionService;
    const consommateur = new JetStreamConsumer(nats, projection);

    consommateur.onApplicationBootstrap();
    await laisserLaBoucleTourner();

    expect(illisible.ack).toHaveBeenCalledTimes(1);
    expect(projection.traiter).not.toHaveBeenCalled();

    await consommateur.onApplicationShutdown();
  });

  it('NATS indisponible au boot : reprogramme le binding sans bloquer, puis se lie au réessai', async () => {
    vi.useFakeTimers();
    const message = fauxMessage({ type: 'foyer.EnfantModifie.v1' });
    const { nats } = fauxNats(fauxIterateur([message]));
    const projection = {
      traiter: vi.fn().mockResolvedValue(true),
    } as unknown as ProjectionService;
    const deconnecte = fauxNatsDeconnecte();
    // 1ᵉʳ essai : déconnecté ; à partir du réessai : connecté.
    const hybride = {
      getConnection: vi
        .fn()
        .mockReturnValueOnce(deconnecte.getConnection())
        .mockImplementation(() => nats.getConnection()),
      getJetStream: vi
        .fn()
        .mockReturnValueOnce(deconnecte.getJetStream())
        .mockImplementation(() => nats.getJetStream()),
    } as unknown as NatsService;
    const consommateur = new JetStreamConsumer(hybride, projection);

    consommateur.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    // Rien n'est lié tant que NATS est indisponible.
    expect(projection.traiter).not.toHaveBeenCalled();

    // Le réessai (5 s) aboutit : la boucle consomme et acquitte.
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(message.ack).toHaveBeenCalledTimes(1);

    await consommateur.onApplicationShutdown();
  });

  it('à l’arrêt : ferme les itérateurs de consommation (drain best-effort)', async () => {
    const iterateur = fauxIterateur([]);
    const { nats } = fauxNats(iterateur);
    const projection = {
      traiter: vi.fn(),
    } as unknown as ProjectionService;
    const consommateur = new JetStreamConsumer(nats, projection);

    consommateur.onApplicationBootstrap();
    await laisserLaBoucleTourner();
    await consommateur.onApplicationShutdown();

    expect(iterateur.close).toHaveBeenCalledTimes(1);
  });
});
