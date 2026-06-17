import type { JourSemaine } from '../types/bff';

// Helpers calendaires purs (UTC pour éviter les décalages de fuseau).

export const JOURS_SEMAINE: readonly JourSemaine[] = [
  'LUNDI',
  'MARDI',
  'MERCREDI',
  'JEUDI',
  'VENDREDI',
  'SAMEDI',
  'DIMANCHE',
];

export const LIBELLES_JOURS: Record<JourSemaine, string> = {
  LUNDI: 'Lundi',
  MARDI: 'Mardi',
  MERCREDI: 'Mercredi',
  JEUDI: 'Jeudi',
  VENDREDI: 'Vendredi',
  SAMEDI: 'Samedi',
  DIMANCHE: 'Dimanche',
};

/** Mois courant au format YYYY-MM. */
export function moisCourant(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Découpe « YYYY-MM-DD » en [année, mois (1-12), jour]. */
function partsIso(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y ?? 0, m ?? 0, d ?? 0];
}

/** Jour de la semaine d'une date ISO (LUNDI = index 0). */
export function jourSemaineDeIso(iso: string): JourSemaine {
  const [y, m, d] = partsIso(iso);
  const idx = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return JOURS_SEMAINE[idx] ?? 'LUNDI';
}

/** Toutes les dates « YYYY-MM-DD » d'un mois « YYYY-MM ». */
export function joursDuMois(mois: string): string[] {
  const [y, m] = mois.split('-').map(Number);
  const nb = new Date(y ?? 1970, m ?? 1, 0).getDate();
  const out: string[] = [];
  for (let j = 1; j <= nb; j++) {
    out.push(`${mois}-${String(j).padStart(2, '0')}`);
  }
  return out;
}

/** Libellé « juin 2026 » d'un mois « YYYY-MM ». */
export function formaterMoisFr(mois: string): string {
  const [y, m] = mois.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, 1).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  });
}

/** Date « YYYY-MM-DD » → « 15/06/2026 » (format français court). */
export function formaterDateFr(iso: string): string {
  const [y, m, d] = partsIso(iso);
  const jj = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${jj}/${mm}/${y}`;
}
