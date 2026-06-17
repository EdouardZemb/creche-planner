import { useEffect } from 'react';

const SUFFIXE = ' — Crèche Planner';

/**
 * Pose `document.title` à « <titre> — Crèche Planner » le temps où le composant
 * est monté. Restaure le titre précédent au démontage.
 */
export function useTitrePage(titre: string): void {
  useEffect(() => {
    const precedent = document.title;
    document.title = `${titre}${SUFFIXE}`;
    return () => {
      document.title = precedent;
    };
  }, [titre]);
}
