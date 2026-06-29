import { api } from '../api/client';
import type { EtablissementFoyerVue } from '../types/bff';
import { useAsync, type AsyncEtat } from '../hooks/useAsync';

/**
 * Charge les établissements (entité libre) du foyer courant
 * (`GET /api/v1/foyers/:foyerId/etablissements`). Se recharge quand `foyerId`
 * change ou via `reload()` (après création / édition / suppression).
 */
export function useEtablissements(
  foyerId: string,
): AsyncEtat<EtablissementFoyerVue[]> {
  return useAsync(
    (signal) =>
      foyerId
        ? api.listerEtablissements(foyerId, { signal })
        : Promise.resolve([]),
    [foyerId],
  );
}
