import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { EcrirePlanning } from '../types/bff';

export interface SaisieServeur {
  /** Saisie enregistrée côté serveur pour ce (contrat, mois, simulé), ou `null`. */
  saisie: EcrirePlanning | null;
  /** Vrai une fois la réponse serveur reçue (succès ou échec). */
  chargee: boolean;
  /**
   * Instantané du compteur de mutations locales AU LANCEMENT du GET. Le calendrier
   * le compare au compteur courant pour savoir si une édition locale est survenue
   * pendant le chargement : si oui, cette réponse est périmée et la réhydratation
   * doit être ignorée (anti-clobber, cf. `useCalendrierContrat`).
   */
  seqAuChargement: number;
}

/** Lecteur de compteur par défaut (aucune mutation locale à surveiller). */
const SEQ_ZERO = (): number => 0;

/**
 * Réhydrate la saisie d'un mois depuis le serveur (durabilité multi-poste) :
 * la source de vérité des ajustements est `planning_mois.saisie`, pas seulement
 * le navigateur. Tant que la réponse n'est pas arrivée, `chargee` reste faux et
 * les calendriers affichent leur brouillon local (sessionStorage). En cas
 * d'erreur réseau, on bascule `chargee` à vrai avec `saisie: null` : le calendrier
 * conserve alors son brouillon local sans bloquer la saisie.
 *
 * `lireSeqLocale` renvoie le compteur de mutations locales de l'appelant ; sa
 * valeur est capturée au lancement du GET et remontée dans `seqAuChargement`,
 * afin qu'une édition faite PENDANT le chargement prime sur une réponse plus
 * ancienne (cf. `useCalendrierContrat`).
 */
export function useSaisieServeur(
  contratId: string,
  mois: string,
  simule: boolean,
  lireSeqLocale: () => number = SEQ_ZERO,
): SaisieServeur {
  const [etat, setEtat] = useState<SaisieServeur>({
    saisie: null,
    chargee: false,
    seqAuChargement: 0,
  });

  useEffect(() => {
    const ctrl = new AbortController();
    // Compteur local figé à l'instant du lancement : toute mutation ultérieure
    // rendra cette réponse obsolète (l'édition récente devra primer sur elle).
    const seqAuChargement = lireSeqLocale();
    setEtat({ saisie: null, chargee: false, seqAuChargement });
    api
      .lirePlanning(contratId, mois, simule, { signal: ctrl.signal })
      .then((reponse) => {
        if (ctrl.signal.aborted) return;
        setEtat({ saisie: reponse.saisie, chargee: true, seqAuChargement });
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setEtat({ saisie: null, chargee: true, seqAuChargement });
      });
    return () => {
      ctrl.abort();
    };
  }, [contratId, mois, simule, lireSeqLocale]);

  return etat;
}
