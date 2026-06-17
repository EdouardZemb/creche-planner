import { useRef } from 'react';
import { api, ApiError, AuthExpiredError } from '../api/client';
import type { DossierFoyerVue } from '../types/bff';
import { useAsync, type AsyncEtat } from './useAsync';

/** Catégorie d'erreur de chargement du foyer, pour orienter l'écran de récupération. */
export type FoyerErreurKind =
  | 'introuvable'
  | 'indisponible'
  | 'session-expiree';

export interface FoyerEtat extends AsyncEtat<DossierFoyerVue> {
  /**
   * Nature de l'erreur quand `error` est non nul :
   * - `introuvable` : le foyer n'existe pas / plus (HTTP 404) → proposer d'en créer un ;
   * - `indisponible` : panne serveur ou réseau (5xx / fetch échoué) → proposer de réessayer ;
   * - `session-expiree` : Cloudflare Access redirige vers sa page de connexion
   *   → proposer de se reconnecter (réessayer ne servirait à rien).
   * `null` quand il n'y a pas d'erreur.
   */
  erreurKind: FoyerErreurKind | null;
}

/** Charge le foyer + ses enfants (GET /api/v1/foyers/:id). */
export function useFoyer(foyerId: string): FoyerEtat {
  // useAsync n'expose qu'un message d'erreur déjà formaté ; on capture en plus le
  // type d'erreur HTTP au passage de la promesse pour distinguer 404 vs 5xx/réseau.
  const kindRef = useRef<FoyerErreurKind | null>(null);

  const etat = useAsync<DossierFoyerVue>(
    (signal) => {
      kindRef.current = null;
      return api.lireFoyer(foyerId, { signal }).catch((e: unknown) => {
        if (e instanceof AuthExpiredError) {
          kindRef.current = 'session-expiree';
        } else {
          kindRef.current =
            e instanceof ApiError && e.status === 404
              ? 'introuvable'
              : 'indisponible';
        }
        throw e;
      });
    },
    [foyerId],
  );

  return { ...etat, erreurKind: etat.error ? kindRef.current : null };
}
