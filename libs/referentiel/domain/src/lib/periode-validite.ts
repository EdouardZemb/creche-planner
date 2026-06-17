import { PeriodeInvalideError } from './referentiel-error.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Borne supérieure conventionnelle d'une période ouverte (sans fin). */
const OUVERT = '9999-12-31';

/**
 * Période de validité d'une entrée du catalogue tarifaire (doc 02 §4.4 bis :
 * « versionnement par date dans le Référentiel »). Bornes au format ISO
 * `YYYY-MM-DD` ; `au` optionnelle (période ouverte, valable indéfiniment).
 *
 * Les dates ISO se comparent **lexicographiquement** : on s'appuie sur cet ordre
 * pour `contient` / `chevauche` sans manipuler d'objets `Date`.
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
