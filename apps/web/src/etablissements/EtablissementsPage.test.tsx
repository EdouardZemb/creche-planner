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
