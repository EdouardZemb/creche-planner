import { createContext, useContext, type ReactNode } from 'react';
import { api } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import type { MoiVue } from '../types/bff';

/**
 * Identité courante du client (Cloudflare Access B1) résolue côté serveur via
 * `GET /api/v1/moi`, exposée à toute l'app.
 *
 * - `email === null` : **aucune identité établie** (dev sans en-tête, ou prod
 *   `GATEWAY_AUTH_DISABLED=1` sans Cloudflare). Le routage retombe alors sur le
 *   comportement **hérité** (découverte `listerFoyers` + localStorage) — la prod
 *   actuelle est donc inchangée.
 * - `admin` : autorise l'écran de création de foyer. **Permissif** (true) tant
 *   que le gating `ADMIN_EMAILS` est inactif côté gateway.
 * - `foyers` : ensemble **autorisé** quand l'identité est connue ; borne la
 *   sélection de foyer (0/1/N). Le `foyerId` localStorage n'est plus qu'un cache
 *   validé contre cet ensemble.
 */
export interface EtatMoi {
  readonly email: string | null;
  readonly admin: boolean;
  readonly foyers: readonly string[];
  /** Vrai tant que `/api/v1/moi` n'a pas répondu (décision de routage différée). */
  readonly loading: boolean;
  /**
   * Invalide et relance `GET /api/v1/moi` (le `reload` de `useAsync`). À appeler
   * après une mutation qui change l'ensemble des foyers rattachés — typiquement
   * la création d'un foyer — pour que le routage (`Accueil`, en-tête) reflète
   * immédiatement le nouvel état sans rechargement complet de la page.
   */
  readonly recharger: () => void;
}

/**
 * Défaut **permissif et hérité** : utilisé hors `MoiProvider` (tests de
 * composants isolés) et comme repli si `/api/v1/moi` est injoignable. `admin:
 * true` + `email: null` ⇒ aucun écran n'est verrouillé et le routage reste sur
 * le mode historique.
 */
const DEFAUT: EtatMoi = {
  email: null,
  admin: true,
  foyers: [],
  loading: false,
  // Hors `MoiProvider` (tests isolés), il n'y a rien à recharger : no-op.
  recharger: () => {
    /* no-op : aucune requête /moi à invalider hors du provider */
  },
};

const MoiContext = createContext<EtatMoi>(DEFAUT);

export function MoiProvider({ children }: { children: ReactNode }) {
  // Une seule requête /moi pour toute l'app (montée à la racine). En cas d'échec
  // (gateway ancienne, réseau), `data` reste null → on retombe sur le défaut
  // permissif/hérité plutôt que de bloquer l'app.
  const { data, loading, reload } = useAsync<MoiVue>(
    (signal) => api.moi({ signal }),
    [],
  );
  const valeur: EtatMoi =
    data != null
      ? {
          email: data.email,
          admin: data.admin,
          foyers: data.foyers,
          loading,
          recharger: reload,
        }
      : { ...DEFAUT, loading, recharger: reload };
  return <MoiContext.Provider value={valeur}>{children}</MoiContext.Provider>;
}

/** Identité courante + droits. Renvoie le défaut permissif hors `MoiProvider`. */
export function useMoi(): EtatMoi {
  return useContext(MoiContext);
}
