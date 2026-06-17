import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';
import { OPTIONS_DATABASE, type OptionsDatabase } from './database.options.js';

/**
 * Applique les migrations Drizzle au démarrage, avec une connexion dédiée
 * (`max: 1`) refermée aussitôt. Résilient : si la base est indisponible au boot,
 * on réessaie en arrière-plan toutes les 5 s plutôt que de planter le service
 * (cohérent avec la connexion paresseuse de `DatabaseModule`).
 *
 * Le dossier de migrations est embarqué dans le bundle du service (assets
 * webpack → `dist/database/migrations`), fourni via `OptionsDatabase`.
 */
@Injectable()
export class MigrationService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MigrationService.name);
  private retry?: ReturnType<typeof setTimeout>;

  constructor(
    @Inject(OPTIONS_DATABASE) private readonly options: OptionsDatabase,
  ) {}

  async onModuleInit(): Promise<void> {
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
      this.logger.log('Migrations Drizzle appliquées');
    } catch (erreur) {
      this.logger.warn(
        `Migrations impossibles (${(erreur as Error).message}) — nouvel essai dans 5 s`,
      );
      this.retry = setTimeout(() => void this.appliquer(), 5000);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  onApplicationShutdown(): void {
    if (this.retry) {
      clearTimeout(this.retry);
    }
  }
}
