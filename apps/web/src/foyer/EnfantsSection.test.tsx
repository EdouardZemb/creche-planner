import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EnfantsSection } from './EnfantsSection';
import type { EnfantVue } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    ajouterEnfant: vi.fn(),
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

const mockedApi = api as unknown as {
  ajouterEnfant: ReturnType<typeof vi.fn>;
};

const FOYER_ID = 'foyer-123';

const enfant = (e: Partial<EnfantVue> & Pick<EnfantVue, 'id'>): EnfantVue => ({
  foyerId: FOYER_ID,
  prenom: 'Mia',
  dateNaissance: '2024-12-08',
  ...e,
});

describe('EnfantsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('liste les enfants existants', () => {
    render(
      <EnfantsSection
        foyerId={FOYER_ID}
        enfantsInitiaux={[enfant({ id: 'e1', prenom: 'Mia' })]}
      />,
    );
    expect(screen.getByText('Mia')).toBeInTheDocument();
    expect(screen.getByText(/2024-12-08/)).toBeInTheDocument();
  });

  it('désactive l’ajout tant que les champs sont vides', () => {
    render(<EnfantsSection foyerId={FOYER_ID} enfantsInitiaux={[]} />);
    expect(
      screen.getByRole('button', { name: '+ Ajouter cet enfant' }),
    ).toBeDisabled();
  });

  it('ajoute un enfant et l’insère dans la liste', async () => {
    mockedApi.ajouterEnfant.mockResolvedValueOnce(
      enfant({ id: 'e2', prenom: 'Zoé', dateNaissance: '2023-03-12' }),
    );
    render(<EnfantsSection foyerId={FOYER_ID} enfantsInitiaux={[]} />);

    fireEvent.change(screen.getByLabelText(/Prénom/i), {
      target: { value: 'Zoé' },
    });
    fireEvent.change(screen.getByLabelText(/Date de naissance/i), {
      target: { value: '2023-03-12' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '+ Ajouter cet enfant' }),
    );

    await waitFor(() => {
      expect(mockedApi.ajouterEnfant).toHaveBeenCalledWith(FOYER_ID, {
        prenom: 'Zoé',
        dateNaissance: '2023-03-12',
      });
    });
    expect(await screen.findByText('Zoé')).toBeInTheDocument();
  });
});
