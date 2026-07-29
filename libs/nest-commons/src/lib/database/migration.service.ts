import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { metrics, type ObservableResult } from '@opentelemetry/api';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';
import { OPTIONS_DATABASE, type OptionsDatabase } from './database.options.js';

const INTERVALLE_RETRY_MS = 5000;

/**
 * Instruments OTel de l'état des migrations, exportés en Prometheus (le label
 * `service_name` est ajouté par le collector, `resource_to_telemetry_conversion`).
 * Sans `MeterProvider` enregistré, l'API OTel est un no-op silencieux (sûr).
 * Modèle d'émission : `outbox.relay.ts` (jauge observable + compteur).
 *
 * - `migrations_en_attente` : jauge 0/1, vaut 1 tant que les migrations Drizzle
 *   ne sont pas appliquées (schéma potentiellement en retard). Arme l'alerte
 *   `MigrationsEnRetardPersistant` : la boucle de retry silencieuse ne doit plus
 *   pouvoir tourner indéfiniment sans que personne ne le sache.
 * - `migrations_echecs_total` : chaque tentative d'application en échec (une
 *   toutes les 5 s tant que ça échoue) — donne le rythme et l'ancienneté du blocage.
 */
const meter = metrics.getMeter('nest-commons.migrations');
const compteurEchecs = meter.createCounter('migrations_echecs_total', {
  description:
    "Tentatives d'application des migrations Drizzle en échec (le service réessaie toutes les 5 s).",
});
const jaugeEnAttente = meter.createObservableGauge('migrations_en_attente', {
  description:
    '1 tant que les migrations Drizzle ne sont pas appliquées (schéma potentiellement en retard), 0 ensuite.',
});

/**
 * Applique les migrations Drizzle au démarrage, avec une connexion dédiée
 * (`max: 1`) refermée aussitôt. Résilient : si la base est indisponible au boot,
 * on réessaie en arrière-plan toutes les 5 s plutôt que de planter le service
 * (cohérent avec la connexion paresseuse de `DatabaseModule`).
 *
 * L'état est **observable** : jauge/compteur OTel ci-dessus, et readiness du
 * service via `MigrationsHealthIndicator` (un service au schéma en retard ne doit
 * pas se déclarer prêt — la liveness, elle, reste sans dépendance).
 *
 * Le dossier de migrations est embarqué dans le bundle du service (assets
 * webpack → `dist/database/migrations`), fourni via `OptionsDatabase`.
 */
@Injectable()
export class MigrationService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MigrationService.name);
  private retry?: ReturnType<typeof setTimeout>;
  private appliquees = false;
  private erreur?: string | undefined;

  constructor(
    @Inject(OPTIONS_DATABASE) private readonly options: OptionsDatabase,
  ) {}

  /** Vrai une fois les migrations appliquées (le schéma est à jour). */
  sontAppliquees(): boolean {
    return this.appliquees;
  }

  /** Message de la dernière tentative en échec (undefined si aucune). */
  derniereErreur(): string | undefined {
    return this.erreur;
  }

  private readonly observerEnAttente = (resultat: ObservableResult): void => {
    resultat.observe(this.appliquees ? 0 : 1);
  };

  async onModuleInit(): Promise<void> {
    jaugeEnAttente.addCallback(this.observerEnAttente);
    await this.appliquer();
  }

  private async appliquer(): Promise<void> {
    const sql: Sql = postgres(this.options.urlBase(), {
      max: 1,
      onnotice: () => undefined,
    });
    try {
      await migrate(drizzle(sql), {
        migrationsFolder: this.options.dossierMigrations,
      });
      this.appliquees = true;
      this.erreur = undefined;
      this.logger.log('Migrations Drizzle appliquées');
    } catch (erreur) {
      compteurEchecs.add(1);
      this.erreur = (erreur as Error).message;
      this.logger.warn(
        `Migrations impossibles (${this.erreur}) — nouvel essai dans 5 s`,
      );
      this.retry = setTimeout(() => void this.appliquer(), INTERVALLE_RETRY_MS);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  onApplicationShutdown(): void {
    if (this.retry) {
      clearTimeout(this.retry);
    }
    jaugeEnAttente.removeCallback(this.observerEnAttente);
  }
}
