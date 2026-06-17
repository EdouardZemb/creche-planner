// Persistance locale minimale : on conserve côté client le foyer actif
// (localStorage). Les contrats sont désormais lus via l'API (`GET /api/v1/contrats`),
// il n'y a plus de stockage local de contrats.

const CLE_FOYER = 'creche:foyerId';

export function getFoyerId(): string | null {
  return localStorage.getItem(CLE_FOYER);
}

export function setFoyerId(id: string): void {
  localStorage.setItem(CLE_FOYER, id);
}

/** Oublie le foyer mémorisé (ex. foyer supprimé/introuvable). */
export function effacerFoyerId(): void {
  localStorage.removeItem(CLE_FOYER);
}
