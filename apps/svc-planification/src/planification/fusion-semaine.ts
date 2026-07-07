import { CATEGORIES_DATEES } from '@creche-planner/shared-semaine';
import type { EcrirePlanningDto } from './planification.dto.js';

/**
 * Fusion **pure** d'une édition limitée à une semaine dans la saisie d'un mois.
 *
 * Le planning est stocké **par mois** (`planning_mois.saisie`, forme
 * `EcrirePlanningDto`) et `ecrirePlanning` **remplace tout le mois**. Pour éditer
 * UNIQUEMENT les besoins d'une semaine sans écraser le reste, on relit le mois,
 * on fusionne la part de la semaine, puis on ré-upsert. Ce module porte le cœur
 * « correctness » de cette fusion, sans I/O ni horloge (testable par oracles et
 * propriétés, `fusion-semaine.spec.ts`).
 *
 * Règle : seules les **catégories datées** (`joursSupplementaires`, `absences`,
 * `exceptions`, `joursAlsh`, `ajustements`) sont touchées. On en retire les entrées dont la
 * `date` tombe dans la fenêtre de la semaine, puis on ré-insère les
 * `besoinsSemaine` de cette même fenêtre. Tout le reste est **préservé tel quel** :
 * les scalaires mensuels (`complementMinutes`, `pai`), les entrées datées **hors
 * semaine** (autres jours du mois), et — comme on raisonne mois par mois —
 * l'**autre mois** quand la semaine est à cheval sur deux mois (l'appelant filtre
 * `joursSemaine` aux seuls jours de CE mois, cf. `PlanificationService.ecrireSemaine`).
 */

/** Besoins datés d'une semaine pour un contrat : sous-ensemble daté d'une saisie. */
export type BesoinsSemaine = Pick<
  EcrirePlanningDto,
  | 'joursSupplementaires'
  | 'absences'
  | 'exceptions'
  | 'joursAlsh'
  | 'ajustements'
>;

/** Catégories datées sous forme d'ensemble (test d'appartenance d'une clé). */
const CLES_DATEES = new Set<string>(CATEGORIES_DATEES);

/**
 * Fusionne `besoinsSemaine` dans `saisieMois` en ne remplaçant que les entrées
 * datées des jours de `joursSemaine`. Idempotente : appliquer deux fois la même
 * édition donne le même résultat. Forme canonique : une catégorie datée vide est
 * **omise** (jamais `[]`), pour un upsert et un diff stables.
 */
export function fusionnerSemaineDansMois(
  saisieMois: EcrirePlanningDto | null | undefined,
  joursSemaine: readonly string[],
  besoinsSemaine: BesoinsSemaine,
): EcrirePlanningDto {
  const fenetre = new Set(joursSemaine);
  const dansFenetre = (item: unknown): boolean => {
    const date = (item as { date?: unknown }).date;
    return typeof date === 'string' && fenetre.has(date);
  };

  const base: EcrirePlanningDto = saisieMois ?? {};
  // Préserve scalaires mensuels et toute clé non datée (forme libre), sans les retoucher.
  const resultat: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(base)) {
    if (!CLES_DATEES.has(cle)) {
      resultat[cle] = valeur;
    }
  }

  for (const categorie of CATEGORIES_DATEES) {
    // Entrées du mois HORS semaine (préservées) + besoins de la semaine (réinsérés).
    const horsSemaine = ((base[categorie] ?? []) as readonly unknown[]).filter(
      (item) => !dansFenetre(item),
    );
    const deLaSemaine = (
      (besoinsSemaine[categorie] ?? []) as readonly unknown[]
    ).filter(dansFenetre);
    const fusionnes = [...horsSemaine, ...deLaSemaine];
    if (fusionnes.length > 0) {
      resultat[categorie] = fusionnes;
    }
  }

  return resultat;
}
