import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NatsConnection } from 'nats';
import { NatsService } from './nats.service.js';
import type { OptionsNats } from './nats.options.js';

/**
 * Spec de non-régression du **provisionnement du stream** (`LE-57`).
 *
 * Le magasin JetStream a longtemps vécu dans la couche du conteneur : chaque
 * déploiement le remettait à zéro, ce qui tenait lieu de rétention. Depuis le
 * volume nommé (`AM-83`), plus rien ne borne le stream si le code ne le fait
 * pas — la politique `limits` par défaut ne supprime jamais, et l'acquittement
 * d'un consommateur explicite n'efface rien. La borne doit donc être posée à la
 * création **et** à la mise à jour : un stream né avant ce correctif n'en a
 * aucune, et c'est le chemin `update` qui la lui donne.
 */

const TRENTE_JOURS_EN_NANOSECONDES = 30 * 24 * 60 * 60 * 1_000_000_000;

const options: OptionsNats = {
  url: () => 'nats://exemple:4222',
  service: 'svc-test',
  stream: 'TEST',
  sujet: 'test.>',
};

/**
 * Connexion NATS factice. `streamsAdd` peut être piloté pour échouer, ce qui est
 * le cas réel d'un stream déjà présent (l'implémentation bascule alors sur
 * `update`).
 */
function fausseConnexion(options: { addEchoue?: boolean } = {}) {
  const streamsAdd = vi.fn(() =>
    options.addEchoue
      ? Promise.reject(new Error('stream name already in use'))
      : Promise.resolve({}),
  );
  const streamsUpdate = vi.fn(() => Promise.resolve({}));
  const connection = {
    getServer: () => 'nats://exemple:4222',
    jetstreamManager: () =>
      Promise.resolve({ streams: { add: streamsAdd, update: streamsUpdate } }),
    jetstream: () => ({}),
    isClosed: () => false,
  } as unknown as NatsConnection;
  return { connection, streamsAdd, streamsUpdate };
}

describe('NatsService — provisionnement du stream', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('crée le stream avec une borne d’âge de 30 jours', async () => {
    const { connection, streamsAdd } = fausseConnexion();
    const nats = new NatsService(options);
    vi.spyOn(await import('nats'), 'connect').mockResolvedValue(connection);

    await nats.onModuleInit();

    expect(streamsAdd).toHaveBeenCalledWith({
      name: 'TEST',
      subjects: ['test.>'],
      max_age: TRENTE_JOURS_EN_NANOSECONDES,
    });
  });

  it('pose la borne d’âge AUSSI sur un stream déjà existant', async () => {
    const { connection, streamsUpdate } = fausseConnexion({ addEchoue: true });
    const nats = new NatsService(options);
    vi.spyOn(await import('nats'), 'connect').mockResolvedValue(connection);

    await nats.onModuleInit();

    expect(streamsUpdate).toHaveBeenCalledWith('TEST', {
      subjects: ['test.>'],
      max_age: TRENTE_JOURS_EN_NANOSECONDES,
    });
  });
});
