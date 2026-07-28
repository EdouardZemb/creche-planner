import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ModaleCorrection } from './ModaleCorrection';

vi.mock('../api/client', () => ({
  api: { apercuImpact: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '../api/client';

const mockedApi = api as unknown as {
  apercuImpact: ReturnType<typeof vi.fn>;
};

describe('ModaleCorrection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('affiche les mois recalculés sans avertissement quand rien n’est communiqué', async () => {
    mockedApi.apercuImpact.mockResolvedValue({
      versionId: 'v1',
      moisCouverts: ['2026-06', '2026-07'],
      moisCommuniques: [],
    });
    render(
      <ModaleCorrection
        contratId="c1"
        versionId="v1"
        enregistrement={false}
        onConfirmer={vi.fn()}
        onAnnuler={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(/2 mois seront recalculés/i),
    ).toBeInTheDocument();
    // Pas d'avertissement « déjà envoyé ».
    expect(screen.queryByText(/déjà été envoyé/i)).not.toBeInTheDocument();
  });

  it('avertit « déjà envoyé » pour les mois communiqués (CA3 US-30-05)', async () => {
    mockedApi.apercuImpact.mockResolvedValue({
      versionId: 'v1',
      moisCouverts: ['2026-06', '2026-07'],
      moisCommuniques: ['2026-07'],
    });
    render(
      <ModaleCorrection
        contratId="c1"
        versionId="v1"
        enregistrement={false}
        onConfirmer={vi.fn()}
        onAnnuler={vi.fn()}
      />,
    );

    const alerte = await screen.findByText(/déjà été envoyé à la crèche/i);
    expect(alerte).toBeInTheDocument();
  });

  it('confirme avec le motif saisi', async () => {
    const onConfirmer = vi.fn();
    mockedApi.apercuImpact.mockResolvedValue({
      versionId: 'v1',
      moisCouverts: ['2026-06'],
      moisCommuniques: [],
    });
    render(
      <ModaleCorrection
        contratId="c1"
        versionId="v1"
        enregistrement={false}
        onConfirmer={onConfirmer}
        onAnnuler={vi.fn()}
      />,
    );

    await screen.findByText(/1 mois sera recalculé/i);
    fireEvent.change(screen.getByLabelText(/Motif/i), {
      target: { value: 'erreur horaires' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Enregistrer la correction/i }),
    );
    expect(onConfirmer).toHaveBeenCalledWith('erreur horaires');
  });

  it('confirme sans motif → undefined', async () => {
    const onConfirmer = vi.fn();
    mockedApi.apercuImpact.mockResolvedValue({
      versionId: 'v1',
      moisCouverts: ['2026-06'],
      moisCommuniques: [],
    });
    render(
      <ModaleCorrection
        contratId="c1"
        versionId="v1"
        enregistrement={false}
        onConfirmer={onConfirmer}
        onAnnuler={vi.fn()}
      />,
    );

    await screen.findByText(/1 mois sera recalculé/i);
    fireEvent.click(
      screen.getByRole('button', { name: /Enregistrer la correction/i }),
    );
    expect(onConfirmer).toHaveBeenCalledWith(undefined);
  });

  it('Annuler ferme la modale', async () => {
    const onAnnuler = vi.fn();
    mockedApi.apercuImpact.mockResolvedValue({
      versionId: 'v1',
      moisCouverts: ['2026-06'],
      moisCommuniques: [],
    });
    render(
      <ModaleCorrection
        contratId="c1"
        versionId="v1"
        enregistrement={false}
        onConfirmer={vi.fn()}
        onAnnuler={onAnnuler}
      />,
    );

    await screen.findByText(/1 mois sera recalculé/i);
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onAnnuler).toHaveBeenCalled();
  });

  it('affiche l’erreur de calcul d’impact avec un bouton Réessayer', async () => {
    mockedApi.apercuImpact.mockRejectedValue(new Error('KO'));
    render(
      <ModaleCorrection
        contratId="c1"
        versionId="v1"
        enregistrement={false}
        onConfirmer={vi.fn()}
        onAnnuler={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByText(/Impossible de calculer l’impact/i),
      ).toBeInTheDocument();
    });
  });
});
