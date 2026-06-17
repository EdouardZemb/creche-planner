import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { EcrirePlanning } from '../types/bff';

export interface SaisieServeur {
  /** Saisie enregistrée côté serveur pour ce (contrat, mois, simulé), ou `null`. */
  saisie: EcrirePlanning | null;
  /** Vrai une fois la réponse serveur reçue (succès ou échec). */
  chargee: boolean;
}

/**
 * Réhydrate la saisie d'un mois depuis le serveur (durabilité multi-poste) :
 * la source de vérité des ajustements est `planning_mois.saisie`, pas seulement
 * le navigateur. Tant que la réponse n'est pas arrivée, `chargee` reste faux et
 * les calendriers affichent leur brouillon local (sessionStorage). En cas
 * d'erreur réseau, on bascule `chargee` à vrai avec `saisie: null` : le calendrier
 * conserve alors son brouillon local sans bloquer la saisie.
 */
export function useSaisieServeur(
  contratId: string,
  mois: string,
  simule: boolean,
): SaisieServeur {
  const [etat, setEtat] = useState<SaisieServeur>({
    saisie: null,
    chargee: false,
  });

  useEffect(() => {
    const ctrl = new AbortController();
    setEtat({ saisie: null, chargee: false });
    api
      .lirePlanning(contratId, mois, simule, { signal: ctrl.signal })
      .then((reponse) => {
        if (ctrl.signal.aborted) return;
        setEtat({ saisie: reponse.saisie, chargee: true });
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setEtat({ saisie: null, chargee: true });
      });
    return () => ctrl.abort();
  }, [contratId, mois, simule]);

  return etat;
}
