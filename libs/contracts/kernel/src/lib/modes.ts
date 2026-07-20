/**
 * Modes de garde couverts par un contrat (doc 02 §1) — **source de vérité
 * unique** du dépôt (SFD 30 §H4, DV-04 réduit) : ne pas redéfinir cette liste
 * ailleurs, importer/ré-exporter depuis ce module. Consommé directement par
 * les couches infrastructure/app (services, gateway, web) et ré-exporté par
 * `@creche-planner/contracts-planification` et `@creche-planner/contracts-referentiel`
 * pour compatibilité descendante (les libs `type:domain` ne dépendent pas des
 * contrats — cf. `@nx/enforce-module-boundaries` — et conservent leur propre
 * union locale, tenue identique par convention).
 */
export const MODES_CONTRAT = [
  'CRECHE_PSU',
  'PERISCOLAIRE',
  'CANTINE',
  'ALSH',
] as const;
/** Mode de garde d'un contrat (type unitaire dérivé de `MODES_CONTRAT`). */
export type ModeContrat = (typeof MODES_CONTRAT)[number];

/** Modes facturés via une grille ABCM par tranche (doc 02 §4), sous-ensemble de `MODES_CONTRAT`. */
export const MODES_ABCM = [
  'PERISCOLAIRE',
  'CANTINE',
  'ALSH',
] as const satisfies readonly ModeContrat[];
/** Mode de garde ABCM (type unitaire dérivé de `MODES_ABCM`). */
export type ModeAbcm = (typeof MODES_ABCM)[number];

/** Vrai si le mode relève d'une grille ABCM (et non du barème PSU). */
export function estModeAbcm(mode: ModeContrat): boolean {
  return (MODES_ABCM as readonly string[]).includes(mode);
}
