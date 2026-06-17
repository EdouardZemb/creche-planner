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
 */
export function useContrats(foyerId: string): UseContratsResultat {
  const etat = useAsync<ContratLocal[]>(
    (signal) =>
      foyerId ? api.listerContrats(foyerId, { signal }) : Promise.resolve([]),
    [foyerId],
  );
  return {
    contrats: etat.data ?? [],
    chargement: etat.loading,
    erreur: etat.error,
    recharger: etat.reload,
  };
}
