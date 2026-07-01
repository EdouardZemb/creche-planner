import { api } from '../api/client';
import type { MonProfilVue } from '../types/bff';
import { useAsync, type AsyncEtat } from '../hooks/useAsync';

/**
 * Charge « Mon profil » (parent connecté) + ses préférences de notification via
 * `GET /moi/profil` (résolution parent côté serveur depuis l'identité). Même
 * patron asynchrone annulable que `useNotifications`/`MoiContext` (`useAsync` :
 * `AbortController` au démontage, `reload()`) — pas de react-query.
 */
export function useMonProfil(): AsyncEtat<MonProfilVue> {
  return useAsync((signal) => api.monProfil({ signal }), []);
}
