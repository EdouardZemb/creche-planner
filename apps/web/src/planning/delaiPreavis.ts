import { joursDeLaSemaine } from '@creche-planner/shared-semaine';
import type { PreavisRegle } from '../types/bff';
import {
  JOURS_SEMAINE,
  LIBELLES_JOURS,
  formaterDateCourtFr,
} from '../utils/dates';

// Traduction du **préavis** d'un établissement en **date limite concrète** pour la
// semaine cible, prête à afficher au parent au moment d'éditer/valider. Module pur,
// sans état ni horloge : la date du jour (`aujourdhui`) est **injectée** par
// l'appelant (le composant passe `jourCourantParis(new Date())`, les tests une date
// fixe), donc `depasse` reste déterministe et testable. Aucun objet `Date` ici.

/** Date limite dérivée d'une règle de préavis pour une semaine donnée. */
export interface DelaiPreavis {
  /** Libellé parent prêt à afficher (préfixé d'un avertissement si dépassé). */
  readonly texte: string;
  /** ISO `YYYY-MM-DD` de la date limite (null si « aucun délai »). */
  readonly dateLimite: string | null;
  /** Vrai si `aujourdhui` est fourni et que la date limite est déjà passée. */
  readonly depasse: boolean;
}

/** Année bissextile (grégorien proleptique). */
function estBissextile(annee: number): boolean {
  return (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;
}

/** Nombre de jours du mois `mois` (1-12) de l'année `annee`. */
function joursDansMois(annee: number, mois: number): number {
  if (mois === 2) {
    return estBissextile(annee) ? 29 : 28;
  }
  return mois === 4 || mois === 6 || mois === 9 || mois === 11 ? 30 : 31;
}

/**
 * Veille d'une date `YYYY-MM-DD`, en arithmétique **entière pure** (sans `Date`, pour
 * garder le module horloge-free). Absorbe les frontières de mois et d'année.
 */
function jourPrecedent(iso: string): string {
  const [a = 0, m = 0, d = 0] = iso.split('-').map(Number);
  let annee = a;
  let mois = m;
  let jour = d - 1;
  if (jour === 0) {
    mois -= 1;
    if (mois === 0) {
      mois = 12;
      annee -= 1;
    }
    jour = joursDansMois(annee, mois);
  }
  return `${String(annee).padStart(4, '0')}-${String(mois).padStart(2, '0')}-${String(
    jour,
  ).padStart(2, '0')}`;
}

/** Recule de `n` jours calendaires (n ≥ 0) depuis une date `YYYY-MM-DD`. */
function reculerJours(iso: string, n: number): string {
  let date = iso;
  for (let i = 0; i < n; i += 1) {
    date = jourPrecedent(date);
  }
  return date;
}

/**
 * Recule de `valeur` jours **ouvrés** (lun–ven) avant `lundiCible` (un lundi, donc
 * d'indice ISO 0). On recule jour par jour ; seuls les lun–ven décrémentent le compteur
 * (le lundi cible lui-même n'est pas compté).
 */
function reculerJoursOuvres(lundiCible: string, valeur: number): string {
  let date = lundiCible;
  let indexJour = 0; // 0 = lundi … 6 = dimanche (lundiCible est un lundi)
  let restants = valeur;
  while (restants > 0) {
    date = jourPrecedent(date);
    indexJour = (indexJour + 6) % 7;
    if (indexJour <= 4) {
      restants -= 1;
    }
  }
  return date;
}

const PREFIXE_DEPASSE =
  'Délai peut-être dépassé — prévenez la crèche au plus vite. ';

/**
 * Traduit une règle de préavis en date limite concrète pour la semaine `semaineIso`
 * (`YYYY-Www`). Retourne `null` s'il n'y a **aucune** règle (rien à afficher).
 *
 * - `JOUR_HEURE { jour, heure }` → la date limite est l'occurrence de `jour` dans la
 *   semaine **précédant** la semaine cible (intervalle `[lundiCible − 7, lundiCible − 1]`).
 * - `JOURS_OUVRES { valeur }` : `valeur` 0 → le **lundi cible** ; `valeur` ≥ 1 → `valeur`
 *   jours ouvrés (lun–ven) avant le lundi cible.
 *
 * Quand `aujourdhui` (ISO `YYYY-MM-DD`) est fourni et que la date limite est
 * lexicographiquement antérieure, `depasse` est vrai et le texte est **préfixé** d'un
 * avertissement. Sans `aujourdhui`, `depasse` vaut `false`.
 */
export function delaiPreavis(
  regle: PreavisRegle | null,
  semaineIso: string,
  aujourdhui?: string,
): DelaiPreavis | null {
  if (regle === null) {
    return null;
  }

  const lundiCible = joursDeLaSemaine(semaineIso)[0];
  if (lundiCible === undefined) {
    return null;
  }

  let dateLimite: string;
  let baseTexte: string;
  switch (regle.type) {
    case 'JOUR_HEURE': {
      const index = JOURS_SEMAINE.indexOf(regle.jour); // 0 = lundi … 6 = dimanche
      dateLimite = reculerJours(lundiCible, 7 - index);
      const jourFr = LIBELLES_JOURS[regle.jour].toLowerCase();
      baseTexte = `À valider avant ${jourFr} ${regle.heure} (le ${formaterDateCourtFr(
        dateLimite,
      )})`;
      break;
    }
    case 'JOURS_OUVRES': {
      if (regle.valeur <= 0) {
        dateLimite = lundiCible;
        baseTexte = 'À valider avant le début de la semaine';
      } else {
        dateLimite = reculerJoursOuvres(lundiCible, regle.valeur);
        baseTexte = `À valider au moins ${String(
          regle.valeur,
        )} jour(s) ouvré(s) à l'avance (avant le ${formaterDateCourtFr(
          dateLimite,
        )})`;
      }
      break;
    }
  }

  const depasse = aujourdhui !== undefined && dateLimite < aujourdhui;
  const texte = depasse ? `${PREFIXE_DEPASSE}${baseTexte}` : baseTexte;
  return { texte, dateLimite, depasse };
}
