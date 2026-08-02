import type { Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import {
  executerOuRepli,
  executerResilient,
  fetchAvecTimeout,
  type CircuitBreaker,
  type OptionsResilience,
} from './resilience.js';

/**
 * Squelette commun des **clients REST** du monorepo (chantier D lot D1), au-dessus
 * des briques de `resilience.ts`. Il factorise le boilerplate recopié par endpoint
 * dans une dizaine de clients — `fetch` borné, garde `reponse.ok`, parse Zod — sans
 * rien décider de l'**authentification** : les en-têtes sortants sont fournis par
 * l'appelant (`FournisseurEntetes`).
 *
 * ⚠️ **La séparation des deux mécanismes de sécurité est structurelle, pas
 * accidentelle** : la gateway injecte `entetesAval()` (propagation de l'identité
 * parent + foyers autorisés via AsyncLocalStorage) et les services injectent
 * `entetesAssertionMachine()` (assertion machine HMAC inter-services). Ce module ne
 * connaît ni l'un ni l'autre, ne les importe pas et ne doit jamais les fusionner :
 * seule la **plomberie** est partagée.
 *
 * Deux enveloppes, selon ce que l'appelant doit faire d'un échec total :
 *
 * - `appelHttpResilient` — **propagation** (BFF : le contrôleur traduit l'échec
 *   amont en réponse HTTP) ;
 * - `appelHttpOuRepli` — **dégradation propre** (replis synchrones des services :
 *   une valeur de secours plutôt qu'une exception).
 *
 * `executerAppelHttp` expose la même plomberie **sans** retry ni disjoncteur, pour
 * les rares appels one-shot qu'un ré-essai casserait.
 */

/** Méthodes HTTP émises par les clients REST du monorepo. */
export type MethodeHttp = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * Fournisseur des en-têtes d'authentification de l'appel sortant, **injecté** par
 * le client appelant et évalué à chaque tentative (l'assertion peut être datée).
 * C'est le point d'extension qui garde ce module ignorant des mécanismes de
 * sécurité — cf. l'avertissement en tête de fichier.
 */
export type FournisseurEntetes = () => Record<string, string>;

/**
 * Erreur d'un service amont dont on a **capturé le corps JSON** (opt-in par
 * client, cf. `capturerCorpsErreur`). Porte le `status` HTTP et le `corps` parsé
 * afin qu'un relais puisse **réémettre le corps amont tel quel** (ex. un 409
 * `{ statusCode, code, message }` de `svc-foyer` → le front lit `code`), au lieu
 * du fourre-tout `Error('HTTP <code>')`. `message` reste `HTTP <code>` pour que le
 * repli `statutDepuisErreur` (5xx) fonctionne à l'identique si le corps n'est pas
 * relayé.
 */
export class ErreurAmont extends Error {
  constructor(
    readonly status: number,
    readonly corps: unknown,
  ) {
    super(`HTTP ${status}`);
    this.name = 'ErreurAmont';
  }
}

/** Lit le corps d'une réponse en JSON ; `undefined` si le corps n'est pas parseable. */
async function lireCorpsJson(reponse: Response): Promise<unknown> {
  try {
    return await reponse.json();
  } catch {
    return undefined;
  }
}

/** Description d'un appel REST : ce qui change d'un endpoint à l'autre. */
export interface ConfigAppelHttp<T> {
  /** Nom du service amont (étiquette du disjoncteur et des erreurs). */
  readonly service: string;
  /** Logger du client appelant (trace `debug` de chaque appel sortant). */
  readonly logger: Logger;
  readonly options: OptionsResilience;
  /** En-têtes d'authentification sortants (cf. `FournisseurEntetes`). */
  readonly entetes: FournisseurEntetes;
  readonly methode: MethodeHttp;
  readonly url: string;
  /** Corps JSON de la requête (POST/PUT) ; absent = requête sans corps. */
  readonly corps?: unknown;
  /** Schéma Zod de la réponse ; absent = réponse sans corps attendue (204). */
  readonly schema?: ZodType<T> | undefined;
  /**
   * **Opt-in** : sur réponse non-2xx au corps JSON parseable, lever
   * `ErreurAmont(status, corps)` au lieu de `Error('HTTP <code>')`, pour qu'un
   * relais puisse réémettre le corps amont. Absent/`false` ⇒ comportement
   * inchangé.
   */
  readonly capturerCorpsErreur?: boolean;
}

/** Appel REST placé derrière un disjoncteur (une instance par dépendance amont). */
export interface ConfigAppelHttpResilient<T> extends ConfigAppelHttp<T> {
  /** Disjoncteur partagé du client (une instance par dépendance amont). */
  readonly breaker: CircuitBreaker;
}

/**
 * Construit l'opération réseau d'un endpoint : `fetch` borné + garde `ok` +
 * parse Zod. Rendue en fabrique (et non exécutée) pour que les enveloppes
 * `executerResilient`/`executerOuRepli` puissent la **rejouer** telle quelle.
 */
function operationHttp<T>(config: ConfigAppelHttp<T>): () => Promise<T> {
  return async (): Promise<T> => {
    const entetes = config.entetes();
    const init: RequestInit =
      config.corps !== undefined
        ? {
            method: config.methode,
            headers: { 'Content-Type': 'application/json', ...entetes },
            body: JSON.stringify(config.corps),
          }
        : { method: config.methode, headers: { ...entetes } };
    const reponse = await fetchAvecTimeout(
      config.url,
      config.options.timeoutMs,
      init,
    );
    if (!reponse.ok) {
      if (config.capturerCorpsErreur) {
        const corps = await lireCorpsJson(reponse);
        if (corps !== undefined) {
          throw new ErreurAmont(reponse.status, corps);
        }
      }
      throw new Error('HTTP ' + String(reponse.status));
    }
    if (config.schema === undefined) {
      // Réponse sans corps attendu (204) : les surcharges publiques ramènent ce
      // cas à `Promise<void>`, aucun appelant ne voit ce `undefined` typé `T`.
      return undefined as T;
    }
    return config.schema.parse(await reponse.json());
  };
}

/** Trace `debug` de l'appel sortant, émise **une fois** (hors boucle de retry). */
function tracer(config: ConfigAppelHttp<unknown>): void {
  config.logger.debug(`${config.methode} ${config.url}`);
}

/**
 * Appel REST **sans** retry ni disjoncteur : la plomberie seule (fetch borné,
 * garde `ok`, parse Zod). Réservé aux opérations **one-shot** qu'un ré-essai
 * corromprait — typiquement la consommation d'un jeton brûlé au premier succès.
 */
export function executerAppelHttp<T>(
  config: ConfigAppelHttp<T> & { readonly schema: ZodType<T> },
): Promise<T>;
export function executerAppelHttp(
  config: ConfigAppelHttp<never> & { readonly schema?: undefined },
): Promise<void>;
/** Surcharge « relais » : pour les liaisons qui repassent une config déjà typée. */
export function executerAppelHttp<T>(
  config: ConfigAppelHttp<T>,
): Promise<T | undefined>;
export async function executerAppelHttp<T>(
  config: ConfigAppelHttp<T>,
): Promise<T | undefined> {
  tracer(config);
  return operationHttp(config)();
}

/**
 * Appel REST **résilient à erreur propagée** (timeout + retry borné +
 * disjoncteur) : c'est le squelette des endpoints du BFF, le contrôleur
 * traduisant ensuite l'échec amont en réponse HTTP.
 */
export function appelHttpResilient<T>(
  config: ConfigAppelHttpResilient<T> & { readonly schema: ZodType<T> },
): Promise<T>;
export function appelHttpResilient(
  config: ConfigAppelHttpResilient<never> & { readonly schema?: undefined },
): Promise<void>;
/** Surcharge « relais » : pour les liaisons qui repassent une config déjà typée. */
export function appelHttpResilient<T>(
  config: ConfigAppelHttpResilient<T>,
): Promise<T | undefined>;
export async function appelHttpResilient<T>(
  config: ConfigAppelHttpResilient<T>,
): Promise<T | undefined> {
  tracer(config);
  return executerResilient(
    config.service,
    operationHttp(config),
    config.breaker,
    config.options,
  );
}

/**
 * Appel REST **résilient à dégradation propre** : même enveloppe, mais un échec
 * total (circuit ouvert compris) journalise un avertissement et renvoie `repli`
 * plutôt que de propager — l'appelant ne plante jamais à cause d'un amont
 * injoignable.
 */
export async function appelHttpOuRepli<T, R>(
  config: ConfigAppelHttpResilient<T> & { readonly schema: ZodType<T> },
  repli: R,
): Promise<T | R> {
  tracer(config);
  return executerOuRepli<T | R>(
    config.service,
    operationHttp(config),
    repli,
    config.breaker,
    config.options,
    config.logger,
  );
}
