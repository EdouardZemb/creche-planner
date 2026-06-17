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
  type JetStreamClient,
  type NatsConnection,
} from 'nats';
import { OPTIONS_NATS, type OptionsNats } from './nats.options.js';

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
    try {
      await jsm.streams.add({ name: stream, subjects: [sujet] });
    } catch {
      // Stream déjà présent : on s'assure que le sujet est couvert.
      await jsm.streams.update(stream, { subjects: [sujet] });
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
