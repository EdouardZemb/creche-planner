import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { jourCourantParis } from '@creche-planner/shared-semaine';
import { DashboardJourPage } from './DashboardJourPage';
import type {
  PlageHoraire,
  SemaineBesoins,
  SemaineTypeCreche,
} from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    lireSemaineBesoins: vi.fn(),
  },
  // `messageErreur` (utils/erreurs) teste `e instanceof ApiError` : le mock doit
  // exposer la classe, sinon le chemin d'erreur lève « No ApiError export ».
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

const FOYER_ID = 'foyer-1';

// Semaine-type couvrant les 7 jours : quel que soit le jour réel du run, le
// contrat est « gardé » aujourd'hui (le test ne dépend pas du calendrier).
const PLAGE: PlageHoraire = {
  debutHeures: 8,
  debutMinutes: 30,
  finHeures: 17,
  finMinutes: 0,
};
const SEMAINE_TYPE: SemaineTypeCreche = {
  LUNDI: [PLAGE],
  MARDI: [PLAGE],
  MERCREDI: [PLAGE],
  JEUDI: [PLAGE],
  VENDREDI: [PLAGE],
  SAMEDI: [PLAGE],
  DIMANCHE: [PLAGE],
};

const semaineAvecGarde: SemaineBesoins = {
  semaineIso: '2026-W27',
  jours: [],
  etablissements: [
    { etablissementId: 'e1', libelle: 'Crèche du parc', preavisRegle: null },
  ],
  contrats: [
    {
      contratId: 'c1',
      enfant: 'Léa',
      mode: 'CRECHE_PSU',
      etablissementId: 'e1',
      besoins: {},
      semaineType: SEMAINE_TYPE,
    },
  ],
};

const semaineVide: SemaineBesoins = {
  semaineIso: '2026-W27',
  jours: [],
  etablissements: [],
  contrats: [],
};

function renderPage(foyerId = FOYER_ID) {
  return render(
    <MemoryRouter initialEntries={[`/foyers/${foyerId}/dashboard`]}>
      <Routes>
        <Route
          path="/foyers/:foyerId/dashboard"
          element={<DashboardJourPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DashboardJourPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('affiche le chargement initialement', () => {
    vi.mocked(api.lireSemaineBesoins).mockReturnValue(
      new Promise(() => undefined),
    );

    renderPage();

    expect(
      screen.getByText(/Chargement de votre journée/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: /Aujourd/i }),
    ).toBeInTheDocument();
  });

  it('liste les gardes du jour avec un lien « Modifier » deep-linké vers le contrat (P3a)', async () => {
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(semaineAvecGarde);

    renderPage();

    await screen.findByText('Léa');
    expect(
      screen.getByText('Crèche du parc', { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Gardé/)).toBeInTheDocument();

    // P3a : « Modifier » ouvre le planning directement sur l'onglet enfant + le
    // sous-onglet mode de cette garde, au mois du jour affiché (params lus par
    // PlanningPage), au lieu du planning générique.
    const lien = screen.getByRole('link', {
      name: /Modifier la garde de Léa/i,
    });
    const url = new URL(lien.getAttribute('href')!, 'http://x');
    expect(url.pathname).toBe(`/foyers/${FOYER_ID}/planning`);
    expect(url.searchParams.get('enfant')).toBe('Léa');
    expect(url.searchParams.get('mode')).toBe('CRECHE_PSU');
    expect(url.searchParams.get('mois')).toBe(
      jourCourantParis(new Date()).slice(0, 7),
    );
    // Le titre d'onglet reflète la page (EX-05).
    expect(document.title).toMatch(/Aujourd/);
  });

  it('état vide : « Aucune garde prévue » + lien vers le planning', async () => {
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(semaineVide);

    renderPage();

    expect(await screen.findByText(/Aucune garde prévue/i)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Voir le planning/i }),
    ).toHaveAttribute('href', `/foyers/${FOYER_ID}/planning`);
  });

  it('erreur : message + bouton « Réessayer »', async () => {
    vi.mocked(api.lireSemaineBesoins).mockRejectedValue(new Error('panne'));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('panne')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: /Réessayer/i }),
    ).toBeInTheDocument();
  });
});
