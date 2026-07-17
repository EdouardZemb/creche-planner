import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConsumerMessages, JsMsg } from 'nats';
import type { NatsService } from './nats.service.js';
import type { ProjectionPort, ResultatTraitement } from './consumer.types.js';
import type { DeadLetterService } from './dead-letter.service.js';
import type { OptionsConsumer } from './dead-letter.options.js';
import { JetStreamConsumer } from './jetstream-consumer.js';

/**
 * Spec de **référence unique** du consommateur JetStream mutualisé (les 3 services
 * n'ont plus de copie). Couvre le cycle de vie (binding, boucle, réessai, arrêt)
 * **et** chaque issue de traitement : ACK/NAK, dead-letter par raison, et
 * épuisement des livraisons (`MAX_LIVRAISONS`). NATS, la projection et le
 * `DeadLetterService` sont des doubles pilotés par test.
 */

const encoder = new TextEncoder();
const SUJET = 'foyer.EnfantModifie.v1';

/** Message JetStream factice : data JSON + espions ack/nak/term + livraisons. */
function fauxMessage(
  donnees: unknown,
  options: { deliveryCount?: number; subject?: string } = {},
): JsMsg {
  return {
    subject: options.subject ?? SUJET,
    info: { deliveryCount: options.deliveryCount ?? 1 },
    data:
      typeof donnees === 'string'
        ? encoder.encode(donnees) // brut (permet un JSON invalide)
        : encoder.encode(JSON.stringify(donnees)),
    ack: vi.fn(),
    nak: vi.fn(),
    term: vi.fn(),
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

/** Projection factice renvoyant les résultats fournis, dans l'ordre. */
function fauxProjection(...resultats: ResultatTraitement[]): ProjectionPort {
  const traiter = vi.fn();
  for (const r of resultats) {
    traiter.mockResolvedValueOnce(r);
  }
  return { traiter };
}

/** DeadLetterService factice espionnable. */
function fauxDeadLetter(): DeadLetterService {
  return {
    enregistrer: vi.fn(() => Promise.resolve()),
  } as unknown as DeadLetterService;
}

const OPTIONS: OptionsConsumer = {
  abonnements: [{ stream: 'FOYER', durable: 'test-foyer' }],
  tableDeadLetter: {} as OptionsConsumer['tableDeadLetter'],
};

/** Construit un consommateur avec les doubles fournis. */
function construire(
  nats: NatsService,
  projection: ProjectionPort,
  deadLetter: DeadLetterService,
): JetStreamConsumer {
  return new JetStreamConsumer(nats, projection, deadLetter, OPTIONS);
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

describe('JetStreamConsumer (mutualisé)', () => {
  it('lie le consommateur durable, ACK un message TRAITE et NAK un ECHEC_TRANSITOIRE', async () => {
    const traite = fauxMessage({ id: 'a', type: SUJET });
    const enEchec = fauxMessage({ id: 'b', type: SUJET });
    const { nats, consumersAdd } = fauxNats(fauxIterateur([traite, enEchec]));
    const projection = fauxProjection('TRAITE', 'ECHEC_TRANSITOIRE');
    const deadLetter = fauxDeadLetter();
    const consommateur = construire(nats, projection, deadLetter);

    consommateur.onApplicationBootstrap();
    await vi.waitFor(() => {
      expect(enEchec.nak).toHaveBeenCalledTimes(1);
    });

    expect(consumersAdd).toHaveBeenCalledWith(
      'FOYER',
      expect.objectContaining({ durable_name: 'test-foyer' }),
    );
    expect(projection.traiter).toHaveBeenCalledTimes(2);
    expect(traite.ack).toHaveBeenCalledTimes(1);
    expect(enEchec.ack).not.toHaveBeenCalled();
    expect(enEchec.nak).toHaveBeenCalledWith(2000);
    // Un échec transitoire (loin du max) ne doit PAS partir en dead-letter.
    expect(deadLetter.enregistrer).not.toHaveBeenCalled();

    await consommateur.onApplicationShutdown();
  });

  it('JSON illisible : dead-letter PARSE_KO + ACK, sans appeler la projection', async () => {
    const illisible = fauxMessage('{pas du json');
    const { nats } = fauxNats(fauxIterateur([illisible]));
    const projection = fauxProjection();
    const deadLetter = fauxDeadLetter();
    const consommateur = construire(nats, projection, deadLetter);

    consommateur.onApplicationBootstrap();
    await vi.waitFor(() => {
      expect(illisible.ack).toHaveBeenCalledTimes(1);
    });

    expect(projection.traiter).not.toHaveBeenCalled();
    expect(deadLetter.enregistrer).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: 'FOYER',
        sujet: SUJET,
        raison: 'PARSE_KO',
        envelopeId: null,
      }),
    );

    await consommateur.onApplicationShutdown();
  });

  it('enveloppe sans type (IGNORE_ENVELOPPE_INVALIDE) : dead-letter ENVELOPPE_INVALIDE + ACK', async () => {
    const message = fauxMessage({ id: 'c', foo: 'bar' });
    const { nats } = fauxNats(fauxIterateur([message]));
    const projection = fauxProjection('IGNORE_ENVELOPPE_INVALIDE');
    const deadLetter = fauxDeadLetter();
    const consommateur = construire(nats, projection, deadLetter);

    consommateur.onApplicationBootstrap();
    await vi.waitFor(() => {
      expect(message.ack).toHaveBeenCalledTimes(1);
    });

    expect(deadLetter.enregistrer).toHaveBeenCalledWith(
      expect.objectContaining({
        raison: 'ENVELOPPE_INVALIDE',
        envelopeId: 'c',
      }),
    );

    await consommateur.onApplicationShutdown();
  });

  it('type non géré (IGNORE_TYPE_INCONNU) : dead-letter TYPE_INCONNU + ACK', async () => {
    const message = fauxMessage({ id: 'd', type: 'autre.Chose.v1' });
    const { nats } = fauxNats(fauxIterateur([message]));
    const projection = fauxProjection('IGNORE_TYPE_INCONNU');
    const deadLetter = fauxDeadLetter();
    const consommateur = construire(nats, projection, deadLetter);

    consommateur.onApplicationBootstrap();
    await vi.waitFor(() => {
      expect(message.ack).toHaveBeenCalledTimes(1);
    });

    expect(deadLetter.enregistrer).toHaveBeenCalledWith(
      expect.objectContaining({ raison: 'TYPE_INCONNU', envelopeId: 'd' }),
    );

    await consommateur.onApplicationShutdown();
  });

  it('ECHEC_TRANSITOIRE à la 2ᵉ livraison : NAK, pas de dead-letter (loin du max)', async () => {
    const message = fauxMessage({ id: 'e', type: SUJET }, { deliveryCount: 2 });
    const { nats } = fauxNats(fauxIterateur([message]));
    const projection = fauxProjection('ECHEC_TRANSITOIRE');
    const deadLetter = fauxDeadLetter();
    const consommateur = construire(nats, projection, deadLetter);

    consommateur.onApplicationBootstrap();
    await vi.waitFor(() => {
      expect(message.nak).toHaveBeenCalledTimes(1);
    });

    expect(deadLetter.enregistrer).not.toHaveBeenCalled();
    expect(message.term).not.toHaveBeenCalled();

    await consommateur.onApplicationShutdown();
  });

  it('ECHEC_TRANSITOIRE à la 10ᵉ livraison (MAX_LIVRAISONS) : dead-letter + term(), pas de NAK', async () => {
    const message = fauxMessage(
      { id: 'f', type: SUJET },
      { deliveryCount: 10 },
    );
    const { nats } = fauxNats(fauxIterateur([message]));
    const projection = fauxProjection('ECHEC_TRANSITOIRE');
    const deadLetter = fauxDeadLetter();
    const consommateur = construire(nats, projection, deadLetter);

    consommateur.onApplicationBootstrap();
    await vi.waitFor(() => {
      expect(message.term).toHaveBeenCalledTimes(1);
    });

    expect(message.nak).not.toHaveBeenCalled();
    expect(deadLetter.enregistrer).toHaveBeenCalledWith(
      expect.objectContaining({
        raison: 'MAX_LIVRAISONS',
        envelopeId: 'f',
        livraisons: 10,
      }),
    );

    await consommateur.onApplicationShutdown();
  });

  it('NATS indisponible au boot : reprogramme le binding, puis se lie au réessai', async () => {
    vi.useFakeTimers();
    const message = fauxMessage({ id: 'g', type: SUJET });
    const { nats } = fauxNats(fauxIterateur([message]));
    const projection = fauxProjection('TRAITE');
    const deadLetter = fauxDeadLetter();
    const deconnecte = fauxNatsDeconnecte();
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
    const consommateur = construire(hybride, projection, deadLetter);

    consommateur.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(projection.traiter).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(message.ack).toHaveBeenCalledTimes(1);

    await consommateur.onApplicationShutdown();
  });

  it('à l’arrêt : ferme les itérateurs de consommation (drain best-effort)', async () => {
    const iterateur = fauxIterateur([]);
    const { nats } = fauxNats(iterateur);
    const projection = fauxProjection();
    const deadLetter = fauxDeadLetter();
    const consommateur = construire(nats, projection, deadLetter);

    consommateur.onApplicationBootstrap();
    await laisserLaBoucleTourner();
    await consommateur.onApplicationShutdown();

    expect(iterateur.close).toHaveBeenCalledTimes(1);
  });
});
