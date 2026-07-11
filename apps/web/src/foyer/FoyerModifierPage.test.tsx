import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { FoyerModifierPage } from './FoyerModifierPage';
import type { DossierFoyerVue } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    lireFoyer: vi.fn(),
    modifierFoyer: vi.fn(),
    // Chargé par `useContrats` (avertissement de suppression d'enfant).
    listerContrats: vi.fn(() => Promise.resolve([])),
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

import { api, ApiError } from '../api/client';

const mockedApi = api as unknown as {
  lireFoyer: ReturnType<typeof vi.fn>;
  modifierFoyer: ReturnType<typeof vi.fn>;
  listerContrats: ReturnType<typeof vi.fn>;
};

const FOYER_ID = 'foyer-123';

const dossierFactice: DossierFoyerVue = {
  foyer: {
    id: FOYER_ID,
    ressourcesMensuellesCentimes: 671692,
    ressourcesMensuellesEuros: 6716.92,
    rfrCentimes: 7270500,
    rfrEuros: 72705,
    nbEnfantsACharge: 2,
    nbParts: 2.5,
    tranche: 2,
  },
  enfants: [],
  parents: [],
};

function rendu() {
  return render(
    <MemoryRouter initialEntries={[`/foyers/${FOYER_ID}/modifier`]}>
      <Routes>
        <Route
          path="/foyers/:foyerId/modifier"
          element={<FoyerModifierPage />}
        />
        <Route
          path="/foyers/:foyerId/planning"
          element={<div>PAGE_PLANNING</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('FoyerModifierPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.lireFoyer.mockResolvedValue(dossierFactice);
  });

  it('pré-remplit le formulaire avec les valeurs (euros) du foyer', async () => {
    rendu();

    expect(
      await screen.findByRole('heading', { name: 'Ma famille' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Ressources mensuelles/i)).toHaveValue(
      6716.92,
    );
    expect(screen.getByLabelText(/Revenu fiscal/i)).toHaveValue(72705);
    expect(screen.getByLabelText(/enfants à charge/i)).toHaveValue(2);
    expect(screen.getByLabelText(/parts fiscales/i)).toHaveValue(2.5);
  });

  it('enregistre les scalaires (euros), reste sur la page et affiche le statut', async () => {
    mockedApi.modifierFoyer.mockResolvedValueOnce(dossierFactice.foyer);
    rendu();

    const champ = await screen.findByLabelText(/Ressources mensuelles/i);
    fireEvent.change(champ, { target: { value: '7000' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Enregistrer les modifications' }),
    );

    await waitFor(() => {
      expect(mockedApi.modifierFoyer).toHaveBeenCalledTimes(1);
    });
    const appel = mockedApi.modifierFoyer.mock.calls[0] as unknown[];
    expect(appel[0]).toBe(FOYER_ID);
    expect(appel[1]).toEqual({
      ressourcesMensuelles: 7000,
      rfr: 72705,
      nbEnfantsACharge: 2,
      nbParts: 2.5,
    });

    // Aucune redirection : on reste sur la page et un statut « Enregistré à … »
    // confirme l'écriture.
    expect(await screen.findByText(/Enregistré à/)).toBeInTheDocument();
    expect(screen.queryByText('PAGE_PLANNING')).not.toBeInTheDocument();
  });

  it('« Rétablir » restaure les dernières valeurs enregistrées et reste sur la page', async () => {
    mockedApi.modifierFoyer.mockResolvedValueOnce(dossierFactice.foyer);
    rendu();

    const champ = await screen.findByLabelText(/Ressources mensuelles/i);
    // Un premier enregistrement fixe les « dernières valeurs enregistrées ».
    fireEvent.change(champ, { target: { value: '7000' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Enregistrer les modifications' }),
    );
    await screen.findByText(/Enregistré à/);

    // Saisie non enregistrée, puis Rétablir : on revient aux valeurs du serveur
    // (la vue renvoyée par le PUT), pas à une saisie intermédiaire.
    fireEvent.change(champ, { target: { value: '9999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rétablir' }));

    expect(screen.getByLabelText(/Ressources mensuelles/i)).toHaveValue(
      6716.92,
    );
    // Rétablir ne défait pas l'enregistrement réussi : le statut reste affiché.
    expect(screen.getByText(/Enregistré à/)).toBeInTheDocument();
  });

  it('affiche les erreurs champ par champ en cas d’ApiError 400', async () => {
    mockedApi.modifierFoyer.mockRejectedValueOnce(
      new ApiError(400, [{ champ: 'rfr', message: 'RFR invalide' }]),
    );
    rendu();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Enregistrer les modifications',
      }),
    );

    const champ = await screen.findByLabelText(/Revenu fiscal/i);
    await waitFor(() => {
      expect(champ).toHaveAttribute('aria-invalid', 'true');
    });
    const idDecrit = champ.getAttribute('aria-describedby');
    expect(idDecrit).toBeTruthy();
    expect(document.getElementById(idDecrit!)).toHaveTextContent(
      'RFR invalide',
    );
  });

  it('affiche une erreur globale en cas d’erreur serveur', async () => {
    mockedApi.modifierFoyer.mockRejectedValueOnce(
      new ApiError(500, 'Internal'),
    );
    rendu();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Enregistrer les modifications',
      }),
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
