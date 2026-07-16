import { api } from '../api/client';
import type { InboxVue } from '../types/bff';
import { useAsync, type AsyncEtat } from '../hooks/useAsync';

/**
 * Charge l'**inbox in-app** du parent connecté (notifications récentes + compteur de
 * non-lus, PR6). Même pattern annulable que `useNotifications` (`useAsync` :
 * `AbortController` au démontage). Le rafraîchissement (après un accusé de lecture
 * ou « tout marquer comme lu ») passe par le `reload()` exposé — plus de compteur
 * `version`. Une identité sans ligne parent (404) ou une panne laisse `data` à
 * `null` : la cloche masque alors le compteur (dessein discret, comme
 * `PastilleAValider`).
 */
export function useInbox(): AsyncEtat<InboxVue> {
  return useAsync((signal) => api.listerNotifications({ signal }), []);
}
