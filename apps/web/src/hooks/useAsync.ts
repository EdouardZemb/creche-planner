import { useCallback, useEffect, useState } from 'react';
import { messageErreur } from '../utils/erreurs';

// Hook de chargement asynchrone générique : annule la requête au démontage /
// changement de dépendances (AbortController) et expose un reload().
//
// Avec une `cle`, le résultat est mis en CACHE (Map module-level) : un
// remontage sur la même clé est servi sans requête réseau, et deux montages
// simultanés partagent la requête en vol (déduplication). L'invalidation passe
// par `reload()` — les appelants l'exposent déjà comme `recharger()` et
// l'appellent après chaque mutation — qui supprime l'entrée puis relance.
// Sans clé, aucun cache : comportement historique (requête à chaque montage).
export interface AsyncEtat<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export interface UseAsyncOptions {
  /**
   * Clé de cache. Doit identifier la requête ET ses paramètres (ex.
   * `contrats:${foyerId}`) : une clé qui ne varie pas avec les deps servirait
   * la valeur d'un autre paramètre.
   */
  cle?: string;
}

/** Requête en vol partagée entre les abonnés d'une même clé. */
interface RequeteEnVol {
  promesse: Promise<unknown>;
  ctrl: AbortController;
  /** Composants montés qui attendent cette requête (abort au dernier parti). */
  abonnes: number;
}

const cacheValeurs = new Map<string, unknown>();
const requetesEnVol = new Map<string, RequeteEnVol>();

/** Vide le cache par clé (isolation des tests). */
export function viderCacheAsync(): void {
  cacheValeurs.clear();
  requetesEnVol.clear();
}

export function useAsync<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  options: UseAsyncOptions = {},
): AsyncEtat<T> {
  const { cle } = options;

  // Valeur en cache disponible dès le premier rendu : pas d'aller-retour par
  // un état « chargement » qui ferait clignoter l'écran au remontage.
  const [data, setData] = useState<T | null>(() =>
    cle !== undefined && cacheValeurs.has(cle)
      ? (cacheValeurs.get(cle) as T)
      : null,
  );
  const [loading, setLoading] = useState<boolean>(
    () => !(cle !== undefined && cacheValeurs.has(cle)),
  );
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => {
    if (cle !== undefined) {
      // Invalidation : la valeur ET la requête en vol (potentiellement lancée
      // avant la mutation) sont écartées — la relance repart du serveur.
      cacheValeurs.delete(cle);
      requetesEnVol.delete(cle);
    }
    setTick((t) => t + 1);
  }, [cle]);

  useEffect(() => {
    // Coup de cache : servi tel quel, sans requête. Un rafraîchissement
    // explicite passe par reload() (qui supprime l'entrée ci-dessus).
    if (cle !== undefined && cacheValeurs.has(cle)) {
      setData(cacheValeurs.get(cle) as T);
      setLoading(false);
      setError(null);
      return;
    }

    let actif = true;

    // Déduplication : rejoint la requête en vol de la même clé, sinon lance.
    let enVol = cle !== undefined ? requetesEnVol.get(cle) : undefined;
    if (enVol === undefined) {
      const ctrl = new AbortController();
      const nouvelle: RequeteEnVol = {
        promesse: fn(ctrl.signal),
        ctrl,
        abonnes: 0,
      };
      enVol = nouvelle;
      if (cle !== undefined) {
        requetesEnVol.set(cle, nouvelle);
        nouvelle.promesse
          .then((d) => {
            // Ne peuple pas le cache si la requête a été invalidée entre-temps
            // (reload) ou annulée : la valeur serait périmée.
            if (requetesEnVol.get(cle) === nouvelle && !ctrl.signal.aborted) {
              cacheValeurs.set(cle, d);
            }
          })
          .catch(() => {
            // Les erreurs sont remontées à chaque abonné ; rien à cacher (le
            // prochain montage retentera la requête).
          })
          .finally(() => {
            if (requetesEnVol.get(cle) === nouvelle) {
              requetesEnVol.delete(cle);
            }
          });
      }
    }
    const partagee = enVol;
    partagee.abonnes += 1;

    setLoading(true);
    setError(null);
    partagee.promesse
      .then((d) => {
        if (!actif || partagee.ctrl.signal.aborted) return;
        setData(d as T);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!actif || partagee.ctrl.signal.aborted) return;
        setError(messageErreur(e));
        setLoading(false);
      });

    return () => {
      actif = false;
      partagee.abonnes -= 1;
      if (cle === undefined) {
        // Sans clé (pas de partage) : annulation systématique, comme avant.
        partagee.ctrl.abort();
      } else if (partagee.abonnes <= 0 && requetesEnVol.get(cle) === partagee) {
        // Dernier abonné d'une requête ENCORE en vol : plus personne ne
        // l'attend, on l'annule (une requête résolue a déjà quitté la Map).
        partagee.ctrl.abort();
        requetesEnVol.delete(cle);
      }
    };
  }, [...deps, tick, cle]);

  return { data, loading, error, reload };
}
