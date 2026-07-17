import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * **Contexte parent résolu** propagé aux clients HTTP de la gateway (chantier
 * fondations lot 3). Les clients sont des singletons : ils ne connaissent pas la
 * requête courante. On transporte donc l'identité résolue par les guards via un
 * `AsyncLocalStorage` (pas de dépendance, pas de request-scope Nest), qu'un
 * interceptor ouvre **après** les guards et qui reste actif pendant tout le
 * handler (donc pendant les appels sortants).
 */
export interface ContexteAssertion {
  /** E-mail vérifié du parent (posé par `IdentiteGuard`). */
  readonly email: string;
  /** Foyers autorisés résolus par `AppartenanceGuard` (absent hors route scopée). */
  readonly foyers?: readonly string[] | undefined;
  /** Statut admin résolu par `AppartenanceGuard` (bypass). */
  readonly admin?: boolean | undefined;
}

const als = new AsyncLocalStorage<ContexteAssertion>();

/** Exécute `fn` avec `contexte` actif dans l'ALS (ouvert par l'interceptor). */
export function executerAvecContexteAssertion<T>(
  contexte: ContexteAssertion,
  fn: () => T,
): T {
  return als.run(contexte, fn);
}

/**
 * Contexte parent courant, ou `undefined` hors d'une requête parent identifiée —
 * y compris pendant l'exécution des guards eux-mêmes (l'ALS n'est ouvert qu'après
 * eux), d'où le repli sur une assertion **machine** de `entetesAval`.
 */
export function contexteAssertionCourant(): ContexteAssertion | undefined {
  return als.getStore();
}
