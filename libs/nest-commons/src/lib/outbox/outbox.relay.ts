import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { metrics, type ObservableResult } from '@opentelemetry/api';
import { asc, count, eq, isNull, sql } from 'drizzle-orm';
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
 * - `outbox_attente_age_secondes` : jauge observable de l'**âge** de la plus vieille ligne
 *   non publiée. Un compte ne dit pas si la file avance : deux événements en attente,
 *   c'est normal une seconde après leur écriture et grave trois jours plus tard. Sans
 *   cette jauge, un refus durable restait sous le seuil de `outbox_backlog` et
 *   n'alertait donc **jamais** (`AM-61`).
 */
const meter = metrics.getMeter('nest-commons.outbox');
const compteurEchecs = meter.createCounter('outbox_publications_echecs_total', {
  description:
    "Publications outbox en échec — par `type` d'événement quand un message est refusé, sans attribut quand c'est le cycle qui a échoué (l'événement reste en attente et sera republié).",
});
const jaugeBacklog = meter.createObservableGauge('outbox_backlog', {
  description:
    'Événements outbox en attente de publication (published_at IS NULL) — relu à chaque export.',
});
const jaugeAge = meter.createObservableGauge('outbox_attente_age_secondes', {
  description:
    'Âge en secondes de la plus vieille ligne outbox non publiée (0 si la file est vide) — date le blocage que `outbox_backlog` ne voit pas.',
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
    jaugeAge.addCallback(this.observerAge);
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

  /**
   * Callback de la jauge `outbox_attente_age_secondes`. Même contrat que
   * `observerBacklog` : best effort, une base indisponible ne fait pas tomber
   * l'export.
   */
  private readonly observerAge = async (
    resultat: ObservableResult,
  ): Promise<void> => {
    try {
      resultat.observe(await this.ageAttenteSecondes());
    } catch (erreur) {
      this.logger.debug(
        `Jauge outbox_attente_age_secondes indisponible : ${(erreur as Error).message}`,
      );
    }
  };

  /**
   * Âge, en secondes, de la plus vieille ligne non publiée — `0` si la file est
   * vide. Ancré sur `occurred_at` : c'est bien l'âge de l'**événement**, donc le
   * retard réel de propagation, et non celui de la dernière tentative.
   *
   * Le calcul est fait **en base** (`now()` de Postgres) et non en JS, à dessein :
   * la mesure n'a alors aucune horloge propre à injecter ni à figer, et l'écart
   * d'horloge entre le service et sa base ne s'y ajoute pas. Le
   * `::double precision` n'est pas cosmétique : `extract(epoch …)` rend un
   * `numeric`, que `postgres.js` mappe sur une **chaîne** — la jauge exporterait
   * alors `NaN`.
   */
  async ageAttenteSecondes(): Promise<number> {
    const { table } = this.options;
    const lignes = await this.db
      .select({
        secondes: sql<
          number | null
        >`extract(epoch from (now() - min(${table.occurredAt})))::double precision`,
      })
      .from(table)
      .where(isNull(table.publishedAt));
    return lignes[0]?.secondes ?? 0;
  }

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
        // Isolation **par événement** (`AM-61`) : un refus durable — sujet hors des
        // `subjects` du stream, payload au-delà de `max_payload`, ligne corrompue —
        // ne fige plus la file. Le `try` enveloppait la boucle entière et la tête
        // de file est resélectionnée à chaque cycle (`order by occurred_at`) : un
        // seul message inapplicable arrêtait *toute* la propagation, sans limite de
        // durée et sans que rien ne date le blocage.
        try {
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
        } catch (erreur) {
          // L'événement reste `published_at IS NULL` : il sera retenté au prochain
          // tick, indéfiniment. Ce n'est donc pas une perte, mais ce n'est pas
          // gratuit non plus — c'est `outbox_attente_age_secondes` qui borne le
          // silence, en datant la plus vieille ligne non publiée.
          compteurEchecs.add(1, { type: evt.type });
          this.logger.warn(
            `Publication refusée ${evt.type} (${evt.id}) : ${(erreur as Error).message} — les suivants continuent`,
          );
        }
      }
    } catch (erreur) {
      // Le **cycle** a échoué avant même de lire un lot (base indisponible) : rien
      // n'est publié, rien n'est perdu, on compte l'incident sans attribut de type.
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
    jaugeAge.removeCallback(this.observerAge);
  }
}
