import { ajouterJours } from './date-iso.js';
import { AnneeInvalideError } from './domain-error.js';

/**
 * **Jours fériés calculés** (SFD 31, RM-31-02/RM-31-05 ; hypothèse H5 du plan).
 *
 * Les fériés français sont **dérivables**, pas importables : huit dates fixes et
 * trois dates mobiles adossées à Pâques. Rien n'est donc seedé, rien ne se périme,
 * et aucune année n'a besoin d'être « chargée » avant d'être interrogeable.
 *
 * **Le régime est une donnée d'établissement, pas une constante** : Mulhouse relève
 * du droit local d'Alsace-Moselle, qui ajoute le Vendredi saint et le 26 décembre.
 * Le type de régime est **ouvert** — le plan 32 y ajoutera `CH_BL` (Bâle-Campagne)
 * pour le parent frontalier.
 *
 * **Placement** : ce module vit dans le `shared-kernel` (tags `type:domain` +
 * `context:shared`) et non dans `planification-domain`, parce que le décompte des
 * congés du plan 32 le consommera depuis un autre bounded context — que les
 * `depConstraints` Nx interdiraient d'atteindre autrement (décision inter-plans H5).
 *
 * **Un seul axe de temps s'y applique.** Les fériés ne sont pas historisés : ils
 * sont calculés, donc identiques quel que soit l'instant de connaissance auquel on
 * les interroge (cf. `instant.ts`). Une résolution de calendrier les recalcule au
 * lieu de les relire.
 */

/** Régimes de fériés connus (ouvert : le plan 32 y ajoutera `CH_BL`). */
export const REGIMES_FERIES = ['FR', 'FR_ALSACE_MOSELLE'] as const;

/** Régime de fériés d'un établissement (donnée, jamais une constante de code). */
export type RegimeFeries = (typeof REGIMES_FERIES)[number];

/** Un jour férié : le jour ISO `YYYY-MM-DD` et son libellé affichable. */
export interface JourFerie {
  readonly jour: string;
  readonly libelle: string;
}

/** Fériés à date fixe du régime national, en `MM-DD`. */
const FIXES_FR: readonly (readonly [string, string])[] = [
  ['01-01', "Jour de l'an"],
  ['05-01', 'Fête du Travail'],
  ['05-08', 'Victoire 1945'],
  ['07-14', 'Fête nationale'],
  ['08-15', 'Assomption'],
  ['11-01', 'Toussaint'],
  ['11-11', 'Armistice 1918'],
  ['12-25', 'Noël'],
];

/** Férié fixe supplémentaire du droit local d'Alsace-Moselle. */
const FIXES_ALSACE_MOSELLE: readonly (readonly [string, string])[] = [
  ['12-26', 'Saint-Étienne'],
];

/**
 * Décalages en jours par rapport au dimanche de Pâques, régime national.
 * (Le dimanche de Pâques lui-même n'est pas férié au sens du droit du travail :
 * c'est un dimanche.)
 */
const MOBILES_FR: readonly (readonly [number, string])[] = [
  [1, 'Lundi de Pâques'],
  [39, 'Ascension'],
  [50, 'Lundi de Pentecôte'],
];

/** Décalage mobile supplémentaire du droit local d'Alsace-Moselle. */
const MOBILES_ALSACE_MOSELLE: readonly (readonly [number, string])[] = [
  [-2, 'Vendredi saint'],
];

/**
 * Dimanche de Pâques de `annee`, en ISO `YYYY-MM-DD` (algorithme grégorien
 * dit « anonyme », équivalent à celui de Gauss corrigé — valable de 1583 à 9999).
 */
function paques(annee: number): string {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const somme = h + l - 7 * m + 114;
  const mois = Math.floor(somme / 31);
  const jour = (somme % 31) + 1;
  return `${String(annee).padStart(4, '0')}-${String(mois).padStart(2, '0')}-${String(
    jour,
  ).padStart(2, '0')}`;
}

/**
 * Jours fériés de `annee` pour `regime`, triés par date croissante.
 * Lève `AnneeInvalideError` hors de la plage grégorienne (1583-9999).
 */
export function joursFeries(
  annee: number,
  regime: RegimeFeries,
): readonly JourFerie[] {
  if (!Number.isInteger(annee) || annee < 1583 || annee > 9999) {
    throw new AnneeInvalideError(
      `année hors plage grégorienne : ${String(annee)} (1583 à 9999 attendu)`,
    );
  }
  const alsaceMoselle = regime === 'FR_ALSACE_MOSELLE';
  const dimanchePaques = paques(annee);
  const fixes = alsaceMoselle
    ? [...FIXES_FR, ...FIXES_ALSACE_MOSELLE]
    : FIXES_FR;
  const mobiles = alsaceMoselle
    ? [...MOBILES_FR, ...MOBILES_ALSACE_MOSELLE]
    : MOBILES_FR;
  const feries: JourFerie[] = [
    ...fixes.map(([moisJour, libelle]) => ({
      jour: `${String(annee).padStart(4, '0')}-${moisJour}`,
      libelle,
    })),
    ...mobiles.map(([decalage, libelle]) => ({
      jour: ajouterJours(dimanchePaques, decalage),
      libelle,
    })),
  ];
  // Les dates d'un même régime sont deux à deux distinctes (test dédié) : le
  // comparateur n'a pas de cas d'égalité à traiter.
  return feries.sort((x, y) => (x.jour < y.jour ? -1 : 1));
}
