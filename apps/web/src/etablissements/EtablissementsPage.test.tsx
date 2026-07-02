import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EtablissementsPage } from './EtablissementsPage';
import type { EtablissementFoyerVue } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    listerEtablissements: vi.fn(),
    creerEtablissement: vi.fn(),
    modifierEtablissement: vi.fn(),
    supprimerEtablissement: vi.fn(),
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

const FOYER = 'f1';

const ETABLISSEMENTS: EtablissementFoyerVue[] = [
  {
    id: 'et-1',
    foyerId: FOYER,
    nom: 'Crèche du Centre',
    emailService: 'creche@example.org',
    preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
    types: ['CRECHE_PSU'],
    adresse: '1 rue des Lilas',
    telephone: null,
    contact: null,
    actif: true,
  },
  {
    id: 'et-2',
    foyerId: FOYER,
    nom: 'École Jean Jaurès',
    emailService: 'ecole@example.org',
    preavisRegle: { type: 'JOUR_HEURE', jour: 'JEUDI', heure: '12:00' },
    types: ['CANTINE', 'PERISCOLAIRE'],
    adresse: null,
    telephone: null,
    contact: null,
    actif: true,
  },
];

function rendre() {
  return render(
    <MemoryRouter initialEntries={[`/foyers/${FOYER}/etablissements`]}>
      <Routes>
        <Route
          path="/foyers/:foyerId/etablissements"
          element={<EtablissementsPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EtablissementsPage (per-foyer)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('liste les établissements du foyer avec préavis et types', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue(ETABLISSEMENTS);
    rendre();

    expect(await screen.findByText('Crèche du Centre')).toBeInTheDocument();
    expect(screen.getByText('École Jean Jaurès')).toBeInTheDocument();
    expect(api.listerEtablissements).toHaveBeenCalledWith(FOYER, {
      signal: expect.anything(),
    });
    expect(screen.getByText(/2 jours ouvrés/)).toBeInTheDocument();
    expect(screen.getByText(/Jeudi avant 12:00/)).toBeInTheDocument();
    expect(screen.getByText(/Cantine, Périscolaire/)).toBeInTheDocument();
  });

  it('crée un nouvel établissement', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue([]);
    vi.mocked(api.creerEtablissement).mockResolvedValue({
      ...ETABLISSEMENTS[0]!,
      nom: 'Nouvelle crèche',
    });
    rendre();

    await screen.findByText('Aucun établissement configuré.');
    fireEvent.click(
      screen.getByRole('button', { name: /Nouvel établissement/i }),
    );

    fireEvent.change(screen.getByLabelText(/Nom de l’établissement/i), {
      target: { value: 'Nouvelle crèche' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Créer l’établissement/i }),
    );

    await waitFor(() => {
      expect(api.creerEtablissement).toHaveBeenCalledTimes(1);
    });
    const [foyerArg, corps] = vi.mocked(api.creerEtablissement).mock.calls[0]!;
    expect(foyerArg).toBe(FOYER);
    expect(corps.nom).toBe('Nouvelle crèche');
    expect(corps.preavisRegle).toBeNull();
    expect(
      await screen.findByText(/« Nouvelle crèche » créé/),
    ).toBeInTheDocument();
  });

  it('affiche un message explicite si la suppression est bloquée (409)', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue(ETABLISSEMENTS);
    vi.mocked(api.supprimerEtablissement).mockRejectedValue(
      new ApiError(409, undefined),
    );
    rendre();

    await screen.findByText('Crèche du Centre');
    fireEvent.click(
      screen.getByRole('button', { name: /Supprimer Crèche du Centre/i }),
    );
    // Confirme dans la modale.
    fireEvent.click(
      screen.getByRole('button', { name: /Supprimer l’établissement/i }),
    );

    expect(
      await screen.findByText(/des contrats y sont rattachés/i),
    ).toBeInTheDocument();
  });

  it('affiche l’état vide quand le foyer n’a aucun établissement', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue([]);
    rendre();

    expect(
      await screen.findByText('Aucun établissement configuré.'),
    ).toBeInTheDocument();
  });

  it('affiche l’erreur de chargement et recharge via « Réessayer »', async () => {
    vi.mocked(api.listerEtablissements)
      .mockRejectedValueOnce(new ApiError(502, undefined))
      .mockResolvedValueOnce(ETABLISSEMENTS);
    rendre();

    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent(
      'Service indisponible, réessayez dans un instant.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    expect(await screen.findByText('Crèche du Centre')).toBeInTheDocument();
    expect(api.listerEtablissements).toHaveBeenCalledTimes(2);
  });

  it('affiche les erreurs de validation par champ à la création (422)', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue([]);
    vi.mocked(api.creerEtablissement).mockRejectedValue(
      new ApiError(422, [
        { champ: 'nom', message: 'Ce nom est déjà utilisé.' },
        { champ: 'emailService', message: 'Adresse e-mail invalide.' },
      ]),
    );
    rendre();

    await screen.findByText('Aucun établissement configuré.');
    fireEvent.click(
      screen.getByRole('button', { name: /Nouvel établissement/i }),
    );
    fireEvent.change(screen.getByLabelText(/Nom de l’établissement/i), {
      target: { value: 'Crèche du Centre' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Créer l’établissement/i }),
    );

    expect(
      await screen.findByText('Ce nom est déjà utilisé.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Adresse e-mail invalide.')).toBeInTheDocument();
    // Les champs fautifs sont marqués pour les technologies d'assistance.
    expect(screen.getByLabelText(/Nom de l’établissement/i)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText(/Adresse e-mail du service/i)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    // Le formulaire reste ouvert pour corriger.
    expect(
      screen.getByRole('button', { name: /Créer l’établissement/i }),
    ).toBeEnabled();
  });

  it('affiche un message global quand le serveur rejette la création (500)', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue([]);
    vi.mocked(api.creerEtablissement).mockRejectedValue(
      new ApiError(500, undefined),
    );
    rendre();

    await screen.findByText('Aucun établissement configuré.');
    fireEvent.click(
      screen.getByRole('button', { name: /Nouvel établissement/i }),
    );
    fireEvent.change(screen.getByLabelText(/Nom de l’établissement/i), {
      target: { value: 'Crèche du Centre' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Créer l’établissement/i }),
    );

    expect(
      await screen.findByText(
        'Service indisponible, réessayez dans un instant.',
      ),
    ).toBeInTheDocument();
  });

  it('modifie un établissement depuis le formulaire prérempli', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue(ETABLISSEMENTS);
    vi.mocked(api.modifierEtablissement).mockResolvedValue({
      ...ETABLISSEMENTS[0]!,
      nom: 'Crèche rebaptisée',
    });
    rendre();

    await screen.findByText('Crèche du Centre');
    fireEvent.click(
      screen.getByRole('button', { name: /Modifier Crèche du Centre/i }),
    );

    // Formulaire prérempli depuis l'établissement existant.
    expect(screen.getByText('Modifier l’établissement')).toBeInTheDocument();
    expect(screen.getByLabelText(/Nom de l’établissement/i)).toHaveValue(
      'Crèche du Centre',
    );
    expect(screen.getByLabelText('En jours ouvrés')).toBeChecked();
    expect(screen.getByLabelText('Crèche PSU')).toBeChecked();

    fireEvent.change(screen.getByLabelText(/Nom de l’établissement/i), {
      target: { value: 'Crèche rebaptisée' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Enregistrer les modifications/i }),
    );

    await waitFor(() => {
      expect(api.modifierEtablissement).toHaveBeenCalledTimes(1);
    });
    const [foyerArg, idArg, corps] = vi.mocked(api.modifierEtablissement).mock
      .calls[0]!;
    expect(foyerArg).toBe(FOYER);
    expect(idArg).toBe('et-1');
    expect(corps).toMatchObject({
      nom: 'Crèche rebaptisée',
      emailService: 'creche@example.org',
      preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
      types: ['CRECHE_PSU'],
      adresse: '1 rue des Lilas',
    });
    expect(
      await screen.findByText(/« Crèche rebaptisée » modifié/),
    ).toBeInTheDocument();
  });

  it('supprime un établissement après confirmation dans la modale', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue(ETABLISSEMENTS);
    vi.mocked(api.supprimerEtablissement).mockResolvedValue(undefined);
    rendre();

    await screen.findByText('Crèche du Centre');
    fireEvent.click(
      screen.getByRole('button', { name: /Supprimer Crèche du Centre/i }),
    );

    // La modale de confirmation explique la conséquence avant d'agir.
    expect(
      screen.getByText(/sera définitivement supprimé/i),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /Supprimer l’établissement/i }),
    );

    await waitFor(() => {
      expect(api.supprimerEtablissement).toHaveBeenCalledWith(FOYER, 'et-1');
    });
    expect(
      await screen.findByText(/« Crèche du Centre » supprimé/),
    ).toBeInTheDocument();
    // La liste est rechargée après suppression.
    expect(api.listerEtablissements).toHaveBeenCalledTimes(2);
  });

  it('annule la suppression depuis la modale sans appeler l’API', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue(ETABLISSEMENTS);
    rendre();

    await screen.findByText('Crèche du Centre');
    fireEvent.click(
      screen.getByRole('button', { name: /Supprimer Crèche du Centre/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));

    expect(api.supprimerEtablissement).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/sera définitivement supprimé/i),
    ).not.toBeInTheDocument();
  });

  it('affiche une erreur lisible quand l’archivage échoue', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue(ETABLISSEMENTS);
    vi.mocked(api.modifierEtablissement).mockRejectedValue(
      new ApiError(502, undefined),
    );
    rendre();

    await screen.findByText('Crèche du Centre');
    fireEvent.click(
      screen.getByRole('button', { name: /Archiver Crèche du Centre/i }),
    );

    expect(
      await screen.findByText(
        'Service indisponible, réessayez dans un instant.',
      ),
    ).toBeInTheDocument();
  });

  it('archive un établissement (PUT actif: false)', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue(ETABLISSEMENTS);
    vi.mocked(api.modifierEtablissement).mockResolvedValue({
      ...ETABLISSEMENTS[0]!,
      actif: false,
    });
    rendre();

    await screen.findByText('Crèche du Centre');
    fireEvent.click(
      screen.getByRole('button', { name: /Archiver Crèche du Centre/i }),
    );

    await waitFor(() => {
      expect(api.modifierEtablissement).toHaveBeenCalledWith(FOYER, 'et-1', {
        actif: false,
      });
    });
    expect(await screen.findByText(/archivé/)).toBeInTheDocument();
  });
});
