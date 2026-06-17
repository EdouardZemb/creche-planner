import { useCallback, useMemo, useState } from 'react';

// Persistance locale des absences saisies, par (contrat, mois) (UT-07). Évite la
// PERTE de saisie quand l'utilisateur change de mois : l'état React du calendrier
// est remonté à chaque mois, ce hook conserve donc la saisie hors du composant.
//
// La SOURCE DE VÉRITÉ reste l'état applicatif/serveur (le BFF) ; ce hook ne fait
// que mémoriser localement (sessionStorage) pour ne rien
// perdre entre deux navigations de mois. Le type d'absence est volontairement
// générique : le hook stocke ce que le calendrier lui confie sans le contraindre.

const PREFIXE_CLE = 'creche:absences';

function cle(prefixe: string, contratId: string, mois: string): string {
  return `${prefixe}:${contratId}:${mois}`;
}

export interface UsePersistanceAbsencesResultat<A> {
  /** Lit les absences mémorisées pour un (contrat, mois). `[]` si rien. */
  lire: (contratId: string, mois: string) => A[];
  /** Mémorise les absences pour un (contrat, mois) (remplace l'entrée). */
  ecrire: (contratId: string, mois: string, absences: A[]) => void;
  /** Efface l'entrée d'un (contrat, mois) (ex. après sauvegarde serveur). */
  effacer: (contratId: string, mois: string) => void;
  /**
   * Vrai si la dernière écriture a échoué (quota dépassé, Storage indisponible) :
   * la saisie en cours n'est alors PAS conservée entre deux navigations (AQ-12).
   * Repasse à faux dès qu'une écriture aboutit.
   */
  indisponible: boolean;
}

/**
 * Persistance des absences par (contrat, mois). Pas de fuite entre mois : chaque
 * couple a sa propre clé. `lire` sur un (contrat, mois) jamais écrit renvoie `[]`.
 *
 * @typeParam A Forme d'une absence telle que manipulée par l'appelant
 *   (`CalendrierCreche` y range son `EtatAbsence`). Le hook ne l'inspecte pas.
 */
export function usePersistanceAbsences<A = unknown>(
  prefixe: string = PREFIXE_CLE,
): UsePersistanceAbsencesResultat<A> {
  const [indisponible, setIndisponible] = useState(false);

  const lire = useCallback(
    (contratId: string, mois: string): A[] => {
      try {
        const brut = sessionStorage.getItem(cle(prefixe, contratId, mois));
        return brut ? (JSON.parse(brut) as A[]) : [];
      } catch {
        return [];
      }
    },
    [prefixe],
  );

  const ecrire = useCallback(
    (contratId: string, mois: string, absences: A[]): void => {
      try {
        sessionStorage.setItem(
          cle(prefixe, contratId, mois),
          JSON.stringify(absences),
        );
        setIndisponible(false);
      } catch (e) {
        // Quota/Storage indisponible : la source serveur reste maître, mais on
        // le signale (AQ-12) au lieu d'avaler l'échec — l'utilisateur doit savoir
        // que sa saisie ne survivra pas à un changement de mois avant sauvegarde.
        console.warn(
          `Persistance locale indisponible (sessionStorage, clé ${cle(prefixe, contratId, mois)}) :`,
          e,
        );
        setIndisponible(true);
      }
    },
    [prefixe],
  );

  const effacer = useCallback(
    (contratId: string, mois: string): void => {
      try {
        sessionStorage.removeItem(cle(prefixe, contratId, mois));
      } catch {
        // idem : best-effort.
      }
    },
    [prefixe],
  );

  // Objet de retour mémoïsé : les `useCallback` ci-dessus sont stables, mais sans
  // ce `useMemo` l'objet littéral serait recréé à chaque rendu. Un consommateur qui
  // dépend de l'objet entier (ex. un `useEffect` sur `[persistance, ...]`) bouclerait
  // alors indéfiniment. ATTENTION : l'identité change quand `indisponible` bascule —
  // un effet de réhydratation doit donc dépendre des fonctions (`persistance.lire`),
  // pas de l'objet entier, pour ne pas rejouer sur un simple échec d'écriture.
  return useMemo(
    () => ({ lire, ecrire, effacer, indisponible }),
    [lire, ecrire, effacer, indisponible],
  );
}
