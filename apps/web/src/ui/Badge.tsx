import type { ReactNode } from 'react';

export type VarianteBadge = 'defaut' | 'simulation';

export interface BadgeProps {
  children: ReactNode;
  /** Variante visuelle ; « simulation » pour le badge « Simulation ». */
  variante?: VarianteBadge;
}

/** Badge générique. La variante « simulation » est jaune/ambre. */
export function Badge({ children, variante = 'defaut' }: BadgeProps) {
  const classe = variante === 'simulation' ? 'badge badge-simulation' : 'badge';
  return <span className={classe}>{children}</span>;
}
