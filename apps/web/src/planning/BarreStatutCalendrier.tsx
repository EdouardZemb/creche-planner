import type { ReactNode } from 'react';
import { StatutSauvegarde } from '../ui/StatutSauvegarde';

export interface BarreStatutCalendrierProps {
  /** Statut réduit de l'écriture debouncée (cf. `useCalendrierContrat`). */
  etatStatut: 'idle' | 'enregistre' | 'erreur';
  /** Détail de l'erreur d'écriture de planning (affiché si statut « erreur »). */
  erreur: string | null;
  /** Erreur d'une modification durable du contrat (PUT), le cas échéant. */
  erreurDurable: string | null;
  /** Contenu propre au mode AVANT le statut (complément, PAI, consigne…). */
  children?: ReactNode;
  /** Contenu propre au mode APRÈS les erreurs (ex. alerte persistance locale). */
  apres?: ReactNode;
}

/**
 * Barre d'état commune des calendriers mensuels : statut de sauvegarde,
 * erreurs d'écriture (planning debouncé et PUT contrat), encadrant les
 * contrôles propres au mode.
 */
export function BarreStatutCalendrier({
  etatStatut,
  erreur,
  erreurDurable,
  children,
  apres,
}: BarreStatutCalendrierProps) {
  return (
    <div
      style={{
        marginBottom: '0.75rem',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        flexWrap: 'wrap',
      }}
    >
      {children}
      <StatutSauvegarde etat={etatStatut} />
      {etatStatut === 'erreur' && erreur && (
        <span className="muted" style={{ fontSize: '0.82rem' }}>
          {erreur}
        </span>
      )}
      {erreurDurable && (
        <span
          role="alert"
          className="muted"
          style={{ fontSize: '0.82rem', color: 'var(--erreur, #b00020)' }}
        >
          {erreurDurable}
        </span>
      )}
      {apres}
    </div>
  );
}
