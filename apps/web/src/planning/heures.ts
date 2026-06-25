import type { PlageHoraire } from '../types/bff';

// Logique d'édition d'une plage horaire (arrivée/départ) partagée par les
// calendriers mensuels (`CalendrierCreche`) et l'éditeur hebdomadaire
// (`notifications/EditeurSemaine`). Fonctions pures, sans état ni dépendance UI :
// extraites pour réutiliser la même conversion `HH:MM` ↔ `PlageHoraire` et la
// même validation des deux côtés.

/** Heures d'arrivée/départ par défaut (à défaut de plage de contrat). */
export const ARRIVEE_DEFAUT = '09:00';
export const DEPART_DEFAUT = '16:30';

/** `HH:MM` ← heures/minutes. */
export function versHhmm(heures: number, minutes: number): string {
  return `${String(heures).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** `HH:MM` → minutes depuis minuit (0 si vide/invalide). */
export function minutesDeHhmm(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Plage horaire (API) depuis deux heures `HH:MM`. */
export function plageDepuisHeures(
  arrivee: string,
  depart: string,
): PlageHoraire {
  const a = arrivee.split(':').map(Number);
  const d = depart.split(':').map(Number);
  return {
    debutHeures: a[0] ?? 0,
    debutMinutes: a[1] ?? 0,
    finHeures: d[0] ?? 0,
    finMinutes: d[1] ?? 0,
  };
}

/** Vrai si la plage est cohérente (départ strictement après arrivée). */
export function plageValide(arrivee: string, depart: string): boolean {
  return (
    arrivee !== '' &&
    depart !== '' &&
    minutesDeHhmm(depart) > minutesDeHhmm(arrivee)
  );
}

/** Plage horaire (API) → libellé `HH:MM–HH:MM` pour l'affichage. */
export function formaterPlage(plage: PlageHoraire): string {
  return `${versHhmm(plage.debutHeures, plage.debutMinutes)}–${versHhmm(
    plage.finHeures,
    plage.finMinutes,
  )}`;
}
