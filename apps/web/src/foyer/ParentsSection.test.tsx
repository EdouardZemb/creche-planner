import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ParentsSection } from './ParentsSection';
import type { ParentVue } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    ajouterParent: vi.fn(),
    modifierParent: vi.fn(),
    retirerParent: vi.fn(),
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
  ajouterParent: ReturnType<typeof vi.fn>;
  modifierParent: ReturnType<typeof vi.fn>;
  retirerParent: ReturnType<typeof vi.fn>;
};

const FOYER_ID = 'foyer-123';

const parent = (p: Partial<ParentVue> & Pick<ParentVue, 'id'>): ParentVue => ({
  foyerId: FOYER_ID,
  prenom: 'Alex',
  nom: 'Dupont',
  email: 'alex@example.test',
  principal: false,
  ordre: 0,
  actif: true,
  ...p,
});

describe('ParentsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('liste les parents existants et propose un ajout', () => {
    render(
      <ParentsSection
        foyerId={FOYER_ID}
        parentsInitiaux={[parent({ id: 'p1', email: 'alex@example.test' })]}
      />,
    );

    expect(screen.getByDisplayValue('alex@example.test')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '+ Ajouter ce parent' }),
    ).toBeInTheDocument();
  });

  it('ajoute un parent et l’insère dans la liste', async () => {
    mockedApi.ajouterParent.mockResolvedValueOnce(
      parent({ id: 'p2', email: 'camille@example.test', prenom: 'Camille' }),
    );
    render(<ParentsSection foyerId={FOYER_ID} parentsInitiaux={[]} />);

    fireEvent.change(screen.getByLabelText(/Adresse e-mail/i), {
      target: { value: 'camille@example.test' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '+ Ajouter ce parent' }),
    );

    await waitFor(() => {
      expect(mockedApi.ajouterParent).toHaveBeenCalledWith(FOYER_ID, {
        email: 'camille@example.test',
      });
    });
    expect(
      await screen.findByDisplayValue('camille@example.test'),
    ).toBeInTheDocument();
  });

  it('affiche un message contextuel sur conflit 409 à l’ajout', async () => {
    mockedApi.ajouterParent.mockRejectedValueOnce(
      new ApiError(409, { message: 'erreur du service amont' }),
    );
    render(<ParentsSection foyerId={FOYER_ID} parentsInitiaux={[]} />);

    fireEvent.change(screen.getByLabelText(/Adresse e-mail/i), {
      target: { value: 'doublon@example.test' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '+ Ajouter ce parent' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /déjà utilisée.*parent principal/i,
    );
  });

  it('retire un parent existant de la liste', async () => {
    mockedApi.retirerParent.mockResolvedValueOnce(undefined);
    render(
      <ParentsSection
        foyerId={FOYER_ID}
        parentsInitiaux={[parent({ id: 'p1', email: 'alex@example.test' })]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Retirer le parent/i }));

    await waitFor(() => {
      expect(mockedApi.retirerParent).toHaveBeenCalledWith(FOYER_ID, 'p1');
    });
    await waitFor(() => {
      expect(
        screen.queryByDisplayValue('alex@example.test'),
      ).not.toBeInTheDocument();
    });
  });

  it('édite un parent (envoie email + identité + principal)', async () => {
    mockedApi.modifierParent.mockResolvedValueOnce(
      parent({ id: 'p1', email: 'alex@example.test', principal: true }),
    );
    render(
      <ParentsSection
        foyerId={FOYER_ID}
        parentsInitiaux={[parent({ id: 'p1', email: 'alex@example.test' })]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(mockedApi.modifierParent).toHaveBeenCalledWith(FOYER_ID, 'p1', {
        email: 'alex@example.test',
        prenom: 'Alex',
        nom: 'Dupont',
        principal: false,
      });
    });
  });

  it('relie l’erreur de champ 400 à l’e-mail (aria-describedby)', async () => {
    mockedApi.ajouterParent.mockRejectedValueOnce(
      new ApiError(400, [
        { champ: 'email', message: 'adresse e-mail invalide' },
      ]),
    );
    render(<ParentsSection foyerId={FOYER_ID} parentsInitiaux={[]} />);

    fireEvent.change(screen.getByLabelText(/Adresse e-mail/i), {
      target: { value: 'nope' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '+ Ajouter ce parent' }),
    );

    const champ = await screen.findByLabelText(/Adresse e-mail/i);
    await waitFor(() => {
      expect(champ).toHaveAttribute('aria-invalid', 'true');
    });
    const idDecrit = champ.getAttribute('aria-describedby');
    expect(idDecrit).toBeTruthy();
    expect(document.getElementById(idDecrit!)).toHaveTextContent(
      'adresse e-mail invalide',
    );
  });
});
