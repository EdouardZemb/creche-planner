import { api } from '../api/client';
import type { CoutMoisVue, CoutAnnuelVue } from '../types/bff';
import { useAsync, type AsyncEtat } from '../hooks/useAsync';

/**
 * Charge le coût d'un mois donné pour un foyer.
 * Re-fetch automatiquement quand version change (incrémenté après écriture de planning).
 */
export function useCoutMois(
  foyerId: string,
  mois: string,
  simule: boolean,
  version?: number,
): AsyncEtat<CoutMoisVue> {
  return useAsync(
    (signal) => api.lireCoutMois(foyerId, mois, simule, { signal }),
    [foyerId, mois, simule, version],
  );
}

/**
 * Charge le coût annuel d'un foyer pour une année donnée.
 */
export function useCoutAnnuel(
  foyerId: string,
  annee: number,
  simule: boolean,
): AsyncEtat<CoutAnnuelVue> {
  return useAsync(
    (signal) => api.lireCoutAnnuel(foyerId, annee, simule, { signal }),
    [foyerId, annee, simule],
  );
}
