import type { Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import {
  executerResilient,
  fetchAvecTimeout,
  type CircuitBreaker,
  type OptionsResilience,
} from '@creche-planner/resilience';

/** Méthodes HTTP émises par les clients REST du BFF. */
export type MethodeHttp = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Configuration d'un appel REST résilient (un endpoint d'un client du BFF). */
export interface ConfigAppelResilient<T> {
  /** Nom du service amont (étiquette du disjoncteur et des erreurs). */
  readonly service: string;
  /** Logger du client appelant (trace `debug` de chaque appel sortant). */
  readonly logger: Logger;
  /** Disjoncteur partagé du client (une instance par dépendance amont). */
  readonly breaker: CircuitBreaker;
  readonly options: OptionsResilience;
  readonly methode: MethodeHttp;
  readonly url: string;
  /** Corps JSON de la requête (POST/PUT) ; absent = requête sans corps. */
  readonly corps?: unknown;
  /** Schéma Zod de la réponse ; absent = réponse sans corps attendue (204). */
  readonly schema?: ZodType<T> | undefined;
}

/**
 * Exécute un appel REST **résilient** (timeout + retry borné + circuit-breaker,
 * avec **propagation** des erreurs — le contrôleur du BFF traduit ensuite
 * l'échec amont en réponse HTTP) : c'est le squelette commun de tous les
 * endpoints des clients de la gateway, factorisé pour éliminer le boilerplate
 * répété par endpoint (fetch + garde `ok` + parse Zod).
 */
export function appelResilient<T>(
  config: ConfigAppelResilient<T> & { readonly schema: ZodType<T> },
): Promise<T>;
export function appelResilient(
  config: ConfigAppelResilient<never> & { readonly schema?: undefined },
): Promise<void>;
export async function appelResilient<T>(
  config: ConfigAppelResilient<T>,
): Promise<T | undefined> {
  const { methode, url, options, schema } = config;
  config.logger.debug(`${methode} ${url}`);
  return executerResilient(
    config.service,
    async () => {
      const init: RequestInit | undefined =
        config.corps !== undefined
          ? {
              method: methode,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(config.corps),
            }
          : methode === 'GET'
            ? undefined
            : { method: methode };
      const reponse = await fetchAvecTimeout(url, options.timeoutMs, init);
      if (!reponse.ok) {
        throw new Error('HTTP ' + String(reponse.status));
      }
      if (schema === undefined) {
        return undefined;
      }
      return schema.parse(await reponse.json());
    },
    config.breaker,
    options,
  );
}
