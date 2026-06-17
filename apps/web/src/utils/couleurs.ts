import type { Mode } from '../types/bff';

// Couleur associée à chaque mode, lue depuis les tokens CSS (:root) pour garder
// une source unique. FullCalendar et autres consommateurs reçoivent une chaîne
// couleur JS — on la dérive donc du token via getComputedStyle.

// Token CSS par mode (défini dans styles.css).
const TOKEN_PAR_MODE: Record<Mode, string> = {
  CRECHE_PSU: '--mode-creche',
  CANTINE: '--mode-cantine',
  PERISCOLAIRE: '--mode-periscolaire',
  ALSH: '--mode-alsh',
};

// Repli si le token est vide (jsdom en test ne calcule pas les variables CSS).
const FALLBACK_PAR_MODE: Record<Mode, string> = {
  CRECHE_PSU: '#1d4ed8',
  CANTINE: '#15803d',
  PERISCOLAIRE: '#7c3aed',
  ALSH: '#b45309',
};

/** Couleur (hex) à utiliser pour un mode, lue depuis les tokens CSS. */
export function couleurDuMode(mode: Mode): string {
  const token = TOKEN_PAR_MODE[mode];
  const valeur =
    typeof window !== 'undefined' && typeof getComputedStyle === 'function'
      ? getComputedStyle(document.documentElement)
          .getPropertyValue(token)
          .trim()
      : '';
  return valeur || FALLBACK_PAR_MODE[mode];
}
