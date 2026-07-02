import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAsync } from './useAsync';

// Le cache module-level est purgé entre les tests par `src/test-setup.ts`
// (viderCacheAsync) — chaque test part d'un cache vide.

/** Promesse contrôlable, pour ordonner finement les courses (abort, dédup). */
function differe<T>() {
  let resoudre!: (v: T) => void;
  let rejeter!: (e: unknown) => void;
  const promesse = new Promise<T>((res, rej) => {
    resoudre = res;
    rejeter = rej;
  });
  return { promesse, resoudre, rejeter };
}

describe('useAsync — sans clé (comportement historique)', () => {
  it('charge au montage et expose la donnée', async () => {
    const fn = vi.fn(() => Promise.resolve('valeur'));
    const { result } = renderHook(() => useAsync(fn, []));
    expect(result.current.loading).toBe(true);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data).toBe('valeur');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reload() relance la requête', async () => {
    const fn = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockResolvedValueOnce('v1')
      .mockResolvedValueOnce('v2');
    const { result } = renderHook(() => useAsync(fn, []));
    await waitFor(() => {
      expect(result.current.data).toBe('v1');
    });

    act(() => {
      result.current.reload();
    });
    await waitFor(() => {
      expect(result.current.data).toBe('v2');
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('annule la requête au démontage (AbortController)', () => {
    const d = differe<string>();
    let signalVu: AbortSignal | undefined;
    const fn = vi.fn((signal: AbortSignal) => {
      signalVu = signal;
      return d.promesse;
    });
    const { unmount } = renderHook(() => useAsync(fn, []));
    expect(signalVu?.aborted).toBe(false);
    unmount();
    expect(signalVu?.aborted).toBe(true);
  });

  it('expose le message en cas d’échec', async () => {
    const fn = vi.fn(() => Promise.reject(new Error('panne ciblée')));
    const { result } = renderHook(() => useAsync(fn, []));
    await waitFor(() => {
      expect(result.current.error).toBe('panne ciblée');
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });
});

describe('useAsync — cache par clé', () => {
  it('sert le cache au remontage sans nouvelle requête (dès le premier rendu)', async () => {
    const fn = vi.fn(() => Promise.resolve('valeur'));
    const premier = renderHook(() =>
      useAsync(fn, ['f1'], { cle: 'contrats:f1' }),
    );
    await waitFor(() => {
      expect(premier.result.current.data).toBe('valeur');
    });
    premier.unmount();

    // Remontage (navigation retour) : aucune requête, donnée disponible
    // immédiatement — pas d'état de chargement intermédiaire.
    const second = renderHook(() =>
      useAsync(fn, ['f1'], { cle: 'contrats:f1' }),
    );
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.data).toBe('valeur');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ne mélange pas deux clés différentes', async () => {
    const fn1 = vi.fn(() => Promise.resolve('foyer 1'));
    const fn2 = vi.fn(() => Promise.resolve('foyer 2'));
    const h1 = renderHook(() => useAsync(fn1, ['f1'], { cle: 'contrats:f1' }));
    const h2 = renderHook(() => useAsync(fn2, ['f2'], { cle: 'contrats:f2' }));
    await waitFor(() => {
      expect(h1.result.current.data).toBe('foyer 1');
      expect(h2.result.current.data).toBe('foyer 2');
    });
  });

  it('déduplique les requêtes en vol : deux montages simultanés, une seule requête', async () => {
    const d = differe<string>();
    const fn = vi.fn(() => d.promesse);
    const h1 = renderHook(() => useAsync(fn, [], { cle: 'partagee' }));
    const h2 = renderHook(() => useAsync(fn, [], { cle: 'partagee' }));
    expect(fn).toHaveBeenCalledTimes(1);

    await act(async () => {
      d.resoudre('valeur partagée');
    });
    await waitFor(() => {
      expect(h1.result.current.data).toBe('valeur partagée');
      expect(h2.result.current.data).toBe('valeur partagée');
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reload() invalide l’entrée : nouvelle requête, et le cache repart de la nouvelle valeur', async () => {
    const fn = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockResolvedValueOnce('avant mutation')
      .mockResolvedValueOnce('après mutation');
    const { result, unmount } = renderHook(() =>
      useAsync(fn, [], { cle: 'liste' }),
    );
    await waitFor(() => {
      expect(result.current.data).toBe('avant mutation');
    });

    // Mutation côté appelant, puis recharger() (= reload) : refetch forcé.
    act(() => {
      result.current.reload();
    });
    await waitFor(() => {
      expect(result.current.data).toBe('après mutation');
    });
    expect(fn).toHaveBeenCalledTimes(2);
    unmount();

    // Le cache contient bien la valeur post-mutation : remontage sans requête.
    const second = renderHook(() => useAsync(fn, [], { cle: 'liste' }));
    expect(second.result.current.data).toBe('après mutation');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('n’annule la requête partagée qu’au démontage du DERNIER abonné', async () => {
    const d = differe<string>();
    let signalVu: AbortSignal | undefined;
    const fn = vi.fn((signal: AbortSignal) => {
      signalVu = signal;
      return d.promesse;
    });
    const h1 = renderHook(() => useAsync(fn, [], { cle: 'partagee' }));
    const h2 = renderHook(() => useAsync(fn, [], { cle: 'partagee' }));

    // Premier départ : l'autre abonné attend toujours → pas d'annulation.
    h1.unmount();
    expect(signalVu?.aborted).toBe(false);

    // Dernier départ pendant le vol : plus personne n'attend → annulation.
    h2.unmount();
    expect(signalVu?.aborted).toBe(true);
  });

  it('une requête résolue n’est pas annulée par le démontage (le cache reste servable)', async () => {
    const fn = vi.fn(() => Promise.resolve('valeur'));
    const premier = renderHook(() => useAsync(fn, [], { cle: 'resolue' }));
    await waitFor(() => {
      expect(premier.result.current.data).toBe('valeur');
    });
    premier.unmount();

    const second = renderHook(() => useAsync(fn, [], { cle: 'resolue' }));
    expect(second.result.current.data).toBe('valeur');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ne met pas une erreur en cache : le montage suivant retente la requête', async () => {
    const fn = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(new Error('panne passagère'))
      .mockResolvedValueOnce('rétabli');
    const premier = renderHook(() => useAsync(fn, [], { cle: 'fragile' }));
    await waitFor(() => {
      expect(premier.result.current.error).toBe('panne passagère');
    });
    premier.unmount();

    const second = renderHook(() => useAsync(fn, [], { cle: 'fragile' }));
    expect(second.result.current.loading).toBe(true);
    await waitFor(() => {
      expect(second.result.current.data).toBe('rétabli');
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
