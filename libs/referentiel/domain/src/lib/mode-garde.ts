import { ModeGardeInconnuError } from './referentiel-error.js';

/**
 * Modes de garde du domaine (doc 02 §1). **Miroir local documenté** — patron de
 * référence de la convention (CONVENTIONS.md §4) : ce lib `type:domain` ne peut
 * pas dépendre d'un lib `type:contracts` (`@nx/enforce-module-boundaries`), donc
 * le vocabulaire du domaine est recopié ici plutôt qu'importé.
 *
 * Source de vérité : `MODES_CONTRAT`/`ModeContrat` de
 * `@creche-planner/contracts-kernel` (SFD 30 §H4). La conformité n'est PAS
 * laissée à la vigilance : `scripts/verifier-frontieres.mjs` (step bloquant du
 * job `ci`) compare ce miroir à sa source à chaque run. Ne plus le faire
 * diverger — c'était le cas de l'ancien `ModeGarde` à 6 valeurs de
 * `tarification-domain`, renommé depuis en `PolitiqueTarifaireId`.
 */
export type ModeGarde = 'CRECHE_PSU' | 'PERISCOLAIRE' | 'CANTINE' | 'ALSH';

export const MODES_GARDE: readonly ModeGarde[] = [
  'CRECHE_PSU',
  'PERISCOLAIRE',
  'CANTINE',
  'ALSH',
];

/** Modes facturés via une grille ABCM par tranche (doc 02 §4). */
export const MODES_ABCM: readonly ModeGarde[] = [
  'PERISCOLAIRE',
  'CANTINE',
  'ALSH',
];

export function estModeGarde(valeur: string): valeur is ModeGarde {
  return (MODES_GARDE as readonly string[]).includes(valeur);
}

/** Vrai si le mode relève d'une grille ABCM (et non du barème PSU). */
export function estModeAbcm(mode: ModeGarde): boolean {
  return MODES_ABCM.includes(mode);
}

/** Convertit une chaîne en `ModeGarde` ou lève `ModeGardeInconnuError`. */
export function parseModeGarde(valeur: string): ModeGarde {
  if (!estModeGarde(valeur)) {
    throw new ModeGardeInconnuError(
      `mode de garde inconnu : ${valeur} (attendu : ${MODES_GARDE.join(', ')})`,
    );
  }
  return valeur;
}
