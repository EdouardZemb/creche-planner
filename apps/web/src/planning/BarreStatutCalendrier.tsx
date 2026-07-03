import type { ReactNode } from 'react';
import { StatutSauvegarde } from '../ui/StatutSauvegarde';
import type { EtatEnregistrement } from './usePlanning';

export interface BarreStatutCalendrierProps {
  /** État de l'écriture debouncée (cf. `useCalendrierContrat`). */
  etat: EtatEnregistrement;
  /** Heure « 21:43 » du dernier enregistrement abouti (badge persistant). */
  enregistreA: string | null;
  /** Détail de l'erreur d'écriture de planning (affiché si statut « erreur »). */
  erreur: string | null;
  /** Rejoue la dernière écriture (bouton « Réessayer » sur erreur). */
  onReessayer: () => void;
  /** Erreur d'une modification durable du contrat (PUT), le cas échéant. */
  erreurDurable: string | null;
  /** Confirmation d'une modification durable aboutie (contrat + saisies). */
  succesDurable?: string | null;
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
  etat,
  enregistreA,
  erreur,
  onReessayer,
  erreurDurable,
  succesDurable = null,
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
      <StatutSauvegarde etat={etat} enregistreA={enregistreA} />
      {etat === 'erreur' && (
        <>
          {erreur && (
            <span className="muted" style={{ fontSize: '0.82rem' }}>
              {erreur}
            </span>
          )}
          <button
            type="button"
            className="btn secondaire"
            onClick={onReessayer}
          >
            Réessayer
          </button>
        </>
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
      {/* Pas de région live ici : l'annonce lecteur d'écran passe déjà par la
          région AQ-05 du calendrier (sinon double annonce). */}
      {succesDurable && (
        <span style={{ fontSize: '0.82rem', color: 'var(--vert)' }}>
          {succesDurable}
        </span>
      )}
      {apres}
    </div>
  );
}
