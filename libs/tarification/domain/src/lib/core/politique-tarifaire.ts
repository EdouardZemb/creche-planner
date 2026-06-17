import type { CoutMois } from './cout-mois.js';

/** Mode de garde / nature de charge porté par une politique (doc 02 §1). */
export type ModeGarde =
  | 'CRECHE_PSU'
  | 'PERISCOLAIRE'
  | 'CANTINE'
  | 'ALSH'
  | 'FRAIS_FIXES_ABCM'
  | 'UNITES_ASSOCIATIVES';

/**
 * Port (pattern Stratégie, doc 05) : une politique calcule le coût d'**un mois**
 * à partir de sa saisie propre. Chaque mode implémente sa formule sans rien
 * connaître des autres ; la consolidation foyer se fait en aval sur les
 * `CoutMois` produits.
 */
export interface PolitiqueTarifaire<Saisie> {
  readonly mode: ModeGarde;
  calculerCoutMois(saisie: Saisie): CoutMois;
}
