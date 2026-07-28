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
    listerEtablissements: vi.fn(),
    listerVersions: vi.fn(),
    apercuImpact: vi.fn(),
    creerAvenant: vi.fn(),
    corrigerVersion: vi.fn(),
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
  listerEtablissements: ReturnType<typeof vi.fn>;
  listerVersions: ReturnType<typeof vi.fn>;
  apercuImpact: ReturnType<typeof vi.fn>;
  creerAvenant: ReturnType<typeof vi.fn>;
  corrigerVersion: ReturnType<typeof vi.fn>;
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
  enfantId: 'e1',
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
    // Établissements du foyer (sélecteur du formulaire de contrat).
    mockedApi.listerEtablissements.mockResolvedValue([]);
    // Versionnement (SFD 30 lot 5) : une version courante ouverte par défaut.
    mockedApi.listerVersions.mockResolvedValue([
      {
        id: 'v1',
        contratId: 'c1',
        mode: 'CRECHE_PSU',
        dateEffet: '2026-01-01',
        du: '2026-01-01',
        au: null,
        heuresAnnuellesContractualisees: 763,
        nbMensualites: 7,
        saisiLe: '2026-01-01T09:00:00.000Z',
        motif: null,
      },
    ]);
    mockedApi.apercuImpact.mockResolvedValue({
      versionId: 'v1',
      moisCouverts: ['2026-06'],
      moisCommuniques: [],
    });
    mockedApi.creerAvenant.mockResolvedValue(contratFactice);
    mockedApi.corrigerVersion.mockResolvedValue(contratFactice);
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

  it('sans contrat : état vide guidant dont le bouton ouvre le formulaire', async () => {
    mockedApi.listerContrats.mockResolvedValue([]);
    rendu();

    await waitFor(() => {
      expect(
        screen.getByText('Aucun contrat pour l’instant'),
      ).toBeInTheDocument();
    });
    // Un seul CTA (celui de l'état vide) — pas de bouton en doublon plus bas.
    const boutons = screen.getAllByRole('button', {
      name: /\+ Nouveau contrat/i,
    });
    expect(boutons).toHaveLength(1);

    fireEvent.click(boutons[0] as HTMLElement);
    expect(
      screen.getByRole('heading', { name: 'Nouveau contrat' }),
    ).toBeInTheDocument();
  });

  it('ouvre le choix de modification (avenant / correction / historique) au clic Modifier', async () => {
    rendu();
    await waitFor(() => {
      expect(screen.getByText('Mia')).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Modifier le contrat de Mia/i }),
    );

    // Le menu (bottom-sheet) propose les trois gestes en langage parent.
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Changer à partir d’une date/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Corriger les paramètres actuels/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Voir l’historique/i }),
    ).toBeInTheDocument();
  });

  it('« Changer à partir d’une date » ouvre le formulaire d’avenant (avec date d’effet, sans identité — H6)', async () => {
    rendu();
    await waitFor(() => {
      expect(screen.getByText('Mia')).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Modifier le contrat de Mia/i }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /Changer à partir d’une date/i }),
    );

    // Champ « À partir du » présent ; aucun sélecteur d'enfant/mode (H6 : l'identité
    // ne se versionne pas — les champs sont ABSENTS, pas seulement désactivés).
    expect(screen.getByLabelText(/À partir du/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Enfant/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Mode/i)).not.toBeInTheDocument();
  });

  it('« Corriger les paramètres actuels » charge la version courante puis ouvre l’aperçu d’impact', async () => {
    rendu();
    await waitFor(() => {
      expect(screen.getByText('Mia')).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Modifier le contrat de Mia/i }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /Corriger les paramètres actuels/i }),
    );

    await waitFor(() => {
      expect(mockedApi.listerVersions).toHaveBeenCalledWith('c1');
    });
    // Le formulaire de correction s'ouvre (pas de champ date d'effet).
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Voir l’impact et corriger/i }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/À partir du/i)).not.toBeInTheDocument();
  });

  it('« Voir l’historique » liste les versions du contrat', async () => {
    rendu();
    await waitFor(() => {
      expect(screen.getByText('Mia')).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Modifier le contrat de Mia/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Voir l’historique/i }));

    await waitFor(() => {
      expect(mockedApi.listerVersions).toHaveBeenCalled();
    });
    expect(await screen.findByText(/Historique — Mia/i)).toBeInTheDocument();
    expect(screen.getByText(/À partir du/i)).toBeInTheDocument();
  });

  it('avenant : enregistre puis affiche le succès et recharge la liste', async () => {
    rendu();
    await waitFor(() => {
      expect(screen.getByText('Mia')).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Modifier le contrat de Mia/i }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /Changer à partir d’une date/i }),
    );
    fireEvent.change(screen.getByLabelText(/À partir du/i), {
      target: { value: '2027-09-01' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Enregistrer le changement' }),
    );

    await waitFor(() => {
      expect(mockedApi.creerAvenant).toHaveBeenCalled();
    });
    expect(
      await screen.findByText(/Changement enregistré pour le contrat de Mia/i),
    ).toBeInTheDocument();
  });

  it('correction : une erreur de chargement de la version courante est signalée', async () => {
    mockedApi.listerVersions.mockRejectedValueOnce(new Error('svc down'));
    rendu();
    await waitFor(() => {
      expect(screen.getByText('Mia')).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Modifier le contrat de Mia/i }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /Corriger les paramètres actuels/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/svc down/i)).toBeInTheDocument();
    });
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
        screen.getByText('Aucun contrat pour l’instant'),
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
