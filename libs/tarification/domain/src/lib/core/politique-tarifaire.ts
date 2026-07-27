import type { CoutMois } from './cout-mois.js';

/**
 * Nature de charge portée par une politique tarifaire (doc 02 §1) : les 4 modes
 * de garde d'un contrat (`CRECHE_PSU`, `PERISCOLAIRE`, `CANTINE`, `ALSH`) plus 2
 * politiques internes qui ne correspondent à **aucun** mode de contrat —
 * `FRAIS_FIXES_ABCM` (frais annuels rattachés à la rentrée) et
 * `UNITES_ASSOCIATIVES` (part associative) — d'où le nom `PolitiqueTarifaire`,
 * distinct de `ModeContrat`/`ModeGarde` (SFD 30 §H4, DV-04 réduit : ce n'était
 * pas un second `ModeGarde` divergent, mais une union plus large mal nommée).
 */
export type PolitiqueTarifaireId =
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
  readonly mode: PolitiqueTarifaireId;
  calculerCoutMois(saisie: Saisie): CoutMois;
}
