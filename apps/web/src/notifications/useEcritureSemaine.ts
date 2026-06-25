import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { messageErreur } from '../utils/erreurs';
import type { EcrireSemaineBesoins } from '../types/bff';
import type { EtatEnregistrement } from '../planning/usePlanning';

export interface UseEcritureSemaineResult {
  etat: EtatEnregistrement;
  erreur: string | null;
  ecrire: (
    contratId: string,
    semaineIso: string,
    besoins: EcrireSemaineBesoins,
  ) => void;
}

const DEBOUNCE_MS = 800;

/**
 * Écriture des besoins d'**une semaine** d'un contrat avec debounce 800 ms, jumeau
 * de `usePlanning` (édition mensuelle) mais ciblant `api.ecrireSemaineBesoins`
 * (fusion read-modify-write côté serveur, Phase 2). L'éditeur hebdomadaire fait
 * plusieurs petites éditions rapprochées (un jour après l'autre) : on coalesce
 * comme pour le calendrier mensuel et on annule la requête en vol au démontage.
 * L'écriture cible toujours le planning **réel** (`simule=false`).
 */
export function useEcritureSemaine(
  onEnregistre: () => void,
): UseEcritureSemaineResult {
  const [etat, setEtat] = useState<EtatEnregistrement>('idle');
  const [erreur, setErreur] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Retour à idle différé après « enregistré » : annulé comme les autres timers,
  // sinon il peut tirer après démontage ou écraser l'état d'une saisie suivante.
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const ecrire = useCallback(
    (contratId: string, semaineIso: string, besoins: EcrireSemaineBesoins) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
      abortRef.current?.abort();

      setEtat('en-cours');
      setErreur(null);

      timerRef.current = setTimeout(() => {
        const ctrl = new AbortController();
        abortRef.current = ctrl;

        api
          .ecrireSemaineBesoins(contratId, semaineIso, besoins, false, {
            signal: ctrl.signal,
          })
          .then(() => {
            if (ctrl.signal.aborted) return;
            setEtat('enregistre');
            setErreur(null);
            onEnregistre();
            idleTimerRef.current = setTimeout(() => {
              setEtat('idle');
            }, 2000);
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
