import { useEffect, useId, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';

export interface ModaleProps {
  titre: string;
  onClose: () => void;
  children: ReactNode;
  /** Id du titre (sinon généré) pour `aria-labelledby`. */
  labelId?: string;
  /**
   * Élément à focaliser à l'ouverture. S'il est fourni et focusable, il prime
   * sur le premier focusable (par défaut le bouton « Fermer » de l'en-tête).
   * Permet à `ModaleConfirmation` de poser le focus initial sur « Annuler »
   * sans course d'effets parent/enfant (EC-01).
   */
  refFocusInitial?: RefObject<HTMLElement | null>;
}

const SELECTEUR_FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Boîte de dialogue accessible : `role="dialog"`, `aria-modal`, `aria-labelledby`.
 * Déplace le focus à l'ouverture, le restaure sur le déclencheur à la fermeture,
 * piège Tab/Shift+Tab dans la modale, ferme sur Échap et sur clic de l'overlay.
 */
export function Modale({
  titre,
  onClose,
  children,
  labelId,
  refFocusInitial,
}: ModaleProps) {
  const idGenere = useId();
  const idTitre = labelId ?? idGenere;
  const refModale = useRef<HTMLDivElement>(null);

  /**
   * Focus initial à l'ouverture, restauration sur le déclencheur à la fermeture.
   *
   * Effet **distinct** de l'écoute clavier, et volontairement indépendant de
   * `onClose` : `refFocusInitial` est un `useRef` (identité stable), tandis que
   * `onClose` est très souvent une fonction recréée à chaque rendu du parent.
   * Tant que les deux vivaient dans le même effet, **toute** frappe dans un
   * champ porté par `children` re-déclenchait l'effet et **reposait le focus sur
   * « Annuler »** : une saisie perdait tout après son premier caractère. Le bug
   * ne se voyait pas tant qu'aucune modale ne contenait de champ dont l'état
   * vivait chez le parent.
   */
  useEffect(() => {
    const declencheur = document.activeElement as HTMLElement | null;
    const modale = refModale.current;

    // Focus initial : cible explicite (ex. « Annuler ») si fournie, sinon le
    // premier élément focusable, sinon la modale elle-même.
    const premierFocusable =
      modale?.querySelector<HTMLElement>(SELECTEUR_FOCUSABLE);
    const cible = refFocusInitial?.current ?? premierFocusable;
    if (cible) {
      cible.focus();
    } else {
      modale?.focus();
    }
    return () => {
      declencheur?.focus();
    };
  }, [refFocusInitial]);

  // Écoute clavier (Échap + piège à Tab) : réattachée si `onClose` change
  // d'identité, ce qui est sans effet visible pour l'utilisateur.
  useEffect(() => {
    const modale = refModale.current;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !modale) return;
      const elements = Array.from(
        modale.querySelectorAll<HTMLElement>(SELECTEUR_FOCUSABLE),
      ).filter(
        (el) =>
          !el.hasAttribute('disabled') &&
          el.getAttribute('aria-hidden') !== 'true',
      );
      if (elements.length === 0) {
        e.preventDefault();
        modale.focus();
        return;
      }
      const premier = elements[0];
      const dernier = elements[elements.length - 1];
      if (!premier || !dernier) return;
      const actif = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (actif === premier || actif === modale)) {
        e.preventDefault();
        dernier.focus();
      } else if (!e.shiftKey && actif === dernier) {
        e.preventDefault();
        premier.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  function onClickOverlay(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    // Clic sur le backdrop = commodité souris pour fermer. L'accès clavier est
    // garanti par Échap (cf. onKeyDown) et le bouton « fermer » ci-dessous.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="modal-overlay" onMouseDown={onClickOverlay}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        tabIndex={-1}
        ref={refModale}
      >
        <div className="modal-entete">
          <h2 id={idTitre} className="modal-titre">
            {titre}
          </h2>
          <button
            type="button"
            className="modal-fermer"
            aria-label="Fermer"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="modal-corps">{children}</div>
      </div>
    </div>
  );
}
