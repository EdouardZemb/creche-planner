import type { Mode } from '../types/bff';

// Source UNIQUE des libellés de mode (accentués), consommée par tous les lots.
// Ne jamais afficher un mode brut (« CRECHE_PSU ») à l'utilisateur : passer par
// libelleMode(mode).
export const LIBELLES_MODE: Record<Mode, string> = {
  CRECHE_PSU: 'Crèche PSU',
  CANTINE: 'Cantine',
  PERISCOLAIRE: 'Périscolaire',
  ALSH: 'ALSH',
};

/**
 * Garde de type : `mode` appartient-il à l'ensemble `Mode` connu du front ?
 *
 * Le contrat gateway type `ContratVue.mode` comme une chaîne libre (DEC-03 :
 * vérité du contrat OpenAPI). Ce garde reconnecte cette chaîne aux modes connus.
 */
export function estMode(mode: string): mode is Mode {
  return Object.prototype.hasOwnProperty.call(LIBELLES_MODE, mode);
}

/** Libellé accentué d'un mode (chaîne libre du contrat) ; repli sur la valeur brute. */
export function libelleMode(mode: string): string {
  return estMode(mode) ? LIBELLES_MODE[mode] : mode;
}
