import { useEffect, useState } from 'react';

/**
 * Indique si le navigateur se croit en ligne. Initialise à `navigator.onLine`
 * puis suit les événements `window` `online`/`offline`, et se désabonne au
 * démontage.
 *
 * `navigator.onLine` n'est qu'un *indice* (il peut valoir `true` derrière un
 * wifi captif) : suffisant pour afficher une bannière honnête, pas pour bloquer
 * une action. Les gardes `typeof` gardent le hook inoffensif hors DOM (tests).
 */
export function useEnLigne(): boolean {
  const [enLigne, setEnLigne] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const passerEnLigne = () => {
      setEnLigne(true);
    };
    const passerHorsLigne = () => {
      setEnLigne(false);
    };
    window.addEventListener('online', passerEnLigne);
    window.addEventListener('offline', passerHorsLigne);
    return () => {
      window.removeEventListener('online', passerEnLigne);
      window.removeEventListener('offline', passerHorsLigne);
    };
  }, []);

  return enLigne;
}
