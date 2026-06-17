import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { FoyerFormPage } from './FoyerFormPage';
import type { DossierFoyerVue } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    creerFoyer: vi.fn(),
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

const mockedApi = api as unknown as { creerFoyer: ReturnType<typeof vi.fn> };

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
    const message = document.getElementById(idDecrit as string);
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
    const message = document.getElementById(idDecrit as string);
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
});
