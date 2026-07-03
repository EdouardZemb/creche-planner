import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { messageErreur } from '../utils/erreurs';
import { formaterHeureFr } from '../utils/dates';
import type { EcrireSemaineBesoins } from '../types/bff';
import type { EtatEnregistrement } from '../planning/usePlanning';

export interface UseEcritureSemaineResult {
  etat: EtatEnregistrement;
  erreur: string | null;
  /** Heure « 21:43 » du dernier enregistrement abouti (null avant le premier). */
  enregistreA: string | null;
  ecrire: (
    contratId: string,
    semaineIso: string,
    besoins: EcrireSemaineBesoins,
  ) => void;
  /** Rejoue la dernière écriture demandée (reprise après « erreur »). */
  reessayer: () => void;
}

const DEBOUNCE_MS = 800;

type ArgsEcriture = [string, string, EcrireSemaineBesoins];

/**
 * Écriture des besoins d'**une semaine** d'un contrat avec debounce 800 ms, jumeau
 * de `usePlanning` (édition mensuelle) mais ciblant `api.ecrireSemaineBesoins`
 * (fusion read-modify-write côté serveur, Phase 2). L'éditeur hebdomadaire fait
 * plusieurs petites éditions rapprochées (un jour après l'autre) : on coalesce
 * comme pour le calendrier mensuel et on annule la requête en vol au démontage.
 * L'écriture cible toujours le planning **réel** (`simule=false`). Comme pour
 * `usePlanning`, l'état « enregistre » (et son heure) PERSISTE jusqu'à la
 * saisie suivante (UX lot 3).
 */
export function useEcritureSemaine(
  onEnregistre: () => void,
): UseEcritureSemaineResult {
  const [etat, setEtat] = useState<EtatEnregistrement>('idle');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enregistreA, setEnregistreA] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Derniers arguments demandés : « réessayer » rejoue la même écriture.
  const derniereEcritureRef = useRef<ArgsEcriture | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const ecrire = useCallback(
    (contratId: string, semaineIso: string, besoins: EcrireSemaineBesoins) => {
      derniereEcritureRef.current = [contratId, semaineIso, besoins];
      if (timerRef.current !== null) clearTimeout(timerRef.current);
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
