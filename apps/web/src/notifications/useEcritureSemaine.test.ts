import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { api } from '../api/client';
import { useEcritureSemaine } from './useEcritureSemaine';

// Jumeau de usePlanning.test : timers factices + horloge figée pour un
// horodatage déterministe (« Enregistré à hh:mm », pas de flake).
describe('useEcritureSemaine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 3, 8, 5));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('écrit après le debounce puis PERSISTE « enregistré » avec son heure', async () => {
    const spy = vi
      .spyOn(api, 'ecrireSemaineBesoins')
      .mockResolvedValue(undefined);
    const onEnregistre = vi.fn();
    const { result } = renderHook(() => useEcritureSemaine(onEnregistre));

    act(() => {
      result.current.ecrire('c-1', '2026-W27', {});
    });
    expect(result.current.etat).toBe('en-cours');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.current.etat).toBe('enregistre');
    expect(result.current.enregistreA).toBe('08:05');
    expect(onEnregistre).toHaveBeenCalledTimes(1);

    // Plus de retour à « idle » : l'état reste lisible (UX lot 3).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current.etat).toBe('enregistre');
  });

  it('échec : état « erreur », puis « réessayer » rejoue la même écriture', async () => {
    const spy = vi
      .spyOn(api, 'ecrireSemaineBesoins')
      .mockRejectedValueOnce(new Error('panne ciblée'))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useEcritureSemaine(vi.fn()));

    act(() => {
      result.current.ecrire('c-1', '2026-W27', { absences: [] });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(result.current.etat).toBe('erreur');
    expect(result.current.erreur).toBe('panne ciblée');

    act(() => {
      result.current.reessayer();
    });
    expect(result.current.etat).toBe('en-cours');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(result.current.etat).toBe('enregistre');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]?.slice(0, 3)).toEqual([
      'c-1',
      '2026-W27',
      { absences: [] },
    ]);
  });
});
