import {
  type DynamicModule,
  Module,
  type Provider,
  type Type,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AssertionIdentiteGuard } from './assertion-identite.guard.js';
import {
  OPTIONS_ASSERTION_IDENTITE,
  type OptionsAssertionIdentite,
} from './assertion-identite.options.js';
import { ScopeFoyerGuard } from './scope-foyer.guard.js';
import {
  RESOLVEUR_FOYER_RESSOURCE,
  type ResolveurFoyerRessource,
} from './scope-foyer.resolveur.js';

/**
 * Scoping par ressource (lot 4) d'un service. `resoudre` est le
 * {@link ResolveurFoyerRessource} du service (requêtes Drizzle locales), **omis** si
 * toutes les routes portent le foyer directement (svc-foyer, svc-tarification :
 * sources `query:foyer` / `param:id` / `body`, aucune résolution en base).
 */
export interface OptionsScopeFoyer {
  readonly resolveur?: Type<ResolveurFoyerRessource>;
}

/** Options du module : config d'assertion + scoping optionnel (lot 4). */
export interface OptionsAssertionIdentiteModule extends OptionsAssertionIdentite {
  /**
   * Active le {@link ScopeFoyerGuard} (scoping par ressource, lot 4). Présent sur les
   * 4 services porteurs de données foyer ; absent sur svc-referentiel (aucune donnée
   * foyer → signature seule).
   */
  readonly scoping?: OptionsScopeFoyer;
}

/**
 * Enregistre le {@link AssertionIdentiteGuard} en `APP_GUARD` global du service et,
 * si `scoping` est fourni, le {@link ScopeFoyerGuard} **juste après** (les
 * `APP_GUARD` s'exécutent dans l'ordre d'enregistrement — même patron que la gateway
 * — donc le scoping lit `req.assertion` déjà posée). Chaque service l'importe avec son
 * `loadConfig` (pattern `OutboxModule.forRoot` / `DatabaseModule.forRoot`) :
 *
 * ```ts
 * // svc-foyer / svc-tarification (foyer direct, sans résolveur) :
 * AssertionIdentiteModule.forRoot({ chargerConfig: loadConfig, scoping: {} })
 * // svc-planification / svc-notifications (résolution contrat/établissement/parent) :
 * AssertionIdentiteModule.forRoot({ chargerConfig: loadConfig, scoping: { resolveur: ResolveurFoyer } })
 * // svc-referentiel (aucune donnée foyer) :
 * AssertionIdentiteModule.forRoot({ chargerConfig: loadConfig })
 * ```
 *
 * Les deux guards lisent `config.assertion.{secret,enforce}` à chaque requête ; en
 * l'absence de secret ils restent en mode legacy (passent). Aucun
 * `verifierConfigProduction` ici : le compose prod (`${ASSERTION_IDENTITE_SECRET:?}`)
 * fait office de garde.
 */
@Module({})
export class AssertionIdentiteModule {
  static forRoot(options: OptionsAssertionIdentiteModule): DynamicModule {
    const providers: Provider[] = [
      {
        provide: OPTIONS_ASSERTION_IDENTITE,
        useValue: { chargerConfig: options.chargerConfig },
      },
      { provide: APP_GUARD, useClass: AssertionIdentiteGuard },
    ];
    if (options.scoping !== undefined) {
      if (options.scoping.resolveur !== undefined) {
        providers.push({
          provide: RESOLVEUR_FOYER_RESSOURCE,
          useClass: options.scoping.resolveur,
        });
      }
      // Enregistré APRÈS le guard d'identité → s'exécute après lui (req.assertion posée).
      providers.push({ provide: APP_GUARD, useClass: ScopeFoyerGuard });
    }
    return { module: AssertionIdentiteModule, providers };
  }
}
