import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { metrics, type ObservableResult } from '@opentelemetry/api';
import { asc, count, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../database/database.options.js';
import { NatsService } from '../messaging/nats.service.js';
import { OPTIONS_OUTBOX, type OptionsOutbox } from './outbox.options.js';

const INTERVALLE_MS = 2000;
const TAILLE_LOT = 50;

/**
 * Instruments OTel du relais outbox, exportés en Prometheus (le label `service.name`
 * est ajouté par le collector, `resource_to_telemetry_conversion`). Si aucun
 * `MeterProvider` n'est enregistré, l'API OTel est un no-op silencieux (sûr, sans
 * effet de bord). Modèle d'émission : `apps/svc-tarification/src/fallback/planification.client.ts`.
 *
 * - `outbox_publications_echecs_total` : chaque cycle de drain qui échoue (publication
 *   NATS ou écriture KO). L'événement reste `published_at IS NULL` et sera republié au
 *   tick suivant → un incrément signale un blocage du relais, pas une perte.
 * - `outbox_backlog` : jauge observable du nombre d'événements en attente de publication,
 *   relue par le callback à chaque cycle d'export (~15 s) via un simple `count(*)`.
 */
const meter = metrics.getMeter('nest-commons.outbox');
const compteurEchecs = meter.createCounter('outbox_publications_echecs_total', {
  description:
    "Cycles de drain de l'outbox en échec (publication/écriture KO ; l'événement reste en attente et sera republié).",
});
const jaugeBacklog = meter.createObservableGauge('outbox_backlog', {
  description:
    'Événements outbox en attente de publication (published_at IS NULL) — relu à chaque export.',
});

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
    jaugeBacklog.addCallback(this.observerBacklog);
  }

  /**
   * Callback de la jauge `outbox_backlog` : observe le nombre d'événements en
   * attente. Best effort — une base indisponible ne doit pas faire tomber le cycle
   * d'export (l'absence d'observation vaut « pas de point » pour ce cycle).
   */
  private readonly observerBacklog = async (
    resultat: ObservableResult,
  ): Promise<void> => {
    try {
      resultat.observe(await this.compterBacklog());
    } catch (erreur) {
      this.logger.debug(
        `Jauge outbox_backlog indisponible : ${(erreur as Error).message}`,
      );
    }
  };

  /** Compte les événements outbox non encore publiés (`published_at IS NULL`). */
  async compterBacklog(): Promise<number> {
    const { table } = this.options;
    const lignes = await this.db
      .select({ n: count() })
      .from(table)
      .where(isNull(table.publishedAt));
    return lignes[0]?.n ?? 0;
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
      // Le cycle a échoué (publication NATS ou écriture) : les événements non encore
      // marqués restent `published_at IS NULL` et seront republiés au prochain tick.
      // On compte l'incident (armant l'alerte `OutboxPublicationsEchecs`), sans perte.
      compteurEchecs.add(1);
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
    jaugeBacklog.removeCallback(this.observerBacklog);
  }
}
