import { useCallback, useEffect, useState } from 'react';
import { messageErreur } from '../utils/erreurs';

// Hook de chargement asynchrone générique : annule la requête au démontage /
// changement de dépendances (AbortController) et expose un reload().
export interface AsyncEtat<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useAsync<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown>,
): AsyncEtat<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fn(ctrl.signal)
      .then((d) => {
        if (ctrl.signal.aborted) return;
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(messageErreur(e));
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [...deps, tick]);

  return { data, loading, error, reload };
}
