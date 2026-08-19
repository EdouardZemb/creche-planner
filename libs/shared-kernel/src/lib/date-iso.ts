import { DateIsoInvalideError } from './domain-error.js';

/**
 * Arithmétique de dates ISO `YYYY-MM-DD`, **sans objet `Date`**.
 *
 * Le domaine du dépôt est horloge-free et UTC-naïf : une date est une chaîne
 * `YYYY-MM-DD` que l'on compare **lexicographiquement** (cf. `versionnement.ts`).
 * Reste le besoin de *décaler* une date — la veille d'une date d'effet
 * (`cloreVersionPrecedente`), les fériés mobiles dérivés de Pâques
 * (`jours-feries.ts`). Ce module porte cette arithmétique une seule fois, en
 * entiers, pour que `new Date(...)` n'ait jamais à réapparaître dans le noyau.
 *
 * **Contrat de validation** : seul le *format* est vérifié, pas l'existence du
 * jour — `2026-02-30` est accepté et normalisé. C'est le contrat qu'avait déjà
 * `cloreVersionPrecedente` avant l'extraction ; l'élargir ici changerait le
 * comportement d'un socle en production.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Vrai si `valeur` a la forme d'une date ISO `YYYY-MM-DD`. */
export function estDateIso(valeur: string): boolean {
  return ISO_DATE.test(valeur);
}

/** Vrai si `annee` est bissextile (règle grégorienne). */
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

function formater(annee: number, mois: number, jour: number): string {
  return `${String(annee).padStart(4, '0')}-${String(mois).padStart(2, '0')}-${String(
    jour,
  ).padStart(2, '0')}`;
}

/**
 * Date ISO obtenue en décalant `date` de `delta` jours (négatif = vers le passé).
 * Absorbe les frontières de mois, d'année et les années bissextiles.
 *
 * Report jour à jour : les décalages du domaine sont petits (la veille d'une date
 * d'effet, Pâques + 50). Lève `DateIsoInvalideError` si le format est invalide.
 */
export function ajouterJours(date: string, delta: number): string {
  if (!ISO_DATE.test(date)) {
    throw new DateIsoInvalideError(
      `date ISO invalide : ${date} (format attendu : YYYY-MM-DD)`,
    );
  }
  const [a = 0, m = 0, d = 0] = date.split('-').map(Number);
  let annee = a;
  let mois = m;
  let jour = d + delta;
  while (jour < 1) {
    mois -= 1;
    if (mois === 0) {
      mois = 12;
      annee -= 1;
    }
    jour += joursDansMois(annee, mois);
  }
  while (jour > joursDansMois(annee, mois)) {
    jour -= joursDansMois(annee, mois);
    mois += 1;
    if (mois === 13) {
      mois = 1;
      annee += 1;
    }
  }
  return formater(annee, mois, jour);
}
