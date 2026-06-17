import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { messageErreur } from '../utils/erreurs';
import type { EcrirePlanning } from '../types/bff';

export type EtatEnregistrement = 'idle' | 'en-cours' | 'enregistre' | 'erreur';

export interface UsePlanningResult {
  etat: EtatEnregistrement;
  erreur: string | null;
  ecrire: (
    contratId: string,
    mois: string,
    simule: boolean,
    corps: EcrirePlanning,
  ) => void;
}

const DEBOUNCE_MS = 800;

/** Hook d'écriture de planning avec debounce 800 ms et état d'enregistrement. */
export function usePlanning(onEnregistre: () => void): UsePlanningResult {
  const [etat, setEtat] = useState<EtatEnregistrement>('idle');
  const [erreur, setErreur] = useState<string | null>(null);

  // Dernière requête en attente
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Retour à idle différé après « enregistré » : à annuler comme les autres,
  // sinon il peut tirer après démontage ou écraser l'état d'une saisie suivante.
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nettoyer au démontage
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const ecrire = useCallback(
    (
      contratId: string,
      mois: string,
      simule: boolean,
      corps: EcrirePlanning,
    ) => {
      // Annuler le debounce précédent et un éventuel retour à idle en attente
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
      abortRef.current?.abort();

      setEtat('en-cours');
      setErreur(null);

      timerRef.current = setTimeout(() => {
        const ctrl = new AbortController();
        abortRef.current = ctrl;

        api
          .ecrirePlanning(contratId, mois, simule, corps, {
            signal: ctrl.signal,
          })
          .then(() => {
            if (ctrl.signal.aborted) return;
            setEtat('enregistre');
            setErreur(null);
            onEnregistre();
            // Revenir à idle après 2 s
            idleTimerRef.current = setTimeout(() => setEtat('idle'), 2000);
          })
          .catch((e: unknown) => {
            if (ctrl.signal.aborted) return;
            setEtat('erreur');
            setErreur(messageErreur(e));
          });
      }, DEBOUNCE_MS);
    },
    [onEnregistre],
  );

  return { etat, erreur, ecrire };
}
