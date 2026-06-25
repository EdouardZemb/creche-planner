/**
 * Diff **pur** d'une semaine de planning. Le planning d'un mois (`planning_mois.saisie`
 * côté `svc-planification`) est un objet libre dont seules les entrées **datées**
 * portent un jour précis : `joursSupplementaires`, `absences`, `exceptions`,
 * `joursAlsh` (chacune un tableau d'items `{ date: 'YYYY-MM-DD', … }`). Les scalaires
 * mensuels (`complementMinutes`, `pai`) ne sont pas rattachables à un jour : ils sont
 * **hors périmètre** du diff hebdomadaire, qui raisonne jour par jour.
 *
 * `extraireSemaine` restreint ces entrées datées aux 7 jours de la semaine pour
 * produire un `SnapshotSemaine` canonique (jour → entrées). `calculerDelta` compare
 * deux snapshots et renvoie les jours qui diffèrent. Aucune I/O, aucune horloge : le
 * module est testable par propriétés et oracles.
 */

/** Catégories d'entrées **datées** d'une saisie mensuelle (jour par jour). */
const CATEGORIES_DATEES = [
  'joursSupplementaires',
  'absences',
  'exceptions',
  'joursAlsh',
] as const;

type CategorieDatee = (typeof CATEGORIES_DATEES)[number];

/** Entrées de planning rattachées à un même jour (`YYYY-MM-DD`). */
export type SaisieJour = Readonly<Record<CategorieDatee, readonly unknown[]>>;

/** Vue canonique d'une semaine : jour → entrées datées (jours vides omis). */
export type SnapshotSemaine = Readonly<Record<string, SaisieJour>>;

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

function jourVide(): Record<CategorieDatee, unknown[]> {
  return {
    joursSupplementaires: [],
    absences: [],
    exceptions: [],
    joursAlsh: [],
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

/** Égalité structurelle de deux jours (les deux snapshots viennent du même serveur). */
function memeJour(a: SaisieJour | null, b: SaisieJour | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
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
