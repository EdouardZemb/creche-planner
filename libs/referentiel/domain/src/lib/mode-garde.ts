import { ModeGardeInconnuError } from './referentiel-error.js';

/** Modes de garde du domaine (doc 02 §1). */
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
