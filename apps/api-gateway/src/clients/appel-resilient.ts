import type { ZodType } from 'zod';
import {
  appelHttpResilient,
  executerAppelHttp,
  type ConfigAppelHttp,
  type ConfigAppelHttpResilient,
} from '@creche-planner/resilience';
import { entetesAval } from './assertion-aval.js';

/**
 * Liaison **gateway** de la plomberie HTTP partagée (`@creche-planner/resilience`,
 * lot D1) : elle n'ajoute qu'une chose — l'injection de `entetesAval()`, soit la
 * propagation de l'identité parent + des foyers autorisés sur CHAQUE appel sortant
 * (fondations lot 3, corrigée par #264). Le squelette commun (fetch borné, garde
 * `ok`, parse Zod, capture optionnelle du corps d'erreur) vit désormais dans la
 * lib, partagé avec les clients de repli des services.
 *
 * ⚠️ Ce fournisseur d'en-têtes est **distinct** de l'assertion machine HMAC
 * (`entetesAssertionMachine`, `nest-commons/security`) utilisée entre services :
 * deux mécanismes de sécurité différents, jamais à fusionner.
 */

export type { MethodeHttp } from '@creche-planner/resilience';
// Ré-export (et non redéfinition) : `relais.ts` et les specs testent
// `erreur instanceof ErreurAmont` — ce doit rester LA même classe.
export { ErreurAmont } from '@creche-planner/resilience';

/** Config d'un endpoint du BFF : tout sauf les en-têtes, fournis ici. */
export type ConfigAppelResilient<T> = Omit<
  ConfigAppelHttpResilient<T>,
  'entetes'
>;

/** Config d'un appel one-shot du BFF (sans retry ni disjoncteur). */
export type ConfigAppelDirect<T> = Omit<
  ConfigAppelHttp<T>,
  'entetes' | 'breaker'
>;

/**
 * Exécute un appel REST **résilient** (timeout + retry borné + circuit-breaker,
 * avec **propagation** des erreurs — le contrôleur du BFF traduit ensuite
 * l'échec amont en réponse HTTP) : c'est le squelette commun de tous les
 * endpoints des clients de la gateway.
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
  return appelHttpResilient({ ...config, entetes: entetesAval });
}

/**
 * Variante **one-shot** (ni retry ni disjoncteur) pour les opérations qu'un
 * ré-essai corromprait — cf. `FoyerClient.desabonner`, dont le jeton est brûlé
 * au premier succès.
 */
export async function appelDirect(
  config: ConfigAppelDirect<never> & { readonly schema?: undefined },
): Promise<void> {
  return executerAppelHttp({ ...config, entetes: entetesAval });
}
