import { api } from '../api/client';
import type { EtablissementVue } from '../types/bff';
import { useAsync, type AsyncEtat } from '../hooks/useAsync';

/**
 * Charge l'annuaire des établissements destinataires (crèche / ABCM). Se
 * recharge quand `version` change (incrémenté après un enregistrement réussi).
 */
export function useEtablissements(
  version?: number,
): AsyncEtat<EtablissementVue[]> {
  return useAsync((signal) => api.listerEtablissements({ signal }), [version]);
}
