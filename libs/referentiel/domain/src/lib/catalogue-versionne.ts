import { PeriodeValidite } from './periode-validite.js';
import {
  AucuneVersionApplicableError,
  VersionsChevauchantesError,
} from './referentiel-error.js';

/** Toute entrée datée du catalogue porte une période de validité. */
export interface Versionne {
  readonly periode: PeriodeValidite;
}

/**
 * Sélectionne, parmi des versions d'une même clé (ex. grille ABCM d'une tranche),
 * celle applicable à `date` (ISO `YYYY-MM-DD`). En cas de chevauchement résiduel,
 * la version la plus récente (`du` maximal) l'emporte ; aucune ⇒ erreur.
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
 * Garde-fou de publication : refuse d'enregistrer une nouvelle version si elle
 * chevauche une version existante de la même clé (sinon la sélection serait
 * ambiguë). À appeler avec l'ensemble des périodes d'une même clé.
 */
export function verifierAbsenceChevauchement(
  periodes: readonly PeriodeValidite[],
): void {
  periodes.forEach((periode, i) => {
    for (const autre of periodes.slice(i + 1)) {
      if (periode.chevauche(autre)) {
        throw new VersionsChevauchantesError(
          `chevauchement de périodes de validité : [${periode.du}..${periode.au ?? '∞'}] et [${autre.du}..${autre.au ?? '∞'}]`,
        );
      }
    }
  });
}
