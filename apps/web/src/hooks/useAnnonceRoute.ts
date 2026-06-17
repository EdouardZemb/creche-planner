import { useEffect, useRef, useState } from 'react';
import type { HTMLAttributes, RefObject } from 'react';
import { useLocation } from 'react-router-dom';

/** Props à étaler sur l'élément qui sert de région live d'annonce de route. */
export interface RegionLiveProps extends Pick<
  HTMLAttributes<HTMLElement>,
  'aria-live' | 'aria-atomic'
> {
  role: 'status';
  /** Texte annoncé (vide tant qu'aucune navigation n'a eu lieu). */
  children: string;
}

export interface UseAnnonceRouteResultat<T extends HTMLElement = HTMLElement> {
  /** À poser sur la cible du focus (`<h1>`/`<main>`, doit porter `tabindex="-1"`). */
  refCible: RefObject<T>;
  /** À étaler sur la région d'annonce : `<p {...regionLiveProps} />`. */
  regionLiveProps: RegionLiveProps;
}

/**
 * Gestion du focus et de l'annonce au changement de route (UT-02, WCAG 2.4.3).
 *
 * À chaque changement de `location.pathname` : déplace le focus vers `refCible`
 * (programmatique, l'élément doit porter `tabindex="-1"`) et publie une annonce
 * `aria-live="polite"`. La cible et la région sont fournies via la valeur de
 * retour ; le câblage dans `App.tsx` est le rôle du Lot 2.
 *
 * @param annonce Texte à annoncer (typiquement le titre de la page courante).
 *   Recalculé par l'appelant à chaque rendu ; l'annonce n'est (re)publiée qu'au
 *   changement de `pathname`.
 */
export function useAnnonceRoute<T extends HTMLElement = HTMLElement>(
  annonce: string,
): UseAnnonceRouteResultat<T> {
  const { pathname } = useLocation();
  const refCible = useRef<T>(null);
  const [texteAnnonce, setTexteAnnonce] = useState('');
  // Évite de bouger le focus au tout premier rendu (chargement initial) : on ne
  // réagit qu'aux changements de route ultérieurs.
  const premierRendu = useRef(true);
  // Référence stable vers l'annonce courante, sans la mettre en dépendance de
  // l'effet (sinon il rejouerait à chaque frappe modifiant le titre).
  const refAnnonce = useRef(annonce);
  refAnnonce.current = annonce;

  useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false;
      return;
    }
    refCible.current?.focus();
    setTexteAnnonce(refAnnonce.current);
  }, [pathname]);

  return {
    refCible,
    regionLiveProps: {
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': true,
      children: texteAnnonce,
    },
  };
}
