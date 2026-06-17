// Formatage des montants. Les montants de LECTURE du BFF sont en CENTIMES ;
// la conversion en euros se fait uniquement à l'affichage (jamais à l'écriture).
// On ne réutilise PAS la classe Money de shared-kernel (frontière context:web).

/** Formate des centimes en chaîne « 1 234,56 € » (locale fr-FR). */
export function centimesEnEuros(centimes: number): string {
  return (centimes / 100).toLocaleString('fr-FR', {
    style: 'currency',
    currency: 'EUR',
  });
}

/** Centimes → euros (number) pour les calculs de delta. */
export function enEuros(centimes: number): number {
  return centimes / 100;
}

/** Delta signé formaté (« +12,30 € » / « -4,00 € »). */
export function deltaEnEuros(centimes: number): string {
  const signe = centimes > 0 ? '+' : '';
  return `${signe}${centimesEnEuros(centimes)}`;
}

/**
 * Sens d'un delta de coût, indépendant de la couleur (UT-09 / WCAG 1.4.1).
 * - `economie` : la simulation coûte moins que le réel (delta < 0) ;
 * - `depassement` : la simulation coûte plus (delta > 0) ;
 * - `egalite` : aucun écart (delta = 0).
 */
export type SensDelta = 'economie' | 'depassement' | 'egalite';

export function sensDelta(centimes: number): SensDelta {
  if (centimes < 0) return 'economie';
  if (centimes > 0) return 'depassement';
  return 'egalite';
}

/**
 * Repère NON COLORÉ du sens d'un delta (UT-09 CA2) : symbole + libellé textuels,
 * pour ne pas reposer sur la seule couleur (le vert/rouge devient redondant).
 * Pur (pas de JSX) — le rendu est fait par les composants `couts/*`.
 */
export interface RepereDelta {
  /** Symbole non coloré : ▼ (économie), ▲ (dépassement), = (égalité). */
  symbole: string;
  /** Libellé accessible court (« économie », « dépassement », « identique »). */
  libelle: string;
}

const REPERES_DELTA: Record<SensDelta, RepereDelta> = {
  economie: { symbole: '▼', libelle: 'économie' },
  depassement: { symbole: '▲', libelle: 'dépassement' },
  egalite: { symbole: '=', libelle: 'identique' },
};

export function repereDelta(centimes: number): RepereDelta {
  return REPERES_DELTA[sensDelta(centimes)];
}
