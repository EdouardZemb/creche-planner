import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EncartValidation } from './EncartValidation';
import type { NotificationAValider, ValidationResultat } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    listerAValider: vi.fn(),
    validerSemaine: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

import { api } from '../api/client';

const A_VALIDER: NotificationAValider[] = [
  {
    contratId: '55555555-0000-4000-8000-000000000000',
    foyerId: 'foyer-1',
    semaineIso: '2026-W27',
    statut: 'A_VALIDER',
    notifieeLe: '2026-06-23T06:00:00.000Z',
  },
];

describe('EncartValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ne rend rien quand il n’y a aucune semaine à valider', async () => {
    vi.mocked(api.listerAValider).mockResolvedValue([]);
    const { container } = render(<EncartValidation foyerId="foyer-1" />);
    await waitFor(() => {
      expect(api.listerAValider).toHaveBeenCalledWith('foyer-1', {
        signal: expect.anything(),
      });
    });
    expect(
      screen.queryByText(/Valider la semaine suivante/i),
    ).not.toBeInTheDocument();
    expect(container.querySelector('section')).toBeNull();
  });

  it('liste les semaines à valider avec un libellé lisible', async () => {
    vi.mocked(api.listerAValider).mockResolvedValue(A_VALIDER);
    render(<EncartValidation foyerId="foyer-1" />);

    expect(
      await screen.findByText(/Valider la semaine suivante/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Planning de la semaine 27 \(2026\)/),
    ).toBeInTheDocument();
  });

  it('valide une semaine et signale les modifications', async () => {
    vi.mocked(api.listerAValider).mockResolvedValue(A_VALIDER);
    const resultat: ValidationResultat = {
      contratId: A_VALIDER[0]!.contratId,
      semaineIso: '2026-W27',
      statut: 'VALIDEE_AVEC_MODIFS',
      deltaModifs: { jours: [{ date: '2026-07-01', avant: null, apres: {} }] },
    };
    vi.mocked(api.validerSemaine).mockResolvedValue(resultat);

    render(<EncartValidation foyerId="foyer-1" />);
    const bouton = await screen.findByRole('button', { name: 'Valider' });
    fireEvent.click(bouton);

    await waitFor(() => {
      expect(api.validerSemaine).toHaveBeenCalledWith(
        A_VALIDER[0]!.contratId,
        '2026-W27',
      );
    });
    expect(
      await screen.findByText(/validé \(avec modifications\)/i),
    ).toBeInTheDocument();
  });
});
