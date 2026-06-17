import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { asc, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../database/database.options.js';
import { NatsService } from '../messaging/nats.service.js';
import { OPTIONS_OUTBOX, type OptionsOutbox } from './outbox.options.js';

const INTERVALLE_MS = 2000;
const TAILLE_LOT = 50;

/**
 * Relais de l'outbox transactionnelle (doc 06 §8.4). Scrute périodiquement les
 * lignes non publiées (dans l'ordre d'occurrence), reconstruit l'enveloppe
 * `IntegrationEvent`, la publie sur JetStream (dédup par `id`) puis marque
 * `published_at`. La publication est **at-least-once** ; l'idempotence côté
 * consommateur s'appuie sur `id`.
 */
@Injectable()
export class OutboxRelay
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: ReturnType<typeof setInterval>;
  private enCours = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase,
    private readonly nats: NatsService,
    @Inject(OPTIONS_OUTBOX) private readonly options: OptionsOutbox,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.drainer(), INTERVALLE_MS);
  }

  /** Publie le lot d'événements en attente. Idempotent et réentrant-safe. */
  async drainer(): Promise<void> {
    if (this.enCours || !this.nats.estConnecte()) {
      return;
    }
    this.enCours = true;
    const { table, source } = this.options;
    try {
      const enAttente = await this.db
        .select()
        .from(table)
        .where(isNull(table.publishedAt))
        .orderBy(asc(table.occurredAt))
        .limit(TAILLE_LOT);

      for (const evt of enAttente) {
        const enveloppe = {
          id: evt.id,
          type: evt.type,
          source,
          version: 1,
          occurredAt: evt.occurredAt.toISOString(),
          traceId: evt.traceId,
          payload: evt.payload,
        };
        await this.nats.publier(evt.type, evt.id, enveloppe);
        await this.db
          .update(table)
          .set({ publishedAt: new Date() })
          .where(eq(table.id, evt.id));
        this.logger.log(`Événement publié ${evt.type} (${evt.id})`);
      }
    } catch (erreur) {
      this.logger.warn(
        `Relais outbox interrompu : ${(erreur as Error).message} — réessai au prochain tick`,
      );
    } finally {
      this.enCours = false;
    }
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
