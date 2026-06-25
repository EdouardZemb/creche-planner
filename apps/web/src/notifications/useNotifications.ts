import { api } from '../api/client';
import type { NotificationAValider } from '../types/bff';
import { useAsync, type AsyncEtat } from '../hooks/useAsync';

/**
 * Charge les semaines **à valider** d'un foyer (indicateur in-app de la validation
 * hebdomadaire, Lot 4). Se recharge quand `foyerId` ou `version` change (`version`
 * incrémenté après une validation réussie). Même pattern asynchrone annulable que
 * `useEtablissements` (`useAsync` : `AbortController` au démontage, `reload()`).
 */
export function useNotifications(
  foyerId: string,
  version?: number,
): AsyncEtat<NotificationAValider[]> {
  return useAsync(
    (signal) => api.listerAValider(foyerId, { signal }),
    [foyerId, version],
  );
}
