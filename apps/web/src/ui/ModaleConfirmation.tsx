import { useRef } from 'react';
import type { ReactNode } from 'react';
import { Bouton } from './Bouton';
import { Modale } from './Modale';

export interface ModaleConfirmationProps {
  /** Contrôle l'affichage : la modale n'est montée que si `ouvert` est vrai. */
  ouvert: boolean;
  titre: string;
  /** Texte explicatif (le « pourquoi »/conséquence de l'action). */
  message: string;
  /** Libellé de l'action primaire (ex. « Supprimer le contrat »). */
  libelleConfirmer: string;
  onConfirmer: () => void;
  onAnnuler: () => void;
  /**
   * Action destructive : stylise le bouton primaire en danger. Indépendant du
   * focus initial, qui reste toujours sur « Annuler » (choix de sûreté).
   */
  destructif?: boolean;
  /** Contenu complémentaire rendu entre le message et les boutons. */
  children?: ReactNode;
}

/**
 * Confirmation accessible (UT-03) bâtie sur la `Modale` existante : hérite du
 * `role="dialog"`, du focus-trap, d'Échap et de la fermeture sur overlay.
 *
 * Spécificité : le **focus initial est sur « Annuler »** (et non sur l'action
 * primaire), pour qu'une validation destructive ne parte jamais sur un simple
 * Entrée réflexe. On le garantit en passant `refAnnuler` à `Modale` via
 * `refFocusInitial` : la `Modale` pose alors directement le focus sur « Annuler »
 * (plutôt que sur le « × » de l'en-tête), sans course d'effets parent/enfant (EC-01).
 */
export function ModaleConfirmation({
  ouvert,
  titre,
  message,
  libelleConfirmer,
  onConfirmer,
  onAnnuler,
  destructif = false,
  children,
}: ModaleConfirmationProps) {
  const refAnnuler = useRef<HTMLButtonElement>(null);

  if (!ouvert) return null;

  return (
    <Modale titre={titre} onClose={onAnnuler} refFocusInitial={refAnnuler}>
      <p>{message}</p>
      {children}
      <div className="mt-4" style={{ display: 'flex', gap: '0.5rem' }}>
        <Bouton variante="secondaire" ref={refAnnuler} onClick={onAnnuler}>
          Annuler
        </Bouton>
        <Bouton
          variante={destructif ? 'danger' : 'primaire'}
          onClick={onConfirmer}
        >
          {libelleConfirmer}
        </Bouton>
      </div>
    </Modale>
  );
}
