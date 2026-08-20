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

/**
 * Numéro de jour absolu (jour julien grégorien) d'une date décomposée. Formule
 * entière **sans branche** : deux dates se comparent et se soustraient en O(1),
 * là où le report jour à jour d'`ajouterJours` serait linéaire.
 */
function jourAbsolu(annee: number, mois: number, jour: number): number {
  const a = Math.floor((14 - mois) / 12);
  const y = annee + 4800 - a;
  const m = mois + 12 * a - 3;
  return (
    jour +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/**
 * Nombre de jours de `debut` à `fin` (négatif si `fin` précède `debut`).
 * `differenceEnJours(d, d)` vaut 0 — l'étendue d'une période `[du, au]` bornes
 * incluses est donc `differenceEnJours(du, au) + 1`.
 *
 * Lève `DateIsoInvalideError` si l'une des deux n'a pas la forme `YYYY-MM-DD`.
 */
export function differenceEnJours(debut: string, fin: string): number {
  if (!ISO_DATE.test(debut) || !ISO_DATE.test(fin)) {
    throw new DateIsoInvalideError(
      `dates ISO invalides : ${debut} → ${fin} (format attendu : YYYY-MM-DD)`,
    );
  }
  const [a1 = 0, m1 = 0, j1 = 0] = debut.split('-').map(Number);
  const [a2 = 0, m2 = 0, j2 = 0] = fin.split('-').map(Number);
  return jourAbsolu(a2, m2, j2) - jourAbsolu(a1, m1, j1);
}
