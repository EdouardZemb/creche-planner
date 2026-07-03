import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { api } from '../api/client';
import { usePlanning } from './usePlanning';

// Timers factices + horloge figée : le debounce (800 ms) est avancé à la main
// et l'horodatage « Enregistré à hh:mm » devient déterministe (pas de flake).
describe('usePlanning', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 3, 21, 43));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('écrit après le debounce puis PERSISTE « enregistré » avec son heure', async () => {
    const spy = vi.spyOn(api, 'ecrirePlanning').mockResolvedValue(undefined);
    const onEnregistre = vi.fn();
    const { result } = renderHook(() => usePlanning(onEnregistre));

    expect(result.current.etat).toBe('idle');
    expect(result.current.enregistreA).toBeNull();

    act(() => {
      result.current.ecrire('c-1', '2026-07', false, {});
    });
    // Le statut couvre le trou debounce → réponse : « en-cours » dès l'appel.
    expect(result.current.etat).toBe('en-cours');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.current.etat).toBe('enregistre');
    expect(result.current.enregistreA).toBe('21:43');
    expect(onEnregistre).toHaveBeenCalledTimes(1);

    // Plus de retour à « idle » : l'état reste lisible (UX lot 3).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current.etat).toBe('enregistre');
  });

  it('coalesce des saisies rapprochées : une seule écriture, statut stable', async () => {
    const spy = vi.spyOn(api, 'ecrirePlanning').mockResolvedValue(undefined);
    const { result } = renderHook(() => usePlanning(vi.fn()));

    act(() => {
      result.current.ecrire('c-1', '2026-07', false, {});
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    act(() => {
      result.current.ecrire('c-1', '2026-07', false, {});
    });
    expect(result.current.etat).toBe('en-cours');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.current.etat).toBe('enregistre');
  });

  it('échec : état « erreur », puis « réessayer » rejoue la même écriture', async () => {
    const spy = vi
      .spyOn(api, 'ecrirePlanning')
      .mockRejectedValueOnce(new Error('panne ciblée'))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => usePlanning(vi.fn()));

    act(() => {
      result.current.ecrire('c-1', '2026-07', false, { complementMinutes: 30 });
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
    expect(spy.mock.calls[1]?.slice(0, 4)).toEqual([
      'c-1',
      '2026-07',
      false,
      { complementMinutes: 30 },
    ]);
  });

  it('réessayer sans écriture préalable est un no-op', () => {
    const spy = vi.spyOn(api, 'ecrirePlanning');
    const { result } = renderHook(() => usePlanning(vi.fn()));
    act(() => {
      result.current.reessayer();
    });
    expect(result.current.etat).toBe('idle');
    expect(spy).not.toHaveBeenCalled();
  });
});
