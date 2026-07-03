import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { api } from '../api/client';
import type { ContratLocal, ContratVue, CreerContrat } from '../types/bff';
import {
  socleContratDurable,
  useCalendrierContrat,
} from './useCalendrierContrat';

const CONTRAT: ContratLocal = {
  id: 'contrat-1',
  foyerId: 'foyer-1',
  enfant: 'enfant-1',
  mode: 'CRECHE_PSU',
  valideDu: '2026-01-01',
  valideAu: '2026-12-31',
  etablissementId: 'etab-1',
};

// Corps de PUT arbitraire : le hook le transmet tel quel à l'API, seul le
// payload (générique) transite par la confirmation.
const CORPS: CreerContrat = {
  mode: 'CRECHE_PSU',
  foyerId: 'foyer-1',
  enfant: 'enfant-1',
  valideDu: '2026-01-01',
  valideAu: '2026-12-31',
  heuresAnnuellesContractualisees: 0,
  nbMensualites: 7,
  semaineType: {},
};

describe('socleContratDurable', () => {
  it('reconduit identité, période et lien établissement du contrat', () => {
    expect(socleContratDurable(CONTRAT)).toEqual({
      foyerId: 'foyer-1',
      enfant: 'enfant-1',
      valideDu: '2026-01-01',
      valideAu: '2026-12-31',
      etablissementId: 'etab-1',
    });
  });

  it('omet le lien établissement quand le contrat n’en porte pas', () => {
    const sansLien = { ...CONTRAT };
    delete sansLien.etablissementId;
    expect(socleContratDurable(sansLien)).toEqual({
      foyerId: 'foyer-1',
      enfant: 'enfant-1',
      valideDu: '2026-01-01',
      valideAu: '2026-12-31',
    });
  });
});

describe('useCalendrierContrat', () => {
  beforeEach(() => {
    // La réhydratation serveur (useSaisieServeur) part dès le montage : on la
    // laisse EN ATTENTE (les tests ci-dessous ne portent pas sur elle) plutôt
    // que de la résoudre hors `act` après la fin du test.
    vi.spyOn(api, 'lirePlanning').mockReturnValue(new Promise(() => undefined));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function monter(surcharges: { contrat?: ContratLocal } = {}) {
    const construireCorpsDurable = vi.fn(() => CORPS);
    const reinitialiserSaisie = vi.fn();
    const onContratModifie = vi.fn();
    const rendu = renderHook(() =>
      useCalendrierContrat<string>({
        contrat: surcharges.contrat ?? CONTRAT,
        mois: '2026-06',
        simule: false,
        onEnregistre: vi.fn(),
        onContratModifie,
        construireCorpsDurable,
        reinitialiserSaisie,
      }),
    );
    return {
      ...rendu,
      construireCorpsDurable,
      reinitialiserSaisie,
      onContratModifie,
    };
  }

  it('expose l’état initial : statut idle, portée mois, aucune confirmation ni erreur durable', () => {
    const { result } = monter();
    expect(result.current.etat).toBe('idle');
    expect(result.current.enregistreA).toBeNull();
    expect(result.current.portee).toBe('mois');
    expect(result.current.confirmationDurable).toBeNull();
    expect(result.current.erreurDurable).toBeNull();
  });

  it('estDansPeriode borne sur [valideDu, valideAu]', () => {
    const { result } = monter();
    expect(result.current.estDansPeriode('2025-12-31')).toBe(false);
    expect(result.current.estDansPeriode('2026-01-01')).toBe(true);
    expect(result.current.estDansPeriode('2026-12-31')).toBe(true);
    expect(result.current.estDansPeriode('2027-01-01')).toBe(false);
  });

  it('estDansPeriode sans borne de fin (valideAu null) accepte tout jour ≥ valideDu', () => {
    const { result } = monter({ contrat: { ...CONTRAT, valideAu: null } });
    expect(result.current.estDansPeriode('2030-01-01')).toBe(true);
    expect(result.current.estDansPeriode('2025-12-31')).toBe(false);
  });

  it('demanderConfirmationDurable met la modification en attente, annulerDurable l’abandonne sans PUT', () => {
    const spy = vi.spyOn(api, 'modifierContrat');
    const { result } = monter();

    act(() => {
      result.current.demanderConfirmationDurable('payload', 'Message affiché');
    });
    expect(result.current.confirmationDurable).toEqual({
      payload: 'payload',
      message: 'Message affiché',
    });

    act(() => {
      result.current.annulerDurable();
    });
    expect(result.current.confirmationDurable).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('confirmerDurable applique le PUT (corps construit depuis le payload), réinitialise la saisie et notifie', async () => {
    const spy = vi
      .spyOn(api, 'modifierContrat')
      .mockResolvedValue({} as ContratVue);
    const {
      result,
      construireCorpsDurable,
      reinitialiserSaisie,
      onContratModifie,
    } = monter();

    act(() => {
      result.current.demanderConfirmationDurable('payload', 'msg');
    });
    act(() => {
      result.current.confirmerDurable();
    });

    expect(construireCorpsDurable).toHaveBeenCalledWith('payload');
    expect(spy).toHaveBeenCalledWith('contrat-1', CORPS);
    expect(result.current.confirmationDurable).toBeNull();

    await waitFor(() => {
      expect(reinitialiserSaisie).toHaveBeenCalledTimes(1);
    });
    expect(onContratModifie).toHaveBeenCalledTimes(1);
    expect(result.current.erreurDurable).toBeNull();
    // AQ-05 : la réinitialisation est annoncée aux lecteurs d'écran.
    expect(result.current.regionLiveProps.children).toContain(
      'Contrat modifié, saisies du mois réinitialisées',
    );
  });

  it('échec du PUT : erreurDurable exposée, saisie locale intacte, pas de notification', async () => {
    vi.spyOn(api, 'modifierContrat').mockRejectedValue(
      new Error('panne ciblée'),
    );
    const { result, reinitialiserSaisie, onContratModifie } = monter();

    act(() => {
      result.current.demanderConfirmationDurable('payload', 'msg');
    });
    act(() => {
      result.current.confirmerDurable();
    });

    await waitFor(() => {
      expect(result.current.erreurDurable).toBe('panne ciblée');
    });
    expect(reinitialiserSaisie).not.toHaveBeenCalled();
    expect(onContratModifie).not.toHaveBeenCalled();
  });

  it('confirmerDurable sans confirmation en attente ne déclenche aucun PUT', () => {
    const spy = vi.spyOn(api, 'modifierContrat');
    const { result } = monter();
    act(() => {
      result.current.confirmerDurable();
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
