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
  refCible: RefObject<T | null>;
  /** À étaler sur la région d'annonce : `<p {...regionLiveProps} />`. */
  regionLiveProps: RegionLiveProps;
}

/**
 * Gestion du focus et de l'annonce au changement de route (UT-02, WCAG 2.4.3).
 *
 * - **Focus** : au changement de `location.pathname` (programmatique, l'élément doit
 *   porter `tabindex="-1"`), jamais au tout premier rendu.
 * - **Annonce** : publie le **titre réel de la page** (fourni par l'appelant depuis
 *   le contexte de titre) et le **re-publie à chaque changement de titre** — donc
 *   aussi lorsqu'un écran de récupération remplace tardivement l'`<Outlet/>` AU MÊME
 *   chemin (ex. « Famille introuvable »). L'annonce n'est plus dérivée du `pathname`.
 *
 * @param titre Titre de la page courante (via le contexte de titre). Recalculé par
 *   l'appelant à chaque rendu ; l'annonce n'est (re)publiée qu'à un vrai changement.
 */
export function useAnnonceRoute<T extends HTMLElement = HTMLElement>(
  titre: string,
): UseAnnonceRouteResultat<T> {
  const { pathname } = useLocation();
  const refCible = useRef<T>(null);
  const [texteAnnonce, setTexteAnnonce] = useState('');
  // Évite de bouger le focus au tout premier rendu (chargement initial) : on ne
  // réagit qu'aux changements de route ultérieurs.
  const premierRendu = useRef(true);
  // Dernier titre « vu » : distingue le settle INITIAL d'une page (chaîne vide →
  // 1er titre : PAS annoncé, région muette au chargement) d'un changement ULTÉRIEUR
  // (navigation OU swap tardif au même chemin : annoncé). Réf plutôt que dépendance
  // d'effet pour ne pas reboucler (cf. mécanique historique de `refAnnonce`).
  const refTitrePrecedent = useRef(titre);

  // Focus : au changement de pathname uniquement (jamais au premier rendu).
  useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false;
      return;
    }
    refCible.current?.focus();
  }, [pathname]);

  // Annonce : le titre courant vient de la page réellement affichée. On (re)publie
  // à chaque changement, en ignorant le premier titre posé (settle initial).
  useEffect(() => {
    if (
      refTitrePrecedent.current !== '' &&
      titre !== refTitrePrecedent.current
    ) {
      setTexteAnnonce(titre);
    }
    refTitrePrecedent.current = titre;
  }, [titre]);

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
