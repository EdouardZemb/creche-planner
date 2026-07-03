import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { messageErreur } from '../utils/erreurs';
import { formaterHeureFr } from '../utils/dates';
import type { EcrirePlanning } from '../types/bff';

export type EtatEnregistrement = 'idle' | 'en-cours' | 'enregistre' | 'erreur';

export interface UsePlanningResult {
  etat: EtatEnregistrement;
  erreur: string | null;
  /** Heure « 21:43 » du dernier enregistrement abouti (null avant le premier). */
  enregistreA: string | null;
  ecrire: (
    contratId: string,
    mois: string,
    simule: boolean,
    corps: EcrirePlanning,
  ) => void;
  /** Rejoue la dernière écriture demandée (reprise après « erreur »). */
  reessayer: () => void;
}

const DEBOUNCE_MS = 800;

type ArgsEcriture = [string, string, boolean, EcrirePlanning];

/**
 * Hook d'écriture de planning avec debounce 800 ms et état d'enregistrement.
 * L'état « enregistre » (et son heure) PERSISTE jusqu'à la saisie suivante :
 * un badge qui disparaît après 2 s laisse le parent dans le doute, surtout sur
 * mobile où plusieurs saisies rapprochées le faisaient vaciller (UX lot 3).
 */
export function usePlanning(onEnregistre: () => void): UsePlanningResult {
  const [etat, setEtat] = useState<EtatEnregistrement>('idle');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enregistreA, setEnregistreA] = useState<string | null>(null);

  // Dernière requête en attente
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Derniers arguments demandés : « réessayer » rejoue la même écriture.
  const derniereEcritureRef = useRef<ArgsEcriture | null>(null);

  // Nettoyer au démontage
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
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
      derniereEcritureRef.current = [contratId, mois, simule, corps];
      // Annuler le debounce précédent
      if (timerRef.current !== null) clearTimeout(timerRef.current);
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
            setEnregistreA(formaterHeureFr(new Date()));
            setErreur(null);
            onEnregistre();
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

  const reessayer = useCallback(() => {
    const args = derniereEcritureRef.current;
    if (args !== null) ecrire(...args);
  }, [ecrire]);

  return { etat, erreur, enregistreA, ecrire, reessayer };
}
