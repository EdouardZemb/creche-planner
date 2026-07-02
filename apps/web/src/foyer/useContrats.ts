import { api } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import type { ContratLocal } from '../types/bff';

export interface UseContratsResultat {
  contrats: ContratLocal[];
  chargement: boolean;
  erreur: string | null;
  /** Recharge la liste depuis l'API (à appeler après création/édition/suppression). */
  recharger: () => void;
}

/**
 * Liste des contrats d'un foyer, **lue depuis l'API** (GET /api/v1/contrats?foyer=).
 * Les mutations (création/édition/suppression) passent par l'API côté appelant ;
 * il suffit ensuite d'appeler `recharger()` pour refléter l'état serveur.
 *
 * Mise en CACHE par foyer (clé `contrats:<foyerId>`) : naviguer entre les
 * pages d'un même foyer ne redéclenche pas la requête. Toutes les mutations de
 * contrats (ContratsPage, modification durable des calendriers) appellent déjà
 * `recharger()`, qui invalide l'entrée avant de relancer.
 */
export function useContrats(foyerId: string): UseContratsResultat {
  const etat = useAsync<ContratLocal[]>(
    (signal) =>
      foyerId ? api.listerContrats(foyerId, { signal }) : Promise.resolve([]),
    [foyerId],
    { cle: `contrats:${foyerId}` },
  );
  return {
    contrats: etat.data ?? [],
    chargement: etat.loading,
    erreur: etat.error,
    recharger: etat.reload,
  };
}
