import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { DesabonnementPage } from './DesabonnementPage';

vi.mock('../api/client', () => ({
  api: { desabonner: vi.fn() },
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
  desabonner: ReturnType<typeof vi.fn>;
};

function afficher(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <DesabonnementPage />
    </MemoryRouter>,
  );
}

describe('DesabonnementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('désabonne au clic (POST avec le jeton) et affiche la confirmation', async () => {
    mockedApi.desabonner.mockResolvedValue(undefined);
    afficher('/desabonnement?token=abc123');

    fireEvent.click(screen.getByRole('button', { name: 'Me désabonner' }));

    await waitFor(() => {
      expect(mockedApi.desabonner).toHaveBeenCalledWith('abc123');
    });
    expect(
      await screen.findByText(/vous ne recevrez plus ces rappels/i),
    ).toBeInTheDocument();
  });

  it('ne déclenche aucun appel avant le clic explicite (pas d’effet sur GET)', () => {
    afficher('/desabonnement?token=abc123');
    expect(mockedApi.desabonner).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Me désabonner' }),
    ).toBeInTheDocument();
  });

  it('jeton manquant : lien invalide, pas de bouton de désabonnement', () => {
    afficher('/desabonnement');
    expect(mockedApi.desabonner).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /invalide, expiré ou a déjà été utilisé/i,
    );
    expect(
      screen.queryByRole('button', { name: 'Me désabonner' }),
    ).not.toBeInTheDocument();
  });

  it('dernier canal d’un type de service (409) : message dédié « ne peut pas être coupé »', async () => {
    mockedApi.desabonner.mockRejectedValue(new ApiError(409, undefined));
    afficher('/desabonnement?token=abc123');

    fireEvent.click(screen.getByRole('button', { name: 'Me désabonner' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /ne peut pas être coupé/i,
    );
  });

  it('lien invalide/expiré/déjà utilisé (400) : message générique', async () => {
    mockedApi.desabonner.mockRejectedValue(new ApiError(400, undefined));
    afficher('/desabonnement?token=deja-utilise');

    fireEvent.click(screen.getByRole('button', { name: 'Me désabonner' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /invalide, expiré ou a déjà été utilisé/i,
    );
  });

  it('erreur serveur : propose de réessayer', async () => {
    mockedApi.desabonner.mockRejectedValue(new ApiError(502, undefined));
    afficher('/desabonnement?token=abc123');

    fireEvent.click(screen.getByRole('button', { name: 'Me désabonner' }));

    expect(
      await screen.findByRole('button', { name: 'Réessayer' }),
    ).toBeInTheDocument();
  });
});
