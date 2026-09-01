import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  UnitesAssociativesPage,
  formaterHeures,
  phraseEcheance,
} from './UnitesAssociativesPage';
import type { SuiviUaVue } from '../types/bff';

// `ApiError` est REDÉCLARÉE dans le double : `utils/erreurs` en fait un
// `instanceof`, et un module mocké qui ne l'exporte pas rend l'opérande droit
// `undefined` — le `catch` lève alors lui-même, et l'écran n'affiche rien.
vi.mock('../api/client', () => ({
  api: {
    lireSuiviUnitesAssociatives: vi.fn(),
    declarerEngagementUa: vi.fn(),
    ajouterSessionUa: vi.fn(),
    modifierSessionUa: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    corps: unknown;
    constructor(status: number, corps: unknown) {
      super(`HTTP ${status}`);
      this.name = 'ApiError';
      this.status = status;
      this.corps = corps;
    }
  },
}));

import { api } from '../api/client';

const FOYER = 'foyer-1';

function suivi(surcharge: Partial<SuiviUaVue> = {}): SuiviUaVue {
  return {
    foyerId: FOYER,
    aujourdhui: '2026-10-01',
    engagement: {
      id: 'eng-1',
      foyerId: FOYER,
      debut: '2026-06-01',
      fin: '2027-05-31',
      quotaHeures: 20,
      valeurUaCentimes: 3125,
      cautionCentimes: 62500,
    },
    compteurs: {
      quotaHeures: 20,
      heuresRealisees: 6,
      heuresReservees: 3,
      heuresAConfirmer: 0,
      heuresRestantes: 11,
      quotaAtteint: false,
      joursAvantEcheance: 242,
      coutSiArret: { montantCentimes: 43750, hypothese: 'SI_TU_TARRETES_LA' },
      coutSiReservationsRealisees: {
        montantCentimes: 34375,
        hypothese: 'SI_TU_REALISES_TES_RESERVATIONS',
      },
      alerteEcheance: false,
    },
    sessions: [
      {
        id: 's-1',
        engagementId: 'eng-1',
        date: '2026-11-07',
        dureeHeures: 3,
        type: 'MENAGE',
        realisePar: 'Camille',
        etablissementId: null,
        etat: 'PREVUE',
        aConfirmer: false,
      },
    ],
    seuilAlerteJours: 56,
    ...surcharge,
  } as SuiviUaVue;
}

/**
 * Compteurs et première session du jeu de référence, **dénullifiés une fois** :
 * `suivi()` les type `| null` (l'API rend `null` quand aucune période n'est
 * déclarée), et les affirmer à chaque usage sèmerait des `!` dans tout le fichier.
 */
const COMPTEURS = suivi().compteurs as NonNullable<SuiviUaVue['compteurs']>;
const PREMIERE_SESSION = suivi().sessions[0] as SuiviUaVue['sessions'][number];

function rendre() {
  return render(
    <MemoryRouter initialEntries={[`/foyers/${FOYER}/unites-associatives`]}>
      <Routes>
        <Route
          path="/foyers/:foyerId/unites-associatives"
          element={<UnitesAssociativesPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('UnitesAssociativesPage · les trois compteurs (US-40-04)', () => {
  beforeEach(() => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockReset();
    vi.mocked(api.modifierSessionUa).mockReset();
    vi.mocked(api.ajouterSessionUa).mockReset();
    vi.mocked(api.declarerEngagementUa).mockReset();
  });

  it('affiche réalisé, réservé et restant DISTINCTEMENT, avec leur définition', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(suivi());
    rendre();

    await screen.findByRole('heading', { name: 'Où j’en suis' });
    // Trois compteurs nommés, trois valeurs différentes : les confondre est la
    // première erreur d'écran possible (SFD 40 §3.1).
    expect(screen.getByRole('heading', { name: 'Réalisé' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Réservé' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Restant' })).toBeTruthy();
    expect(screen.getByText('6 h')).toBeTruthy();
    expect(screen.getByText('3 h')).toBeTruthy();
    expect(screen.getByText('11 h')).toBeTruthy();
    expect(
      screen.getByText(/Seul compteur qui solde l’obligation/),
    ).toBeTruthy();
  });

  it('affiche chaque coût projeté AVEC son hypothèse (RM-40-05)', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(suivi());
    rendre();

    await screen.findByText('437,50 €');
    expect(screen.getByText('si tu t’arrêtes là')).toBeTruthy();
    expect(screen.getByText('343,75 €')).toBeTruthy();
    expect(
      screen.getByText('si tu réalises tes créneaux déjà réservés'),
    ).toBeTruthy();
  });

  it('dit « caution rendue, 0 € » quand le quota est atteint (CA3)', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(
      suivi({
        compteurs: {
          ...COMPTEURS,
          heuresRealisees: 20,
          heuresRestantes: 0,
          quotaAtteint: true,
          coutSiArret: { montantCentimes: 0, hypothese: 'SI_TU_TARRETES_LA' },
        },
      }),
    );
    rendre();

    // Le SENS métier, pas un zéro nu.
    expect(await screen.findByTestId('quota-atteint-ua')).toBeTruthy();
    expect(screen.getByText(/caution rendue/)).toBeTruthy();
    expect(screen.queryByText('si tu t’arrêtes là')).toBeNull();
  });

  it('signale les heures « à confirmer » sans les compter comme faites (RM-40-06)', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(
      suivi({
        compteurs: { ...COMPTEURS, heuresAConfirmer: 4 },
        sessions: [
          {
            ...PREMIERE_SESSION,
            date: '2026-09-12',
            aConfirmer: true,
          },
        ],
      }),
    );
    rendre();

    expect(await screen.findByTestId('a-confirmer-ua')).toBeTruthy();
    expect(screen.getByText('À confirmer')).toBeTruthy();
  });

  it('affiche l’échéance et l’alerte quand elle approche (US-40-05 CA1)', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(
      suivi({
        compteurs: {
          ...COMPTEURS,
          joursAvantEcheance: 30,
          alerteEcheance: true,
        },
      }),
    );
    rendre();

    expect((await screen.findByTestId('echeance-ua')).textContent).toContain(
      'dans 30 jours',
    );
    expect(screen.getByTestId('alerte-ua')).toBeTruthy();
  });

  it('n’alerte pas quand l’échéance est lointaine', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(suivi());
    rendre();

    await screen.findByTestId('echeance-ua');
    expect(screen.queryByTestId('alerte-ua')).toBeNull();
  });
});

describe('UnitesAssociativesPage · la frontière (RM-40-01)', () => {
  beforeEach(() => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockReset();
  });

  it('écrit à l’écran que Martha ne réserve rien', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(suivi());
    rendre();

    const mention = await screen.findByTestId('frontiere-site-travaux');
    expect(mention.textContent).toContain('Martha ne réserve aucun créneau');
    expect(mention.textContent).toContain('site travaux');
  });
});

describe('UnitesAssociativesPage · gestes', () => {
  beforeEach(() => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockReset();
    vi.mocked(api.modifierSessionUa).mockReset();
    vi.mocked(api.declarerEngagementUa).mockReset();
  });

  it('marque une session réalisée et recharge le suivi', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(suivi());
    vi.mocked(api.modifierSessionUa).mockResolvedValue({} as never);
    rendre();

    fireEvent.click(await screen.findByRole('button', { name: 'C’est fait' }));

    await waitFor(() => {
      expect(api.modifierSessionUa).toHaveBeenCalledWith(FOYER, 's-1', {
        etat: 'REALISEE',
      });
    });
  });

  it('annule une session sans la supprimer (la trace du créneau reste)', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(suivi());
    vi.mocked(api.modifierSessionUa).mockResolvedValue({} as never);
    rendre();

    fireEvent.click(await screen.findByRole('button', { name: 'Annulé' }));

    await waitFor(() => {
      expect(api.modifierSessionUa).toHaveBeenCalledWith(FOYER, 's-1', {
        etat: 'ANNULEE',
      });
    });
  });

  it('remonte l’erreur d’une mutation refusée', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(suivi());
    vi.mocked(api.modifierSessionUa).mockRejectedValue(
      new Error('session introuvable'),
    );
    rendre();

    fireEvent.click(await screen.findByRole('button', { name: 'C’est fait' }));

    expect(await screen.findByTestId('erreur-ua')).toBeTruthy();
  });
});

describe('UnitesAssociativesPage · aucune période déclarée', () => {
  beforeEach(() => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockReset();
    vi.mocked(api.declarerEngagementUa).mockReset();
  });

  it('propose la déclaration plutôt que trois zéros trompeurs', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(
      suivi({ engagement: null, compteurs: null, sessions: [] }),
    );
    rendre();

    await screen.findByRole('heading', { name: 'Déclarer la période' });
    expect(screen.queryByRole('heading', { name: 'Réalisé' })).toBeNull();
    // Les valeurs du RI sont PROPOSÉES, pas imposées (RM-40-02).
    expect(screen.getByText(/proposées/)).toBeTruthy();
    expect(
      (screen.getByLabelText(/Quota d’unités associatives/) as HTMLInputElement)
        .value,
    ).toBe('20');
    expect(
      (screen.getByLabelText(/Valeur d’une unité/) as HTMLInputElement).value,
    ).toBe('31.25');
  });

  it('déclare la période avec les valeurs de l’écran, en centimes', async () => {
    vi.mocked(api.lireSuiviUnitesAssociatives).mockResolvedValue(
      suivi({ engagement: null, compteurs: null, sessions: [] }),
    );
    vi.mocked(api.declarerEngagementUa).mockResolvedValue({} as never);
    rendre();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Déclarer cette période' }),
    );

    await waitFor(() => {
      expect(api.declarerEngagementUa).toHaveBeenCalledWith(FOYER, {
        debut: '2026-06-01',
        fin: '2027-05-31',
        quotaHeures: 20,
        valeurUaCentimes: 3125,
        cautionCentimes: 62500,
      });
    });
  });
});

describe('formaterHeures', () => {
  it('rend des heures entières sans décimale parasite', () => {
    expect(formaterHeures(20)).toBe('20 h');
    expect(formaterHeures(0)).toBe('0 h');
  });

  it('rend les demi-heures en minutes, pas en « 2.5 »', () => {
    expect(formaterHeures(2.5)).toBe('2 h 30');
    expect(formaterHeures(1.25)).toBe('1 h 15');
  });
});

describe('phraseEcheance', () => {
  it('dit la date ET le compte à rebours', () => {
    expect(phraseEcheance(30, '2027-05-31')).toBe(
      'Échéance le 31 mai 2027, dans 30 jours',
    );
  });

  it('accorde le singulier', () => {
    expect(phraseEcheance(1, '2027-05-31')).toContain('dans 1 jour');
  });

  it('dit « aujourd’hui » plutôt que « dans 0 jour »', () => {
    expect(phraseEcheance(0, '2027-05-31')).toContain('aujourd’hui');
  });

  it('dit qu’elle est dépassée plutôt que d’afficher un nombre négatif', () => {
    expect(phraseEcheance(-10, '2027-05-31')).toBe(
      'Échéance dépassée depuis le 31 mai 2027',
    );
  });
});
