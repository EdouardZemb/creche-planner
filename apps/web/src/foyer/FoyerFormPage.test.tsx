import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { FoyerFormPage } from './FoyerFormPage';
import type { DossierFoyerVue } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    creerFoyer: vi.fn(),
    // Utilisé par MoiProvider (test de gating admin) ; inerte ailleurs.
    moi: vi.fn().mockResolvedValue({ email: null, admin: true, foyers: [] }),
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

vi.mock('../utils/store', () => ({
  setFoyerId: vi.fn(),
  getFoyerId: vi.fn(() => null),
}));

import { api, ApiError } from '../api/client';
import { setFoyerId } from '../utils/store';
import { MoiProvider } from '../session/MoiContext';

const mockedApi = api as unknown as {
  creerFoyer: ReturnType<typeof vi.fn>;
  moi: ReturnType<typeof vi.fn>;
};

const dossierFactice: DossierFoyerVue = {
  foyer: {
    id: 'foyer-123',
    ressourcesMensuellesCentimes: 671692,
    ressourcesMensuellesEuros: 6716.92,
    rfrCentimes: 7270500,
    rfrEuros: 72705,
    nbEnfantsACharge: 2,
    nbParts: 2.5,
    tranche: 2,
  },
  enfants: [
    {
      id: 'e1',
      foyerId: 'foyer-123',
      prenom: 'Mia',
      dateNaissance: '2024-12-08',
    },
    {
      id: 'e2',
      foyerId: 'foyer-123',
      prenom: 'Zoé',
      dateNaissance: '2023-03-12',
    },
  ],
  parents: [],
};

function rendu() {
  return render(
    <MemoryRouter>
      <FoyerFormPage />
    </MemoryRouter>,
  );
}

describe('FoyerFormPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('affiche le formulaire avec les valeurs par défaut', () => {
    rendu();

    expect(screen.getByLabelText(/Ressources mensuelles/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Revenu fiscal/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/enfants à charge/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/parts fiscales/i)).toBeInTheDocument();

    // Prénoms pré-remplis
    expect(screen.getByDisplayValue('Mia')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Zoé')).toBeInTheDocument();
  });

  it('soumet le formulaire et redirige vers les contrats', async () => {
    mockedApi.creerFoyer.mockResolvedValueOnce(dossierFactice);
    rendu();

    fireEvent.click(screen.getByRole('button', { name: /Créer le foyer/i }));

    await waitFor(() => {
      expect(mockedApi.creerFoyer).toHaveBeenCalledTimes(1);
    });

    const appel = mockedApi.creerFoyer.mock.calls[0] as unknown[];
    const saisie = appel[0] as Record<string, unknown>;
    expect(saisie['ressourcesMensuelles']).toBe(6716.92);
    expect(saisie['rfr']).toBe(72705);
    expect(saisie['nbEnfantsACharge']).toBe(2);
    expect(saisie['nbParts']).toBe(2.5);

    expect(setFoyerId).toHaveBeenCalledWith('foyer-123');
  });

  it("affiche les erreurs champ par champ en cas d'ApiError 400", async () => {
    const erreurs = [{ champ: 'rfr', message: 'RFR invalide' }];
    mockedApi.creerFoyer.mockRejectedValueOnce(new ApiError(400, erreurs));
    rendu();

    fireEvent.click(screen.getByRole('button', { name: /Créer le foyer/i }));

    await waitFor(() => {
      expect(screen.getByText('RFR invalide')).toBeInTheDocument();
    });
  });

  it('lie le champ en erreur via aria-invalid + aria-describedby (EX-11)', async () => {
    const erreurs = [{ champ: 'rfr', message: 'RFR invalide' }];
    mockedApi.creerFoyer.mockRejectedValueOnce(new ApiError(400, erreurs));
    rendu();

    fireEvent.click(screen.getByRole('button', { name: /Créer le foyer/i }));

    const champ = screen.getByLabelText(/Revenu fiscal/i);
    await waitFor(() => {
      expect(champ).toHaveAttribute('aria-invalid', 'true');
    });
    const idDecrit = champ.getAttribute('aria-describedby');
    expect(idDecrit).toBeTruthy();
    const message = document.getElementById(idDecrit!);
    expect(message).toHaveTextContent('RFR invalide');
  });

  it("affiche une erreur globale en cas d'erreur serveur", async () => {
    mockedApi.creerFoyer.mockRejectedValueOnce(new ApiError(500, 'Internal'));
    rendu();

    fireEvent.click(screen.getByRole('button', { name: /Créer le foyer/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it("permet d'ajouter un enfant dynamiquement", () => {
    rendu();

    const avant = screen.getAllByLabelText(/Prénom/i).length;
    fireEvent.click(screen.getByRole('button', { name: /Ajouter un enfant/i }));

    expect(screen.getAllByLabelText(/Prénom/i)).toHaveLength(avant + 1);
  });

  it('permet de retirer un enfant', () => {
    rendu();

    const boutons = screen.getAllByRole('button', {
      name: /Retirer l'enfant/i,
    });
    expect(boutons.length).toBeGreaterThan(0);

    const avant = screen.getAllByLabelText(/Prénom/i).length;
    fireEvent.click(boutons[0]!);
    expect(screen.getAllByLabelText(/Prénom/i)).toHaveLength(avant - 1);
  });

  // UT-05 : liaison erreur ↔ champ pour nbEnfantsACharge.
  it("lie l'erreur de nbEnfantsACharge via aria-describedby → id du message", async () => {
    const erreurs = [{ champ: 'nbEnfantsACharge', message: 'Nombre invalide' }];
    mockedApi.creerFoyer.mockRejectedValueOnce(new ApiError(400, erreurs));
    rendu();

    fireEvent.click(screen.getByRole('button', { name: /Créer le foyer/i }));

    const champ = screen.getByLabelText(/enfants à charge/i);
    await waitFor(() => {
      expect(champ).toHaveAttribute('aria-invalid', 'true');
    });
    const idDecrit = champ.getAttribute('aria-describedby');
    expect(idDecrit).toBeTruthy();
    const message = document.getElementById(idDecrit!);
    expect(message).not.toBeNull();
    expect(message).toHaveTextContent('Nombre invalide');
  });

  // UT-06 : noms accessibles contextuels et uniques des boutons « Retirer ».
  it('nomme chaque bouton « Retirer » par le prénom de l’enfant (unicité)', () => {
    rendu();

    expect(
      screen.getByRole('button', { name: "Retirer l'enfant Mia" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: "Retirer l'enfant Zoé" }),
    ).toBeInTheDocument();
  });

  it('utilise « Retirer cet enfant » quand le prénom est vide', () => {
    rendu();

    // Vide le prénom du premier enfant (Mia).
    fireEvent.change(screen.getByDisplayValue('Mia'), {
      target: { value: '' },
    });

    expect(
      screen.getByRole('button', { name: 'Retirer cet enfant' }),
    ).toBeInTheDocument();
  });

  // UT-04 : erreur globale (BFF sans détail) actionnable + focus porté.
  it('porte le focus sur l’alerte globale et oriente le message (UT-04)', async () => {
    mockedApi.creerFoyer.mockRejectedValueOnce(new ApiError(400, undefined));
    rendu();

    fireEvent.click(screen.getByRole('button', { name: /Créer le foyer/i }));

    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent(/vérifiez les champs marqués/i);
    await waitFor(() => {
      expect(alerte).toHaveFocus();
    });
  });

  // UT-08 : sigle RFR explicité via <abbr> à sa première occurrence.
  it('explicite le sigle RFR via un <abbr> avec libellé long', () => {
    rendu();

    const abbr = screen.getByTitle('Revenu fiscal de référence');
    expect(abbr.tagName).toBe('ABBR');
    expect(abbr).toHaveTextContent('RFR');
  });

  // ---- Bloc « Parents » (PR3 parents-foyer) -------------------------------

  it('affiche le bloc Parents avec une ligne pré-remplie (démo)', () => {
    rendu();

    expect(screen.getByText('Parents')).toBeInTheDocument();
    expect(screen.getByLabelText(/Adresse e-mail/i)).toHaveValue(
      'parent.demo@example.com',
    );
    expect(screen.getByDisplayValue('Camille')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Martin')).toBeInTheDocument();
  });

  it("permet d'ajouter un parent dynamiquement", () => {
    rendu();

    const avant = screen.getAllByLabelText(/Adresse e-mail/i).length;
    fireEvent.click(screen.getByRole('button', { name: /Ajouter un parent/i }));

    expect(screen.getAllByLabelText(/Adresse e-mail/i)).toHaveLength(avant + 1);
  });

  it('permet de retirer un parent jusqu’à zéro (parents facultatifs)', () => {
    rendu();

    fireEvent.click(
      screen.getByRole('button', { name: 'Retirer le parent Camille Martin' }),
    );

    expect(screen.queryByLabelText(/Adresse e-mail/i)).not.toBeInTheDocument();
  });

  it('envoie les parents saisis (mappés email/prénom/nom + ordre)', async () => {
    mockedApi.creerFoyer.mockResolvedValueOnce(dossierFactice);
    rendu();

    fireEvent.click(screen.getByRole('button', { name: /Créer le foyer/i }));

    await waitFor(() => {
      expect(mockedApi.creerFoyer).toHaveBeenCalledTimes(1);
    });

    const saisie = (mockedApi.creerFoyer.mock.calls[0] as unknown[])[0] as {
      parents: unknown[];
    };
    expect(saisie.parents).toEqual([
      {
        email: 'parent.demo@example.com',
        prenom: 'Camille',
        nom: 'Martin',
        ordre: 0,
      },
    ]);
  });

  it('ignore les lignes parent entièrement vides à la soumission', async () => {
    mockedApi.creerFoyer.mockResolvedValueOnce(dossierFactice);
    rendu();

    // Ajoute une 2e ligne laissée vide : elle ne doit pas partir au BFF.
    fireEvent.click(screen.getByRole('button', { name: /Ajouter un parent/i }));
    fireEvent.click(screen.getByRole('button', { name: /Créer le foyer/i }));

    await waitFor(() => {
      expect(mockedApi.creerFoyer).toHaveBeenCalledTimes(1);
    });

    const saisie = (mockedApi.creerFoyer.mock.calls[0] as unknown[])[0] as {
      parents: unknown[];
    };
    expect(saisie.parents).toHaveLength(1);
  });

  it('n’envoie aucun parent quand le bloc est vidé', async () => {
    mockedApi.creerFoyer.mockResolvedValueOnce(dossierFactice);
    rendu();

    fireEvent.click(
      screen.getByRole('button', { name: 'Retirer le parent Camille Martin' }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Créer le foyer/i }));

    await waitFor(() => {
      expect(mockedApi.creerFoyer).toHaveBeenCalledTimes(1);
    });

    const saisie = (mockedApi.creerFoyer.mock.calls[0] as unknown[])[0] as {
      parents: unknown[];
    };
    expect(saisie.parents).toEqual([]);
  });

  it('lie une erreur serveur de parent au bon champ via aria-describedby', async () => {
    const erreurs = [
      { champ: 'parents.0.email', message: 'adresse e-mail invalide' },
    ];
    mockedApi.creerFoyer.mockRejectedValueOnce(new ApiError(400, erreurs));
    rendu();

    fireEvent.click(screen.getByRole('button', { name: /Créer le foyer/i }));

    const champ = screen.getByLabelText(/Adresse e-mail/i);
    await waitFor(() => {
      expect(champ).toHaveAttribute('aria-invalid', 'true');
    });
    const idDecrit = champ.getAttribute('aria-describedby');
    expect(idDecrit).toBeTruthy();
    const message = document.getElementById(idDecrit!);
    expect(message).toHaveTextContent('adresse e-mail invalide');
    expect(message).toHaveAttribute('role', 'alert');
  });
});

describe('FoyerFormPage — gating admin (PR6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('non-admin : écran « réservé à l’administrateur », pas de formulaire', async () => {
    mockedApi.moi.mockResolvedValue({
      email: 'parent@test.fr',
      admin: false,
      foyers: [],
    });
    render(
      <MemoryRouter>
        <MoiProvider>
          <FoyerFormPage />
        </MoiProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("Création réservée à l'administrateur"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Créer le foyer' }),
    ).not.toBeInTheDocument();
  });

  it('admin : le formulaire de création s’affiche', async () => {
    mockedApi.moi.mockResolvedValue({
      email: 'admin@test.fr',
      admin: true,
      foyers: [],
    });
    render(
      <MemoryRouter>
        <MoiProvider>
          <FoyerFormPage />
        </MoiProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('button', { name: 'Créer le foyer' }),
    ).toBeInTheDocument();
  });
});
