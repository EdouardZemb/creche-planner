import { QuantiteInvalideError } from './tarification-error.js';

/**
 * Gardes de saisie partagées par les politiques tarifaires (INV-01 : aucune
 * quantité négative). Les durées/montants passent déjà par `Duree`/`Money` ;
 * ces gardes couvrent les comptages bruts (jours, séances, repas, mensualités).
 */

/** Exige un entier ≥ 0 (nombre de jours, de séances, de repas…). */
export function exigerEntierNonNegatif(valeur: number, libelle: string): void {
  if (!Number.isInteger(valeur) || valeur < 0) {
    throw new QuantiteInvalideError(
      `${libelle} doit être un entier ≥ 0 (reçu : ${valeur})`,
    );
  }
}

/** Exige un entier ≥ 1 (nombre de mensualités, mois calendaire…). */
export function exigerEntierStrictementPositif(
  valeur: number,
  libelle: string,
): void {
  if (!Number.isInteger(valeur) || valeur < 1) {
    throw new QuantiteInvalideError(
      `${libelle} doit être un entier ≥ 1 (reçu : ${valeur})`,
    );
  }
}

/** Exige un nombre fini ≥ 0 (heures décimales : annuelles PSU, bénévolat UA). */
export function exigerNombreNonNegatif(valeur: number, libelle: string): void {
  if (!Number.isFinite(valeur) || valeur < 0) {
    throw new QuantiteInvalideError(
      `${libelle} doit être un nombre ≥ 0 (reçu : ${valeur})`,
    );
  }
}
