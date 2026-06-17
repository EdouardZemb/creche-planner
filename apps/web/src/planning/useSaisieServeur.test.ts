import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { api } from '../api/client';
import type { EcrirePlanning, LirePlanningReponse } from '../types/bff';
import { useSaisieServeur } from './useSaisieServeur';

// Saisie riche : plages horaires, jour supplémentaire daté, absence datée,
// exceptions ABCM. Sert au test de round-trip exact (le hook doit restituer
// la saisie serveur telle quelle, sans transformation).
const SAISIE_RICHE: EcrirePlanning = {
  complementMinutes: 90,
  joursSupplementaires: [
    {
      date: '2026-03-12',
      debutHeures: 8,
      debutMinutes: 30,
      finHeures: 17,
      finMinutes: 0,
    },
  ],
  absences: [
    {
      date: '2026-03-20',
      debutHeures: 9,
      debutMinutes: 0,
      finHeures: 18,
      finMinutes: 0,
      preavisJours: 7,
      certificatMaladie: true,
    },
  ],
  exceptions: [{ date: '2026-03-25', cantine: true, periSoir: false }],
};

/** Promesse contrôlable : on déclenche resolve/reject à la main pour ordonner
 *  finement les courses (édition pendant chargement, abort, etc.). */
function differe<T>() {
  let resoudre!: (v: T) => void;
  let rejeter!: (e: unknown) => void;
  const promesse = new Promise<T>((res, rej) => {
    resoudre = res;
    rejeter = rej;
  });
  return { promesse, resoudre, rejeter };
}

describe('useSaisieServeur', () => {
  let spy: MockInstance<typeof api.lirePlanning>;

  beforeEach(() => {
    spy = vi.spyOn(api, 'lirePlanning');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('état initial : saisie null, chargee false (avant toute réponse serveur)', () => {
    // lirePlanning reste en attente : on observe l'état avant résolution.
    spy.mockReturnValue(differe<LirePlanningReponse>().promesse);
    const { result } = renderHook(() =>
      useSaisieServeur('c1', '2026-03', false),
    );
    expect(result.current).toEqual({ saisie: null, chargee: false });
  });

  it('appelle lirePlanning avec (contratId, mois, simule) et un signal', () => {
    spy.mockReturnValue(differe<LirePlanningReponse>().promesse);
    renderHook(() => useSaisieServeur('c42', '2026-09', true));
    expect(spy).toHaveBeenCalledTimes(1);
    const [contratId, mois, simule, opts] = spy.mock.calls[0]!;
    expect(contratId).toBe('c42');
    expect(mois).toBe('2026-09');
    expect(simule).toBe(true);
    expect((opts as { signal?: AbortSignal }).signal).toBeInstanceOf(
      AbortSignal,
    );
  });

  it('succès : round-trip exact de la saisie reçue (chargee passe à true)', async () => {
    spy.mockResolvedValue({ saisie: SAISIE_RICHE });
    const { result } = renderHook(() =>
      useSaisieServeur('c1', '2026-03', false),
    );

    await waitFor(() => expect(result.current.chargee).toBe(true));
    // Restitution à l'identique (référence préservée, aucune transformation).
    expect(result.current.saisie).toBe(SAISIE_RICHE);
    expect(result.current.saisie).toEqual(SAISIE_RICHE);
  });

  it('serveur null : { saisie: null, chargee: true } — le hook ne fabrique PAS de fausse saisie', async () => {
    // Contrat : quand le serveur ne connaît pas ce (contrat, mois), il renvoie
    // saisie:null. Le hook se contente de remonter null + chargee:true ; il ne
    // bloque pas et n'invente pas de saisie. C'est l'APPELANT (calendrier) qui,
    // voyant saisie:null, conserve son brouillon local (sessionStorage).
    spy.mockResolvedValue({ saisie: null });
    const { result } = renderHook(() =>
      useSaisieServeur('c1', '2026-03', false),
    );

    await waitFor(() => expect(result.current.chargee).toBe(true));
    expect(result.current.saisie).toBeNull();
  });

  it('erreur réseau : { saisie: null, chargee: true } — pas de crash', async () => {
    spy.mockRejectedValue(new Error('réseau indisponible'));
    const { result } = renderHook(() =>
      useSaisieServeur('c1', '2026-03', false),
    );

    await waitFor(() => expect(result.current.chargee).toBe(true));
    expect(result.current.saisie).toBeNull();
  });

  it('abort au démontage : une réponse arrivée APRÈS démontage ne met pas à jour l’état (ni warning)', async () => {
    const d = differe<LirePlanningReponse>();
    spy.mockReturnValue(d.promesse);
    const erreurConsole = vi.spyOn(console, 'error');

    const { result, unmount } = renderHook(() =>
      useSaisieServeur('c1', '2026-03', false),
    );
    expect(result.current.chargee).toBe(false);

    unmount();
    // Réponse périmée après démontage : court-circuitée par ctrl.signal.aborted.
    await act(async () => {
      d.resoudre({ saisie: SAISIE_RICHE });
    });

    expect(result.current.chargee).toBe(false);
    expect(result.current.saisie).toBeNull();
    // Pas de "Can't perform a React state update on an unmounted component".
    expect(erreurConsole).not.toHaveBeenCalled();
  });

  it('course édition-pendant-chargement : la réponse périmée des anciens params n’écrase pas le nouvel état', async () => {
    const ancienne = differe<LirePlanningReponse>();
    const nouvelle = differe<LirePlanningReponse>();
    spy
      .mockReturnValueOnce(ancienne.promesse)
      .mockReturnValueOnce(nouvelle.promesse);

    const { result, rerender } = renderHook(
      ({ mois }: { mois: string }) => useSaisieServeur('c1', mois, false),
      { initialProps: { mois: '2026-03' } },
    );

    // L'utilisateur change de mois AVANT que la 1re réponse n'arrive.
    rerender({ mois: '2026-04' });
    expect(spy).toHaveBeenCalledTimes(2);

    const saisieAncienne: EcrirePlanning = { complementMinutes: 111 };
    const saisieNouvelle: EcrirePlanning = { complementMinutes: 222 };

    // La réponse PÉRIMÉE (ancien mois) arrive en dernier : elle ne doit PAS
    // gagner. L'effet précédent a été nettoyé (ctrl.abort) → signal.aborted.
    await act(async () => {
      nouvelle.resoudre({ saisie: saisieNouvelle });
      ancienne.resoudre({ saisie: saisieAncienne });
    });

    await waitFor(() => expect(result.current.chargee).toBe(true));
    expect(result.current.saisie).toBe(saisieNouvelle);
  });

  it('reset au changement de params : chargee repasse à false puis true après la nouvelle réponse', async () => {
    spy.mockResolvedValueOnce({ saisie: { complementMinutes: 1 } });
    const { result, rerender } = renderHook(
      ({ mois }: { mois: string }) => useSaisieServeur('c1', mois, false),
      { initialProps: { mois: '2026-03' } },
    );
    await waitFor(() => expect(result.current.chargee).toBe(true));
    expect(result.current.saisie).toEqual({ complementMinutes: 1 });

    // Nouvelle réponse contrôlée pour observer l'état intermédiaire chargee:false.
    const d = differe<LirePlanningReponse>();
    spy.mockReturnValueOnce(d.promesse);

    act(() => {
      rerender({ mois: '2026-04' });
    });
    // Juste après le changement de params : remis à zéro, pas encore rechargé.
    expect(result.current.chargee).toBe(false);
    expect(result.current.saisie).toBeNull();

    await act(async () => {
      d.resoudre({ saisie: { complementMinutes: 2 } });
    });
    await waitFor(() => expect(result.current.chargee).toBe(true));
    expect(result.current.saisie).toEqual({ complementMinutes: 2 });
  });
});
