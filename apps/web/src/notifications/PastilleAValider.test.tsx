import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PastilleAValider } from './PastilleAValider';
import type { NotificationAValider } from '../types/bff';

vi.mock('../api/client', () => ({
  api: { listerAValider: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '../api/client';

const semaine = (semaineIso: string): NotificationAValider => ({
  contratId: '55555555-0000-4000-8000-000000000000',
  foyerId: 'foyer-1',
  semaineIso,
  statut: 'A_VALIDER',
  notifieeLe: '2026-06-23T06:00:00.000Z',
});

describe('PastilleAValider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('affiche le nombre de semaines à valider', async () => {
    vi.mocked(api.listerAValider).mockResolvedValue([
      semaine('2026-W27'),
      semaine('2026-W28'),
    ]);
    render(<PastilleAValider foyerId="foyer-1" />);

    const pastille = await screen.findByLabelText('2 semaines à valider');
    expect(pastille).toHaveTextContent('2');
  });

  it('ne rend rien quand il n’y a rien à valider', async () => {
    vi.mocked(api.listerAValider).mockResolvedValue([]);
    const { container } = render(<PastilleAValider foyerId="foyer-1" />);
    await waitFor(() => {
      expect(api.listerAValider).toHaveBeenCalled();
    });
    expect(container.querySelector('.pastille')).toBeNull();
  });
});
