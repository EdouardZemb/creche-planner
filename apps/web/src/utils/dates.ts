import {
  estSemaineIso,
  joursDeLaSemaine,
} from '@creche-planner/shared-semaine';
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

/** Libellés abrégés (mobile : place limitée). */
export const LIBELLES_JOURS_COURT: Record<JourSemaine, string> = {
  LUNDI: 'Lun.',
  MARDI: 'Mar.',
  MERCREDI: 'Mer.',
  JEUDI: 'Jeu.',
  VENDREDI: 'Ven.',
  SAMEDI: 'Sam.',
  DIMANCHE: 'Dim.',
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

/**
 * Lendemain d'une date « YYYY-MM-DD ». Arithmétique en UTC : `Date.UTC` absorbe
 * les débordements (fin de mois, fin d'année, années bissextiles) sans que le
 * fuseau local de la machine ne décale le résultat.
 */
export function jourSuivant(iso: string): string {
  const [y, m, d] = partsIso(iso);
  const lendemain = new Date(Date.UTC(y, m - 1, d + 1));
  const mm = String(lendemain.getUTCMonth() + 1).padStart(2, '0');
  const jj = String(lendemain.getUTCDate()).padStart(2, '0');
  return `${String(lendemain.getUTCFullYear())}-${mm}-${jj}`;
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

/**
 * Heure locale « 21:43 » d'une date. Horodatage du statut de sauvegarde : la
 * date vient de l'appelant (aucune horloge ici), comme les autres helpers.
 */
export function formaterHeureFr(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Horodatage ISO complet « 2026-06-23T06:01:00Z » → « 23/06/2026 à 06:01 ».
 * Date ET heure dérivées d'un même `new Date(iso)` en **UTC** (`getUTCHours`/
 * `getUTCMinutes`), comme la date l'est déjà côté cloche : déterministe en test
 * (aucun fuseau épinglé côté vitest web). Léger décalage possible (+1/+2 h)
 * assumé sur un journal informationnel (cf. plan H3). Réutilise `formaterDateFr`.
 */
export function formaterDateHeureFr(iso: string): string {
  const d = new Date(iso);
  const jour = String(d.getUTCDate()).padStart(2, '0');
  const mois = String(d.getUTCMonth() + 1).padStart(2, '0');
  const annee = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${formaterDateFr(`${String(annee)}-${mois}-${jour}`)} à ${hh}:${mm}`;
}

/** Date « YYYY-MM-DD » → « 15/06 » (jour/mois, sans année — affichage mobile). */
export function formaterDateCourtFr(iso: string): string {
  const [, m, d] = partsIso(iso);
  const jj = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${jj}/${mm}`;
}

/** Jour du mois en français (« 1er », « 6 »). */
function jourDuMoisFr(jour: number): string {
  return jour === 1 ? '1er' : String(jour);
}

/** Nom du mois français d'une date « YYYY-MM-DD » (« juillet »). */
function nomMoisFr(iso: string): string {
  const [y, m] = partsIso(iso);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', {
    month: 'long',
    timeZone: 'UTC',
  });
}

/**
 * Date « YYYY-MM-DD » → « lundi 6 juillet » : jour nommé + date réelle, les
 * mots d'un parent (pendant de `libelleSemaine` pour un jour isolé). Sans
 * année : réservé aux horizons courts (ex. « Prochaine garde » à ~2 semaines).
 */
export function libelleDate(iso: string): string {
  const [, , jour] = partsIso(iso);
  const nomJour = LIBELLES_JOURS[jourSemaineDeIso(iso)].toLowerCase();
  return `${nomJour} ${jourDuMoisFr(jour)} ${nomMoisFr(iso)}`;
}

/**
 * Date « YYYY-MM-DD » → « mardi 1 juillet » : jour nommé + quantième + mois, sans
 * année (relecture d'envoi — la semaine notifiée tient sur un horizon court). Le
 * quantième reste en chiffres (« 1 juillet », pas « 1er ») pour coller au delta figé.
 * Formaté en UTC depuis la date calendaire (sans heure) : aucun fuseau ne décale le
 * jour. Repli sur la chaîne brute si la forme n'est pas `YYYY-MM-DD`.
 */
export function dateLongueFr(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = partsIso(iso);
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Rend `2026-W28` en libellé parent « semaine du 6 au 12 juillet » : des dates
 * réelles, jamais le numéro de semaine ISO (jargon pour un parent). Le mois de
 * début n'apparaît que si la semaine en chevauche deux (« semaine du 29 juin au
 * 5 juillet »), l'année que si la semaine est à cheval sur deux années
 * (« semaine du 29 décembre 2025 au 4 janvier 2026 »). Repli sur la chaîne brute
 * si le format n'est pas `YYYY-Www`. L'ISO reste réservé aux attributs
 * techniques (clés React, appels API) — jamais à l'écran.
 */
export function libelleSemaine(semaineIso: string): string {
  if (!estSemaineIso(semaineIso)) return semaineIso;
  const jours = joursDeLaSemaine(semaineIso);
  const lundi = jours[0];
  const dimanche = jours[6];
  if (lundi === undefined || dimanche === undefined) return semaineIso;
  const [anneeDebut, moisDebut, jourDebut] = partsIso(lundi);
  const [anneeFin, moisFin, jourFin] = partsIso(dimanche);
  let debut = jourDuMoisFr(jourDebut);
  if (anneeDebut !== anneeFin) {
    debut = `${debut} ${nomMoisFr(lundi)} ${String(anneeDebut)}`;
  } else if (moisDebut !== moisFin) {
    debut = `${debut} ${nomMoisFr(lundi)}`;
  }
  const fin =
    anneeDebut !== anneeFin
      ? `${jourDuMoisFr(jourFin)} ${nomMoisFr(dimanche)} ${String(anneeFin)}`
      : `${jourDuMoisFr(jourFin)} ${nomMoisFr(dimanche)}`;
  return `semaine du ${debut} au ${fin}`;
}
