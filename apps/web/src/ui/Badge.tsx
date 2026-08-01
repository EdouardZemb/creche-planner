import type { ReactNode } from 'react';

export type VarianteBadge = 'defaut' | 'simulation' | 'succes' | 'erreur';

const CLASSE: Record<VarianteBadge, string> = {
  defaut: 'badge',
  simulation: 'badge badge-simulation',
  succes: 'badge badge-succes',
  erreur: 'badge badge-erreur',
};

export interface BadgeProps {
  children: ReactNode;
  /** Variante visuelle ; « simulation » est jaune/ambre. */
  variante?: VarianteBadge;
  /**
   * Statut VIVANT (sauvegarde en cours / enregistrée / en échec) : pose
   * `role="status" aria-live="polite"` sur le badge lui-même. L'envelopper dans
   * un nœud porteur de la région live ajouterait un élément et déplacerait la
   * zone annoncée — les lecteurs d'écran n'entendraient plus le changement.
   */
  statutLive?: boolean;
}

/**
 * Badge générique. Le placement (marge, alignement) est porté par le CSS du
 * parent, PAS par une classe passée ici : c'est ce qui a permis de supprimer
 * l'enveloppe `.panneau-cout-badge` et la marge inline d'`HistoriqueContrat`.
 */
export function Badge({
  children,
  variante = 'defaut',
  statutLive = false,
}: BadgeProps) {
  return (
    <span
      className={CLASSE[variante]}
      {...(statutLive
        ? { role: 'status', 'aria-live': 'polite' as const }
        : {})}
    >
      {children}
    </span>
  );
}
