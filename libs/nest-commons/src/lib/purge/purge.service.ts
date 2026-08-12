import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { CLOCK, type Clock } from '../common/clock.js';
import { DRIZZLE } from '../database/database.options.js';
import {
  OPTIONS_PURGE,
  type OptionsPurge,
  type TachePurge,
} from './purge.options.js';
import { tachePurgeDeadLetter, tachePurgeOutbox } from './purge.taches.js';

/**
 * Cadence du balayage. Convention du dépôt : une **durée métier** se configure, une
 * **cadence de tick** est une constante de module (`OutboxRelay` : 2 s,
 * `SchedulerHebdo` : 60 s). Une heure suffit très largement pour de l'hygiène de
 * rétention, et borne le coût d'un balayage sur des tables jamais nettoyées.
 */
const INTERVALLE_MS = 3_600_000;

const MS_PAR_JOUR = 86_400_000;

/**
 * Instruments OTel des bornes temporelles, exportés en Prometheus (le label
 * `service.name` est ajouté par le collector). Sans `MeterProvider` enregistré, l'API
 * OTel est un no-op silencieux. Modèle d'émission : `outbox.relay.ts`.
 *
 * Ils ne sont pas décoratifs. Le tick est *fire-and-forget* et le `catch` avale
 * l'incident en `warn` : sans compteur, une purge qui échoue à chaque passage depuis des
 * mois serait **invisible** — et une purge invisible qui ne purge rien est indiscernable
 * d'une purge qui n'a rien à faire.
 */
const meter = metrics.getMeter('nest-commons.purge');
const compteurLignes = meter.createCounter('purge_lignes_total', {
  description:
    'Lignes traitées par les bornes temporelles de rétention (supprimées, ou anonymisées quand la ligne doit survivre), par tâche.',
});
const compteurEchecs = meter.createCounter('purge_echecs_total', {
  description:
    'Cycles de purge en échec (base indisponible, prédicat refusé…), par tâche. La borne sera réappliquée au prochain tick — un incrément signale un blocage, pas une perte.',
});

/**
 * Applique périodiquement les **bornes temporelles** de rétention du service (lot 2b du
 * plan standards, `docs/37-registre-des-traitements.md` §3).
 *
 * À ne pas confondre avec l'**effacement à la demande** (lot 2a) : celui-ci supprime
 * immédiatement toutes les données d'un foyer, sans attendre aucune échéance. Ce sont deux
 * mécanismes distincts — l'un est un droit exercé, l'autre une hygiène de rétention.
 *
 * Reprend le patron maison `setInterval` + garde de réentrance d'`OutboxRelay` (pas de
 * `@nestjs/schedule`, pas de Bull), avec deux différences assumées : l'horloge est
 * **injectée** — sans quoi « une ligne juste sous la borne survit » ne serait pas
 * prouvable, et le patron partagé était justement celui qui appelait `new Date()` en dur
 * — et chaque tâche est isolée dans son propre `try`, pour qu'une table indisponible
 * n'empêche pas les suivantes d'être bornées.
 */
@Injectable()
export class PurgeService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PurgeService.name);
  private readonly taches: readonly TachePurge[];
  private timer?: ReturnType<typeof setInterval>;
  private enCours = false;

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DRIZZLE) db: PostgresJsDatabase,
    @Inject(OPTIONS_PURGE) options: OptionsPurge,
  ) {
    // Les deux tables techniques sont bornées ici, avec les types de cette lib : leur
    // forme est garantie par `OutboxModule`/`ConsumerModule`, et leur prédicat ne doit
    // exister qu'à un seul endroit. Le reste vient déjà construit du service.
    this.taches = [
      ...(options.outbox ? [tachePurgeOutbox(db, options.outbox)] : []),
      ...(options.deadLetter
        ? [tachePurgeDeadLetter(db, options.deadLetter)]
        : []),
      ...options.taches,
    ];
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.executer(), INTERVALLE_MS);
  }

  /**
   * Applique toutes les bornes du service. Idempotent et réentrant-safe : un cycle encore
   * en vol fait retourner immédiatement (le balayage suivant reprendra le reliquat).
   */
  async executer(): Promise<void> {
    if (this.enCours) {
      return;
    }
    this.enCours = true;
    const maintenant = this.clock.maintenant();
    try {
      for (const tache of this.taches) {
        const borne = new Date(
          maintenant.getTime() - tache.retentionJours * MS_PAR_JOUR,
        );
        try {
          const lignes = await tache.executer(borne);
          compteurLignes.add(lignes, { tache: tache.nom });
          if (lignes > 0) {
            this.logger.log(
              `Rétention ${tache.nom} : ${String(lignes)} ligne(s) traitée(s) au-delà de ${String(tache.retentionJours)} j (borne ${borne.toISOString()})`,
            );
          }
        } catch (erreur) {
          // Ce cycle a échoué : rien n'est perdu, la borne sera réappliquée au prochain
          // tick. On compte l'incident et on passe à la tâche suivante.
          compteurEchecs.add(1, { tache: tache.nom });
          this.logger.warn(
            `Rétention ${tache.nom} interrompue : ${(erreur as Error).message} — réessai au prochain tick`,
          );
        }
      }
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
