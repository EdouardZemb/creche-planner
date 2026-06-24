import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  AckPolicy,
  JSONCodec,
  nanos,
  type Consumer,
  type ConsumerMessages,
  type JsMsg,
} from 'nats';
import { NatsService } from '@creche-planner/nest-commons';
import { ProjectionService } from './projection.service.js';

/** Streams amont consommés par Notifications, et leur consommateur durable. */
const ABONNEMENTS: readonly { stream: string; durable: string }[] = [
  { stream: 'PLANIFICATION', durable: 'notifications-planification' },
];

const DELAI_BIND_MS = 5000;
const NAK_DELAI_MS = 2000;

/**
 * Nombre maximal de livraisons d'un même message avant abandon par JetStream.
 * Au-delà, un message **génuinement orphelin** (ex. un `ContratModifie` dont le
 * `ContratCree` n'arrivera jamais) cesse de boucler en NAK toutes les ~2 s.
 */
const MAX_LIVRAISONS = 10;

/**
 * Paliers d'attente (escalade) entre deux re-livraisons, indexés sur le numéro de
 * tentative. JetStream attend `backoff` en **nanosecondes** (`ConsumerConfig.backoff:
 * Nanos[]`, cf. `nats@2.x` `jsapi_types`), d'où la conversion via `nanos(ms)`. Le
 * premier palier (1 s) laisse à un `ContratCree` en retard le temps d'être projeté
 * (la reprise d'ordre transitoire reste fonctionnelle) ; les suivants espacent les
 * tentatives pour ne pas marteler la base.
 */
const BACKOFF_MS = [1_000, 5_000, 15_000, 30_000];
const BACKOFF_NANOS = BACKOFF_MS.map((ms) => nanos(ms));

/**
 * Consommateur **idempotent** JetStream du read model Notifications. Au démarrage
 * (et tant que NATS n'est pas prêt), tente de **lier un consommateur durable** au
 * stream `PLANIFICATION`. Chaque message est projeté via `ProjectionService`
 * (transaction unique : `processed_event` + upsert/suppression). En cas d'erreur
 * transitoire, le message est **NAK** (re-livraison différée) ; sinon **ACK**. La
 * création du consommateur durable est idempotente (réutilise un consommateur
 * existant). Résilient : réessaie le binding tant qu'il échoue, sans bloquer le boot.
 */
@Injectable()
export class JetStreamConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(JetStreamConsumer.name);
  private readonly codec = JSONCodec();
  private readonly iterateurs = new Set<ConsumerMessages>();
  private bindTimer?: ReturnType<typeof setTimeout>;
  private arrete = false;
  private readonly lies = new Set<string>();

  constructor(
    private readonly nats: NatsService,
    private readonly projection: ProjectionService,
  ) {}

  onApplicationBootstrap(): void {
    void this.lierTous();
  }

  /** Tente de lier les consommateurs non encore liés ; reprogramme si besoin. */
  private async lierTous(): Promise<void> {
    if (this.arrete) {
      return;
    }
    const js = this.nats.getJetStream();
    const connexion = this.nats.getConnection();
    if (!js || !connexion) {
      this.planifierReessai();
      return;
    }
    for (const { stream, durable } of ABONNEMENTS) {
      if (this.lies.has(durable)) {
        continue;
      }
      try {
        await this.lierConsommateur(stream, durable);
        this.lies.add(durable);
      } catch (erreur) {
        this.logger.warn(
          `Liaison ${durable}@${stream} impossible (${(erreur as Error).message}) — réessai`,
        );
      }
    }
    if (this.lies.size < ABONNEMENTS.length) {
      this.planifierReessai();
    }
  }

  private planifierReessai(): void {
    if (this.arrete) {
      return;
    }
    this.bindTimer = setTimeout(() => void this.lierTous(), DELAI_BIND_MS);
  }

  /** Crée (idempotent) le consommateur durable et lance la boucle de consommation. */
  private async lierConsommateur(
    stream: string,
    durable: string,
  ): Promise<void> {
    const connexion = this.nats.getConnection();
    const js = this.nats.getJetStream();
    if (!connexion || !js) {
      throw new Error('NATS non connecté');
    }
    const jsm = await connexion.jetstreamManager();
    try {
      // `add` est idempotent côté serveur tant que la config demandée est
      // compatible : un consommateur déjà présent avec la même config est
      // renvoyé tel quel. `max_deliver`/`backoff` bornent les re-livraisons d'un
      // message génuinement orphelin (anti-livelock) tout en laissant le premier
      // palier court récupérer un désordre transitoire des événements.
      await jsm.consumers.add(stream, {
        durable_name: durable,
        ack_policy: AckPolicy.Explicit,
        max_deliver: MAX_LIVRAISONS,
        backoff: BACKOFF_NANOS,
      });
    } catch {
      // Consommateur déjà présent (config compatible) : on le réutilise tel quel.
    }
    const consommateur: Consumer = await js.consumers.get(stream, durable);
    const messages = await consommateur.consume();
    this.iterateurs.add(messages);
    void this.boucle(stream, messages);
    this.logger.log(`Consommateur durable lié : ${durable}@${stream}`);
  }

  /** Boucle de consommation d'un stream : projette puis ACK/NAK chaque message. */
  private async boucle(
    stream: string,
    messages: ConsumerMessages,
  ): Promise<void> {
    try {
      for await (const message of messages) {
        await this.traiterMessage(stream, message);
      }
    } catch (erreur) {
      if (!this.arrete) {
        this.logger.warn(
          `Boucle ${stream} interrompue (${(erreur as Error).message})`,
        );
      }
    }
  }

  private async traiterMessage(stream: string, message: JsMsg): Promise<void> {
    let donnees: unknown;
    try {
      donnees = this.codec.decode(message.data);
    } catch {
      // Message illisible : on l'acquitte pour ne pas bloquer le stream.
      message.ack();
      return;
    }
    const applique = await this.projection.traiter(stream, donnees);
    if (applique) {
      message.ack();
    } else {
      message.nak(NAK_DELAI_MS);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.arrete = true;
    if (this.bindTimer) {
      clearTimeout(this.bindTimer);
    }
    for (const iterateur of this.iterateurs) {
      try {
        await iterateur.close();
      } catch {
        // arrêt best-effort
      }
    }
  }
}
