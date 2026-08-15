import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import {
  connect,
  headers,
  JSONCodec,
  nanos,
  type JetStreamClient,
  type NatsConnection,
} from 'nats';
import { OPTIONS_NATS, type OptionsNats } from './nats.options.js';

/**
 * Borne d'âge des messages du stream, en nanosecondes (unité de JetStream).
 *
 * **30 jours, alignés sur T7** (doc 37 §3), la rétention de la table `outbox`
 * qui est la source de ces messages : le transport ne doit pas survivre à ce
 * qu'il transporte. Sans cette borne, la politique par défaut (`limits`) ne
 * supprime **jamais** — l'acquittement d'un consommateur explicite n'efface
 * rien. Tant que le magasin JetStream vivait dans la couche du conteneur, la
 * recréation du conteneur faisait office de purge involontaire ; le volume
 * nommé posé par `AM-83` retire ce hasard, il faut donc la borne réelle,
 * sinon le stream croît jusqu'à ce que `publier()` échoue.
 *
 * Effet de bord assumé : un consommateur arrêté plus de 30 jours perd les
 * messages qu'il n'a pas lus. C'est strictement mieux qu'avant, où le moindre
 * déploiement les perdait tous — et l'`outbox` SQL, elle, reste la source de
 * vérité rejouable pendant les mêmes 30 jours.
 */
const RETENTION_STREAM = nanos(30 * 24 * 60 * 60 * 1000);

/**
 * Connexion NATS JetStream du service. Le démarrage ne bloque pas si le broker
 * est indisponible : connexion résiliente (reconnexion infinie) et, en cas
 * d'échec initial, réessai en arrière-plan ; la readiness reflète l'état. Au
 * premier succès, le stream du contexte (`OptionsNats`) est provisionné
 * (idempotent) pour persister les événements de l'outbox.
 */
@Injectable()
export class NatsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NatsService.name);
  private readonly codec = JSONCodec();
  private connection?: NatsConnection;
  private jetstream?: JetStreamClient;
  private reconnexion?: ReturnType<typeof setTimeout>;

  constructor(@Inject(OPTIONS_NATS) private readonly options: OptionsNats) {}

  async onModuleInit(): Promise<void> {
    await this.connecter();
  }

  private async connecter(): Promise<void> {
    try {
      this.connection = await connect({
        servers: this.options.url(),
        reconnect: true,
        maxReconnectAttempts: -1,
        name: this.options.service,
      });
      this.logger.log(`Connecté à NATS (${this.connection.getServer()})`);
      await this.provisionnerStream(this.connection);
      this.jetstream = this.connection.jetstream();
    } catch (erreur) {
      this.logger.warn(
        `NATS indisponible au démarrage (${(erreur as Error).message}) — nouvel essai dans 5 s`,
      );
      this.reconnexion = setTimeout(() => void this.connecter(), 5000);
    }
  }

  /** Crée (ou met à jour) le stream du contexte couvrant son sujet. Idempotent. */
  private async provisionnerStream(connection: NatsConnection): Promise<void> {
    const { stream, sujet } = this.options;
    const jsm = await connection.jetstreamManager();
    const config = { subjects: [sujet], max_age: RETENTION_STREAM };
    try {
      await jsm.streams.add({ name: stream, ...config });
    } catch {
      // Stream déjà présent : on s'assure que le sujet est couvert ET que la
      // borne d'âge est posée (un stream créé avant `AM-83` n'en a aucune).
      await jsm.streams.update(stream, config);
    }
  }

  estConnecte(): boolean {
    return this.connection !== undefined && !this.connection.isClosed();
  }

  /** Connexion NATS courante (pour brancher des consommateurs durables). */
  getConnection(): NatsConnection | undefined {
    return this.connection;
  }

  /** Client JetStream courant (pour souscrire aux streams amont). */
  getJetStream(): JetStreamClient | undefined {
    return this.jetstream;
  }

  /**
   * Publie un événement sur JetStream avec **déduplication par `id`** (en-tête
   * `Nats-Msg-Id`) : republier le même id (relais rejoué) ne crée pas de doublon.
   * Lève si JetStream n'est pas disponible — le relais réessaiera le lot.
   */
  async publier(sujet: string, id: string, evenement: unknown): Promise<void> {
    if (!this.jetstream) {
      throw new Error('JetStream indisponible');
    }
    const entetes = headers();
    entetes.set('Nats-Msg-Id', id);
    await this.jetstream.publish(sujet, this.codec.encode(evenement), {
      headers: entetes,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.reconnexion) {
      clearTimeout(this.reconnexion);
    }
    await this.connection?.drain();
  }
}
