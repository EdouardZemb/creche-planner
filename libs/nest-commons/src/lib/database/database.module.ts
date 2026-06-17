import {
  type DynamicModule,
  Inject,
  Module,
  type OnModuleDestroy,
} from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import {
  DRIZZLE,
  OPTIONS_DATABASE,
  type OptionsDatabase,
  PG_CLIENT,
} from './database.options.js';
import { MigrationService } from './migration.service.js';

/**
 * Base PostgreSQL **dédiée** du service (un service = une base, doc 03 §9bis).
 * postgres.js se connecte paresseusement : le démarrage du service ne dépend pas
 * de la disponibilité immédiate de la base (résilience), la sonde readiness s'en
 * charge. Le schéma Drizzle du service est passé au client pour typer `db.query`.
 */
@Module({})
export class DatabaseModule implements OnModuleDestroy {
  static forRoot(options: OptionsDatabase): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [
        { provide: OPTIONS_DATABASE, useValue: options },
        {
          provide: PG_CLIENT,
          useFactory: (): Sql =>
            // onnotice silencieux : on ne veut pas polluer les logs avec les NOTICE Postgres.
            postgres(options.urlBase(), {
              max: 5,
              onnotice: () => undefined,
            }),
        },
        {
          provide: DRIZZLE,
          inject: [PG_CLIENT],
          useFactory: (sql: Sql): PostgresJsDatabase<Record<string, unknown>> =>
            drizzle(sql, { schema: options.schema }),
        },
        MigrationService,
      ],
      exports: [PG_CLIENT, DRIZZLE],
    };
  }

  constructor(@Inject(PG_CLIENT) private readonly sql: Sql) {}

  async onModuleDestroy(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
