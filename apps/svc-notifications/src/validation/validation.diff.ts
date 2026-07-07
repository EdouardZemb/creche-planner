/**
 * Diff **pur** d'une semaine de planning. L'extraction de la fenêtre d'une semaine
 * (entrées datées restreintes aux 7 jours → `SnapshotSemaine` canonique) est
 * désormais partagée dans `@creche-planner/shared-semaine` (`extraireSemaine`),
 * consommée aussi par le BFF gateway et `svc-planification`. Ce module garde la
 * partie **propre à la validation** : comparer deux snapshots et renvoyer les jours
 * qui diffèrent. Aucune I/O, aucune horloge : testable par propriétés et oracles.
 *
 * `extraireSemaine` et les types `SaisieJour`/`SnapshotSemaine` sont **réexportés**
 * ici pour rester le point d'accès historique des consommateurs internes
 * (`schema.ts`, `brouillonService.ts`, `validation.service.ts`).
 */

import {
  CATEGORIES_DATEES,
  type SaisieJour,
  type SnapshotSemaine,
} from '@creche-planner/shared-semaine';

// Réexport du point d'accès historique : les consommateurs internes (`schema.ts`,
// `brouillonService.ts`, `validation.service.ts`, specs) importent l'extraction de
// fenêtre et ses types depuis `validation.diff` — la source réelle est partagée.
export { extraireSemaine } from '@creche-planner/shared-semaine';
export type {
  SaisieJour,
  SnapshotSemaine,
} from '@creche-planner/shared-semaine';

/** Un jour dont les entrées diffèrent entre deux snapshots (`null` = jour absent). */
export interface DeltaJour {
  readonly date: string;
  readonly avant: SaisieJour | null;
  readonly apres: SaisieJour | null;
}

/** Ensemble des jours modifiés entre snapshot et relecture (vide ⇒ aucune modif). */
export interface DeltaModifs {
  readonly jours: readonly DeltaJour[];
}

/**
 * Forme canonique d'un jour pour la comparaison : toutes les catégories datées
 * présentes dans un ordre fixe, une catégorie absente valant `[]`. Rend le diff
 * **robuste aux évolutions du modèle** : un snapshot historique figé avant l'ajout
 * d'une catégorie (ex. `ajustements`) reste équivalent à un snapshot recalculé qui
 * la porte à vide (« catégorie absente ≡ vide ») — pas de faux « modifié ».
 */
function jourCanonique(
  jour: SaisieJour | null,
): Record<string, readonly unknown[]> | null {
  if (jour === null) {
    return null;
  }
  const source = jour as Record<string, readonly unknown[] | undefined>;
  const canonique: Record<string, readonly unknown[]> = {};
  for (const categorie of CATEGORIES_DATEES) {
    canonique[categorie] = source[categorie] ?? [];
  }
  return canonique;
}

/** Égalité structurelle de deux jours, insensible aux catégories datées absentes. */
function memeJour(a: SaisieJour | null, b: SaisieJour | null): boolean {
  return JSON.stringify(jourCanonique(a)) === JSON.stringify(jourCanonique(b));
}

/**
 * Diff jour par jour entre le snapshot de notification (`avant`) et la relecture à
 * la validation (`apres`). Les jours sont parcourus dans l'ordre chronologique ;
 * seuls ceux qui diffèrent figurent dans le delta. Diff non vide ⇒ le planning a
 * changé depuis la notification (`VALIDEE_AVEC_MODIFS`).
 */
export function calculerDelta(
  avant: SnapshotSemaine,
  apres: SnapshotSemaine,
): DeltaModifs {
  const dates = new Set([...Object.keys(avant), ...Object.keys(apres)]);
  const jours: DeltaJour[] = [];
  for (const date of [...dates].sort()) {
    const a = avant[date] ?? null;
    const b = apres[date] ?? null;
    if (!memeJour(a, b)) {
      jours.push({ date, avant: a, apres: b });
    }
  }
  return { jours };
}

/** Vrai si le delta porte au moins un jour modifié. */
export function aDesModifs(delta: DeltaModifs): boolean {
  return delta.jours.length > 0;
}
