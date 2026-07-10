import type { Mode } from '../types/bff';

// Source UNIQUE des libellés de mode (accentués), consommée par tous les lots.
// Ne jamais afficher un mode brut (« CRECHE_PSU ») à l'utilisateur : passer par
// libelleMode(mode).
export const LIBELLES_MODE: Record<Mode, string> = {
  // « PSU » (sigle de financement CAF) est du jargon pour un parent : il ne doit
  // pas apparaître dans les onglets/lignes. Là où le sigle doit rester (glossaire),
  // passer par <Abbr sigle="PSU" />.
  CRECHE_PSU: 'Crèche',
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

/**
 * Pseudo-mode émis par le backend pour la section des frais fixes annuels ABCM
 * (cotisation + 1ʳᵉ inscription, rattachés à septembre). Ce n'est PAS un `Mode`
 * de contrat (le type généré ne le connaît pas) : seule comparaison technique
 * autorisée, via `estFraisFixesAbcm` — jamais affiché brut à l'écran.
 */
const MODE_FRAIS_FIXES_ABCM = 'FRAIS_FIXES_ABCM';

/** Indique si un mode de prestation est la pseudo-prestation des frais fixes ABCM. */
export function estFraisFixesAbcm(mode: string): boolean {
  return mode === MODE_FRAIS_FIXES_ABCM;
}

/**
 * Titre affichable d'une prestation de coût (panneau du mois, exports).
 * Cas général : « <enfant> — <mode accentué> » ; frais fixes annuels ABCM :
 * « Frais annuels — ABCM » (le backend émet `enfant: ''` pour cette
 * pseudo-prestation — ni prénom ni tiret superflu).
 */
export function titrePrestationCout(enfant: string, mode: string): string {
  if (estFraisFixesAbcm(mode)) {
    return 'Frais annuels — ABCM';
  }
  return `${enfant} — ${libelleMode(mode)}`;
}
