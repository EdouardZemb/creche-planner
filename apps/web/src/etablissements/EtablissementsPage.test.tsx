import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EtablissementsPage } from './EtablissementsPage';
import type { EtablissementVue } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    listerEtablissements: vi.fn(),
    mettreAJourEtablissement: vi.fn(),
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

const ETABLISSEMENTS: EtablissementVue[] = [
  {
    cle: 'ABCM',
    libelle: 'École ABCM',
    emailService: 'abcm@example.org',
    preavisRegle: { type: 'JOUR_HEURE', jour: 'JEUDI', heure: '12:00' },
    actif: true,
  },
  {
    cle: 'CRECHE_HIRONDELLES',
    libelle: 'Crèche Les Hirondelles',
    emailService: 'creche@example.org',
    preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
    actif: true,
  },
];

function rendre() {
  return render(
    <MemoryRouter>
      <EtablissementsPage />
    </MemoryRouter>,
  );
}

describe('EtablissementsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('liste les établissements seedés avec leur préavis', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue(ETABLISSEMENTS);
    rendre();

    expect(await screen.findByText('École ABCM')).toBeInTheDocument();
    expect(screen.getByText('Crèche Les Hirondelles')).toBeInTheDocument();
    // Récap lisible de chaque règle de préavis.
    expect(screen.getByText(/Jeudi avant 12:00/)).toBeInTheDocument();
    expect(screen.getByText(/2 jours ouvrés/)).toBeInTheDocument();
  });

  it('enregistre une modification d’adresse e-mail (jours ouvrés)', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue(ETABLISSEMENTS);
    vi.mocked(api.mettreAJourEtablissement).mockResolvedValue({
      ...ETABLISSEMENTS[1]!,
      emailService: 'nouvelle@example.org',
    });
    rendre();

    const email = await screen.findByDisplayValue('creche@example.org');
    fireEvent.change(email, {
      target: { value: 'nouvelle@example.org' },
    });
    // Le formulaire de la crèche (jours ouvrés) — soumission par son bouton.
    const boutons = screen.getAllByRole('button', { name: 'Enregistrer' });
    fireEvent.click(boutons[1]!);

    await waitFor(() => {
      expect(api.mettreAJourEtablissement).toHaveBeenCalledWith(
        'CRECHE_HIRONDELLES',
        {
          emailService: 'nouvelle@example.org',
          preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
        },
      );
    });
    expect(
      await screen.findByText('Modifications enregistrées.'),
    ).toBeInTheDocument();
  });

  it('affiche une erreur si l’enregistrement échoue', async () => {
    vi.mocked(api.listerEtablissements).mockResolvedValue(ETABLISSEMENTS);
    vi.mocked(api.mettreAJourEtablissement).mockRejectedValue(
      new Error('boum'),
    );
    rendre();

    await screen.findByText('École ABCM');
    const boutons = screen.getAllByRole('button', { name: 'Enregistrer' });
    fireEvent.click(boutons[0]!);

    expect(await screen.findByText('boum')).toBeInTheDocument();
  });
});
