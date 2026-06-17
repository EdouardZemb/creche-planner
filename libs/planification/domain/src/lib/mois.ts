import { MoisInvalideError } from './planification-error.js';

const FORMAT_ISO_MOIS = /^(\d{4})-(\d{2})$/;

function deuxChiffres(valeur: number): string {
  return valeur.toString().padStart(2, '0');
}

/**
 * Énumère toutes les dates ISO (`YYYY-MM-DD`) d'un mois `YYYY-MM`, dans l'ordre
 * croissant. Lève `MoisInvalideError` si le format ou le numéro de mois est
 * invalide. Calcul en UTC pour rester indépendant du fuseau horaire.
 */
export function joursDuMois(mois: string): string[] {
  const correspondance = FORMAT_ISO_MOIS.exec(mois);
  if (correspondance === null) {
    throw new MoisInvalideError(
      `mois ISO invalide : ${mois} (format attendu : YYYY-MM)`,
    );
  }
  const annee = Number(correspondance[1]);
  const numeroMois = Number(correspondance[2]);
  if (numeroMois < 1 || numeroMois > 12) {
    throw new MoisInvalideError(
      `numéro de mois hors bornes : ${mois} (01 à 12 attendu)`,
    );
  }
  // Le jour 0 du mois suivant donne le dernier jour du mois courant.
  const nbJours = new Date(Date.UTC(annee, numeroMois, 0)).getUTCDate();
  const jours: string[] = [];
  for (let jour = 1; jour <= nbJours; jour += 1) {
    jours.push(
      `${correspondance[1]}-${correspondance[2]}-${deuxChiffres(jour)}`,
    );
  }
  return jours;
}
