import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAsync, invaliderCacheAsync } from './useAsync';

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

/**
 * **L'invalidation ciblée — la moitié du lot 5 qu'on ne voit pas.**
 *
 * `reload()` n'invalide que l'instance qui l'appelle. Il suffit tant que la
 * mutation et la lecture vivent dans le même écran ; le calendrier d'ouverture
 * rompt cette hypothèse (on le retouche dans « Calendrier », on le lit dans le
 * planning, jamais montés ensemble). Sans invalidation par préfixe, une fermeture
 * posée resterait saisissable jusqu'au prochain rechargement complet — un défaut
 * que rien ne signale.
 */
describe('invaliderCacheAsync', () => {
  it('écarte les entrées du préfixe, et rend leur compte', async () => {
    const fn = vi.fn(() => Promise.resolve('v1'));
    const a = renderHook(() =>
      useAsync(fn, [], { cle: 'calendrier:etab-1:2026-11-01:2026-11-30' }),
    );
    await waitFor(() => expect(a.result.current.data).toBe('v1'));
    const b = renderHook(() =>
      useAsync(fn, [], { cle: 'calendrier:etab-1:2026-12-01:2026-12-31' }),
    );
    await waitFor(() => expect(b.result.current.data).toBe('v1'));

    // Une retouche périme TOUS les mois déjà chargés de cet établissement.
    expect(invaliderCacheAsync('calendrier:etab-1:')).toBe(2);
  });

  it('ne touche pas les clés d’un AUTRE établissement — la contre-épreuve', async () => {
    const fn = vi.fn(() => Promise.resolve('v1'));
    const autre = renderHook(() =>
      useAsync(fn, [], { cle: 'calendrier:etab-2:2026-11-01:2026-11-30' }),
    );
    await waitFor(() => expect(autre.result.current.data).toBe('v1'));

    // Sans cette épreuve, une invalidation qui viderait tout passerait le test
    // ci-dessus pour la mauvaise raison.
    expect(invaliderCacheAsync('calendrier:etab-1:')).toBe(0);

    const rappel = vi.fn(() => Promise.resolve('v2'));
    const remonte = renderHook(() =>
      useAsync(rappel, [], { cle: 'calendrier:etab-2:2026-11-01:2026-11-30' }),
    );
    // Toujours en cache : servi sans requête, dès le premier rendu.
    expect(remonte.result.current.data).toBe('v1');
    expect(rappel).not.toHaveBeenCalled();
  });

  it('force une vraie relecture après invalidation', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('avant')
      .mockResolvedValueOnce('après');
    const premier = renderHook(() =>
      useAsync(fn, [], { cle: 'calendrier:etab-3:2026-11-01:2026-11-30' }),
    );
    await waitFor(() => expect(premier.result.current.data).toBe('avant'));
    premier.unmount();

    invaliderCacheAsync('calendrier:etab-3:');

    const second = renderHook(() =>
      useAsync(fn, [], { cle: 'calendrier:etab-3:2026-11-01:2026-11-30' }),
    );
    await waitFor(() => expect(second.result.current.data).toBe('après'));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
