import {
  AucuneVersionApplicableError,
  ChevauchementVersionsError,
  PeriodeInvalideError,
  TrouDansVersionsError,
} from './domain-error.js';

/**
 * Socle « entité versionnée » (SFD 30 « Versionnement à date d'effet »).
 *
 * Une seule implémentation de la mécanique temporelle — période de validité,
 * résolution à date, continuité sans trou, absence de chevauchement, clôture à la
 * veille — partagée par le Référentiel (grilles, barèmes), la planification
 * (contrats), le foyer (ressources) et, plus tard, le travail.
 *
 * **Invariant de représentation** : les dates sont des chaînes ISO `YYYY-MM-DD`
 * comparées **lexicographiquement**. On ne manipule jamais d'objet `Date` (module
 * horloge-free), y compris pour l'arithmétique de la veille.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Borne supérieure conventionnelle d'une période ouverte (sans fin). */
const OUVERT = '9999-12-31';

/**
 * Période de validité d'une version, bornes au format ISO `YYYY-MM-DD`. `au` est
 * **inclusive** (sémantique `valide_au` du Référentiel, reprise telle quelle) ;
 * `undefined` = période ouverte (valable indéfiniment).
 */
export class PeriodeValidite {
  private constructor(
    readonly du: string,
    readonly au: string | undefined,
  ) {}

  static creer(du: string, au?: string): PeriodeValidite {
    if (!ISO_DATE.test(du)) {
      throw new PeriodeInvalideError(`date de début invalide : ${du}`);
    }
    if (au !== undefined) {
      if (!ISO_DATE.test(au)) {
        throw new PeriodeInvalideError(`date de fin invalide : ${au}`);
      }
      if (au < du) {
        throw new PeriodeInvalideError(
          `fin (${au}) antérieure au début (${du})`,
        );
      }
    }
    return new PeriodeValidite(du, au);
  }

  /** Vrai si `date` (ISO `YYYY-MM-DD`) tombe dans la période, bornes incluses. */
  contient(date: string): boolean {
    if (date < this.du) {
      return false;
    }
    if (this.au !== undefined && date > this.au) {
      return false;
    }
    return true;
  }

  /** Vrai si les deux périodes ont au moins un jour commun. */
  chevauche(autre: PeriodeValidite): boolean {
    const finCeci = this.au ?? OUVERT;
    const finAutre = autre.au ?? OUVERT;
    return this.du <= finAutre && autre.du <= finCeci;
  }
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

/**
 * Veille de `dateEffet` (ISO `YYYY-MM-DD`) : la borne haute **inclusive** de la
 * version précédente quand une nouvelle version prend effet ce jour-là. Arithmétique
 * entière pure (sans `Date`), absorbant les frontières de mois et d'année.
 *
 * Garantie : `cloreVersionPrecedente(d) < d`, donc clore la version précédente ne
 * crée jamais de chevauchement avec la version qui prend effet à `d`.
 */
export function cloreVersionPrecedente(dateEffet: string): string {
  if (!ISO_DATE.test(dateEffet)) {
    throw new PeriodeInvalideError(`date d'effet invalide : ${dateEffet}`);
  }
  const [a = 0, m = 0, d = 0] = dateEffet.split('-').map(Number);
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

/** Toute version datée porte une période de validité. */
export interface Versionne {
  readonly periode: PeriodeValidite;
}

/** Version portant une valeur `T` sur une période de validité. */
export interface VersionValide<T> extends Versionne {
  readonly valeur: T;
}

/**
 * Sélectionne, parmi les versions d'une même entité, celle applicable à `date`
 * (ISO `YYYY-MM-DD`). En cas de chevauchement résiduel, la version la plus récente
 * (`du` maximal) l'emporte ; aucune ⇒ `AucuneVersionApplicableError`.
 */
export function selectionnerVersionApplicable<T extends Versionne>(
  versions: readonly T[],
  date: string,
): T {
  const candidats = versions.filter((v) => v.periode.contient(date));
  if (candidats.length === 0) {
    throw new AucuneVersionApplicableError(
      `aucune version applicable au ${date}`,
    );
  }
  return candidats.reduce((a, b) => (b.periode.du > a.periode.du ? b : a));
}

/**
 * Garde-fou de publication : refuse une suite de périodes dont deux se chevauchent
 * (sinon la sélection serait ambiguë). À appeler avec l'ensemble des périodes d'une
 * même entité.
 */
export function verifierAbsenceChevauchement(
  periodes: readonly PeriodeValidite[],
): void {
  periodes.forEach((periode, i) => {
    for (const autre of periodes.slice(i + 1)) {
      if (periode.chevauche(autre)) {
        throw new ChevauchementVersionsError(
          `chevauchement de périodes de validité : [${periode.du}..${periode.au ?? '∞'}] et [${autre.du}..${autre.au ?? '∞'}]`,
        );
      }
    }
  });
}

/**
 * Vérifie qu'une suite de versions est **continue** : entre deux versions
 * consécutives (triées par `du`), la borne haute de la précédente doit être la
 * veille du début de la suivante — aucun jour non couvert. Une version bornée
 * qui s'arrête avant cette veille laisse un trou ⇒ `TrouDansVersionsError`. Le
 * chevauchement est traité à part (`verifierAbsenceChevauchement`).
 */
export function verifierContinuite(versions: readonly Versionne[]): void {
  const triees = [...versions].sort((a, b) =>
    a.periode.du < b.periode.du ? -1 : a.periode.du > b.periode.du ? 1 : 0,
  );
  triees.forEach((courant, i) => {
    const suivant = triees[i + 1];
    if (suivant === undefined) {
      return;
    }
    const attendue = cloreVersionPrecedente(suivant.periode.du);
    const fin = courant.periode.au;
    if (fin !== undefined && fin < attendue) {
      throw new TrouDansVersionsError(
        `trou dans la suite de versions : la version [${courant.periode.du}..${fin}] laisse un intervalle non couvert avant le ${suivant.periode.du}`,
      );
    }
  });
}

/**
 * Adaptateur « bornes explicites » : construit une suite de versions à partir de
 * la forme du Référentiel existant (`valide_du` / `valide_au` inclusif, `null` =
 * ouvert). Les bornes stockées sont reprises telles quelles, sans dérivation.
 */
export function depuisBornes<T>(
  entrees: readonly {
    readonly valideDu: string;
    readonly valideAu: string | null;
    readonly valeur: T;
  }[],
): readonly VersionValide<T>[] {
  return entrees.map((e) => ({
    periode: PeriodeValidite.creer(e.valideDu, e.valideAu ?? undefined),
    valeur: e.valeur,
  }));
}

/**
 * Adaptateur « suite de dates d'effet » : construit une suite de versions
 * contiguës à partir de simples dates d'effet. La borne haute de chaque version
 * est **dérivée** (veille de la date d'effet suivante) ; la dernière reste ouverte.
 * Les entrées sont triées par date d'effet croissante (l'entrée n'est pas mutée).
 */
export function depuisSuite<T>(
  entrees: readonly {
    readonly dateEffet: string;
    readonly valeur: T;
  }[],
): readonly VersionValide<T>[] {
  const triees = [...entrees].sort((a, b) =>
    a.dateEffet < b.dateEffet ? -1 : a.dateEffet > b.dateEffet ? 1 : 0,
  );
  return triees.map((e, i) => {
    const suivante = triees[i + 1];
    const au =
      suivante === undefined
        ? undefined
        : cloreVersionPrecedente(suivante.dateEffet);
    return {
      periode: PeriodeValidite.creer(e.dateEffet, au),
      valeur: e.valeur,
    };
  });
}
