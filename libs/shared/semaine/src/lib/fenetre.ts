/**
 * Extraction **pure** de la fenêtre d'une semaine dans une saisie mensuelle. Le
 * planning d'un mois (`planning_mois.saisie` côté `svc-planification`) est un objet
 * libre dont seules les entrées **datées** portent un jour précis :
 * `joursSupplementaires`, `absences`, `exceptions`, `joursAlsh` (chacune un tableau
 * d'items `{ date: 'YYYY-MM-DD', … }`). Les scalaires mensuels (`complementMinutes`,
 * `pai`) ne sont pas rattachables à un jour : ils sont **hors périmètre** d'un
 * raisonnement hebdomadaire jour par jour.
 *
 * `extraireSemaine` restreint ces entrées datées aux 7 jours de la semaine pour
 * produire un `SnapshotSemaine` canonique (jour → entrées). Aucune I/O, aucune
 * horloge : le module est partagé par la validation (`svc-notifications`, diff de
 * semaine) et la lecture/édition hebdomadaire (BFF gateway, `svc-planification`),
 * et testable par propriétés et oracles (`fenetre.spec.ts`).
 */

/** Catégories d'entrées **datées** d'une saisie mensuelle (jour par jour). */
export const CATEGORIES_DATEES = [
  'joursSupplementaires',
  'absences',
  'exceptions',
  'joursAlsh',
  'ajustements',
] as const;

type CategorieDatee = (typeof CATEGORIES_DATEES)[number];

/** Entrées de planning rattachées à un même jour (`YYYY-MM-DD`). */
export type SaisieJour = Readonly<Record<CategorieDatee, readonly unknown[]>>;

/** Vue canonique d'une semaine : jour → entrées datées (jours vides omis). */
export type SnapshotSemaine = Readonly<Record<string, SaisieJour>>;

function jourVide(): Record<CategorieDatee, unknown[]> {
  return {
    joursSupplementaires: [],
    absences: [],
    exceptions: [],
    joursAlsh: [],
    ajustements: [],
  };
}

/**
 * Extrait la vue canonique des jours d'une semaine à partir d'une ou deux saisies
 * mensuelles (une semaine peut chevaucher deux mois). On ne retient que les entrées
 * datées dont la `date` tombe dans `jours` ; un jour sans aucune entrée n'apparaît
 * pas dans le snapshot (forme canonique → diff stable).
 */
export function extraireSemaine(
  plannings: readonly (Record<string, unknown> | null | undefined)[],
  jours: readonly string[],
): SnapshotSemaine {
  const fenetre = new Set(jours);
  const snapshot: Record<string, Record<CategorieDatee, unknown[]>> = {};
  const garantir = (date: string) => {
    const existant = snapshot[date];
    if (existant) {
      return existant;
    }
    const cree = jourVide();
    snapshot[date] = cree;
    return cree;
  };

  for (const planning of plannings) {
    if (!planning) {
      continue;
    }
    for (const categorie of CATEGORIES_DATEES) {
      const valeur = planning[categorie];
      if (!Array.isArray(valeur)) {
        continue;
      }
      for (const item of valeur) {
        const date = (item as { date?: unknown }).date;
        if (typeof date === 'string' && fenetre.has(date)) {
          garantir(date)[categorie].push(item);
        }
      }
    }
  }
  return snapshot;
}
