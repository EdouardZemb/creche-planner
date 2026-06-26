import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ContratsPage } from './ContratsPage';
import type { DossierFoyerVue, ContratLocal } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    lireFoyer: vi.fn(),
    listerContrats: vi.fn(),
    supprimerContrat: vi.fn(),
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
  // Exporté par le vrai module et importé par useFoyer : requis dans le mock.
  AuthExpiredError: class AuthExpiredError extends Error {},
}));

import { api } from '../api/client';

const mockedApi = api as unknown as {
  lireFoyer: ReturnType<typeof vi.fn>;
  listerContrats: ReturnType<typeof vi.fn>;
  supprimerContrat: ReturnType<typeof vi.fn>;
};

const FOYER_ID = 'f1';

const dossierFactice: DossierFoyerVue = {
  foyer: {
    id: FOYER_ID,
    ressourcesMensuellesCentimes: 100000,
    ressourcesMensuellesEuros: 1000,
    rfrCentimes: 1200000,
    rfrEuros: 12000,
    nbEnfantsACharge: 1,
    nbParts: 2,
    tranche: 2,
  },
  enfants: [
    {
      id: 'e1',
      foyerId: FOYER_ID,
      prenom: 'Mia',
      dateNaissance: '2024-12-08',
    },
  ],
  parents: [],
};

const contratFactice: ContratLocal = {
  id: 'c1',
  foyerId: FOYER_ID,
  enfant: 'Mia',
  mode: 'CRECHE_PSU',
  valideDu: '2026-01-01',
  valideAu: null,
  heuresAnnuellesContractualisees: 763,
  nbMensualites: 7,
  semaineType: {},
};

function rendu() {
  return render(
    <MemoryRouter initialEntries={[`/foyers/${FOYER_ID}`]}>
      <Routes>
        <Route path="/foyers/:foyerId" element={<ContratsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ContratsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.lireFoyer.mockResolvedValue(dossierFactice);
    // Liste des contrats lue depuis l'API (GET /api/v1/contrats?foyer=).
    mockedApi.listerContrats.mockResolvedValue([contratFactice]);
  });

  it('liste les contrats avec boutons Modifier et Supprimer', async () => {
    rendu();
    await waitFor(() => {
      expect(screen.getByText('Mia')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: /Modifier le contrat de Mia/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Supprimer le contrat de Mia/i }),
    ).toBeInTheDocument();
  });

  it('ouvre le formulaire pré-rempli en cliquant sur Modifier', async () => {
    rendu();
    await waitFor(() => {
      expect(screen.getByText('Mia')).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Modifier le contrat de Mia/i }),
    );

    expect(screen.getByText(/Modifier le contrat/i)).toBeInTheDocument();
    expect(
      (screen.getByLabelText(/Valide du/i) as HTMLInputElement).value,
    ).toBe('2026-01-01');
  });

  // UT-03 : la confirmation passe désormais par la Modale accessible
  // (role="dialog"), plus par window.confirm natif.
  it('ouvre une modale de confirmation accessible (pas de window.confirm) au clic Supprimer', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');

    rendu();
    await waitFor(() => {
      expect(screen.getByText('Mia')).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Supprimer le contrat de Mia/i }),
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // Action primaire destructive clairement nommée + secondaire « Annuler ».
    expect(
      screen.getByRole('button', { name: 'Supprimer le contrat' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
    // Aucun appel à window.confirm natif.
    expect(confirmSpy).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('place le focus initial sur « Annuler » à l’ouverture de la modale', async () => {
    rendu();
    await waitFor(() => {
      expect(screen.getByText('Mia')).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Supprimer le contrat de Mia/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Annuler' })).toHaveFocus();
    });
  });

  it('supprime un contrat après confirmation dans la modale (DELETE + rechargement)', async () => {
    mockedApi.supprimerContrat.mockResolvedValueOnce(undefined);

    rendu();
    await waitFor(() => {
      expect(screen.getByText('Mia')).toBeInTheDocument();
    });

    // Après suppression, le rechargement de la liste renvoie un foyer sans contrat.
    mockedApi.listerContrats.mockResolvedValue([]);

    fireEvent.click(
      screen.getByRole('button', { name: /Supprimer le contrat de Mia/i }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Supprimer le contrat' }),
    );

    await waitFor(() => {
      expect(mockedApi.supprimerContrat).toHaveBeenCalledWith('c1');
    });
    await waitFor(() => {
      expect(
        screen.getByText('Aucun contrat pour ce foyer.'),
      ).toBeInTheDocument();
    });
  });

  it('affiche un message de succès role="status" après suppression (EX-12)', async () => {
    mockedApi.supprimerContrat.mockResolvedValueOnce(undefined);

    rendu();
    await waitFor(() => {
      expect(screen.getByText('Mia')).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Supprimer le contrat de Mia/i }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Supprimer le contrat' }),
    );

    const statut = screen.getByRole('status');
    expect(statut).toHaveAttribute('aria-live', 'polite');
    await waitFor(() => {
      expect(statut).toHaveTextContent(/Contrat de Mia supprimé/i);
    });
  });

  it("ne supprime pas si l'utilisateur annule la confirmation", async () => {
    rendu();
    await waitFor(() => {
      expect(screen.getByText('Mia')).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Supprimer le contrat de Mia/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));

    expect(mockedApi.supprimerContrat).not.toHaveBeenCalled();
    // Le contrat reste affiché (aucun rechargement vidant la liste).
    expect(screen.getByText('Mia')).toBeInTheDocument();
    // La modale est refermée.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
