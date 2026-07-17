import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AssertionIdentiteGuard } from './assertion-identite.guard.js';
import {
  OPTIONS_ASSERTION_IDENTITE,
  type OptionsAssertionIdentite,
} from './assertion-identite.options.js';

/**
 * Enregistre le {@link AssertionIdentiteGuard} en `APP_GUARD` global du service.
 * Chaque service l'importe avec son `loadConfig` (pattern identique à
 * `OutboxModule.forRoot` / `DatabaseModule.forRoot`) :
 *
 * ```ts
 * AssertionIdentiteModule.forRoot({ chargerConfig: loadConfig })
 * ```
 *
 * Le guard lit `config.assertion.{secret,enforce}` à chaque requête ; en l'absence
 * de secret il reste en mode legacy (passe). Aucun `verifierConfigProduction` n'est
 * ajouté ici : le compose prod (`${ASSERTION_IDENTITE_SECRET:?}`) fait office de garde.
 */
@Module({})
export class AssertionIdentiteModule {
  static forRoot(options: OptionsAssertionIdentite): DynamicModule {
    return {
      module: AssertionIdentiteModule,
      providers: [
        { provide: OPTIONS_ASSERTION_IDENTITE, useValue: options },
        { provide: APP_GUARD, useClass: AssertionIdentiteGuard },
      ],
    };
  }
}
