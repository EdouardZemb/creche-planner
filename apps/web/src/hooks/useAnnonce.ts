import { useCallback, useRef, useState } from 'react';
import type { RegionLiveProps } from './useAnnonceRoute';

export interface UseAnnonceResultat {
  /** Publie une annonce pour les lecteurs d'écran (région live polite). */
  annoncer: (texte: string) => void;
  /** À étaler sur la région d'annonce : `<p {...regionLiveProps} className="sr-only" />`. */
  regionLiveProps: RegionLiveProps;
}

/**
 * Annonces `aria-live` à la demande (AQ-05, WCAG 4.1.3) : lors d'une mutation
 * sans navigation (ex. saisie du calendrier), publie un message dans une région
 * live `polite` pour que les lecteurs d'écran confirment la prise en compte de
 * l'action — la sauvegarde serveur étant différée (debounce), le retour visuel
 * seul ne suffit pas.
 *
 * Même motif que [useAnnonceRoute], mais piloté par l'appelant (`annoncer`)
 * plutôt que par le changement de route. Deux annonces consécutives identiques
 * doivent être relues : sans mutation du DOM, les lecteurs d'écran ignorent la
 * seconde — on alterne donc un espace insécable final (invisible) à chaque appel.
 */
export function useAnnonce(): UseAnnonceResultat {
  const [texte, setTexte] = useState('');
  const bascule = useRef(false);

  const annoncer = useCallback((message: string) => {
    bascule.current = !bascule.current;
    setTexte(bascule.current ? message : message + '\u00A0');
  }, []);

  return {
    annoncer,
    regionLiveProps: {
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': true,
      children: texte,
    },
  };
}
