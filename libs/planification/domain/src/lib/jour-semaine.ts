import { DateInvalideError } from './planification-error.js';

/** Jour de la semaine (ubiquitous language, doc 02 §7). */
export type JourSemaine =
  | 'LUNDI'
  | 'MARDI'
  | 'MERCREDI'
  | 'JEUDI'
  | 'VENDREDI'
  | 'SAMEDI'
  | 'DIMANCHE';

/** Index 0 = dimanche (aligné sur `Date#getUTCDay`) → `JourSemaine`. */
const JOURS_PAR_INDEX: readonly JourSemaine[] = [
  'DIMANCHE',
  'LUNDI',
  'MARDI',
  'MERCREDI',
  'JEUDI',
  'VENDREDI',
  'SAMEDI',
];

/**
 * Jours d'ouverture de l'école ABCM (doc 02 §4.4 bis) : lundi, mardi, jeudi,
 * vendredi. Le mercredi (et les vacances) relèvent de l'ALSH.
 */
export const JOURS_OUVERTURE_ECOLE: readonly JourSemaine[] = [
  'LUNDI',
  'MARDI',
  'JEUDI',
  'VENDREDI',
];

const FORMAT_ISO_JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Convertit une date ISO `YYYY-MM-DD` en jour de la semaine. Lève
 * `DateInvalideError` si le format est invalide ou la date inexistante.
 * Le calcul est fait en UTC pour rester indépendant du fuseau horaire.
 */
export function jourSemaineDeIso(iso: string): JourSemaine {
  const correspondance = FORMAT_ISO_JOUR.exec(iso);
  if (correspondance === null) {
    throw new DateInvalideError(
      `date ISO invalide : ${iso} (format attendu : YYYY-MM-DD)`,
    );
  }
  const annee = Number(correspondance[1]);
  const mois = Number(correspondance[2]);
  const jour = Number(correspondance[3]);
  const date = new Date(Date.UTC(annee, mois - 1, jour));
  if (
    date.getUTCFullYear() !== annee ||
    date.getUTCMonth() !== mois - 1 ||
    date.getUTCDate() !== jour
  ) {
    throw new DateInvalideError(`date inexistante : ${iso}`);
  }
  // getUTCDay : 0 (dimanche) → 6 (samedi). L'index est toujours valide.
  return JOURS_PAR_INDEX[date.getUTCDay()]!;
}

/** Vrai si le jour est un jour d'ouverture de l'école ABCM (doc 02 §4.4 bis). */
export function estJourOuvertureEcole(jour: JourSemaine): boolean {
  return JOURS_OUVERTURE_ECOLE.includes(jour);
}
