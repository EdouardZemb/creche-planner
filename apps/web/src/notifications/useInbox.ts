import { api } from '../api/client';
import type { InboxVue } from '../types/bff';
import { useAsync, type AsyncEtat } from '../hooks/useAsync';

/**
 * Charge l'**inbox in-app** du parent connecté (notifications récentes + compteur de
 * non-lus, PR6). Se recharge quand `version` change (incrémenté après un accusé de
 * lecture). Même pattern annulable que `useNotifications` (`useAsync` : `AbortController`
 * au démontage). Une identité sans ligne parent (404) ou une panne laisse `data` à
 * `null` : la cloche masque alors le compteur (dessein discret, comme `PastilleAValider`).
 */
export function useInbox(version?: number): AsyncEtat<InboxVue> {
  return useAsync((signal) => api.listerNotifications({ signal }), [version]);
}
