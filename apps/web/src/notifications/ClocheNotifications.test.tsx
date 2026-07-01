import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ClocheNotifications } from './ClocheNotifications';
import type { InboxVue, NotificationInApp } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    listerNotifications: vi.fn(),
    marquerNotificationLue: vi.fn(),
  },
  // `useAsync` traduit les erreurs via `messageErreur`, qui teste `instanceof
  // ApiError` : le mock doit exposer la classe (sinon `instanceof undefined`).
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
  listerNotifications: ReturnType<typeof vi.fn>;
  marquerNotificationLue: ReturnType<typeof vi.fn>;
};

function notif(p: Partial<NotificationInApp> = {}): NotificationInApp {
  return {
    id: 'n1',
    type: 'VALIDATION_HEBDO',
    sujet: 'Planning de la semaine 2026-W27 à valider',
    corps: 'Le planning de Léa pour la semaine 2026-W27 est à valider.',
    creeLe: '2026-06-23T06:01:00.000Z',
    luLe: null,
    ...p,
  };
}

function inbox(p: Partial<InboxVue> = {}): InboxVue {
  return { notifications: [notif()], nonLus: 1, ...p };
}

describe('ClocheNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('affiche le compteur de non-lus dans le libellé de la cloche', async () => {
    mockedApi.listerNotifications.mockResolvedValue(inbox({ nonLus: 3 }));
    render(<ClocheNotifications />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /3 non lues/i }),
      ).toBeInTheDocument();
    });
  });

  it('sans non-lu : libellé neutre « Notifications » (compteur masqué)', async () => {
    mockedApi.listerNotifications.mockResolvedValue(
      inbox({
        nonLus: 0,
        notifications: [notif({ luLe: '2026-06-24T10:00:00.000Z' })],
      }),
    );
    render(<ClocheNotifications />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Notifications' }),
      ).toBeInTheDocument();
    });
  });

  it('ouvre le panneau et liste les notifications au clic', async () => {
    mockedApi.listerNotifications.mockResolvedValue(inbox());
    render(<ClocheNotifications />);

    const bouton = await screen.findByRole('button', {
      name: /notifications/i,
    });
    fireEvent.click(bouton);

    expect(
      screen.getByText('Planning de la semaine 2026-W27 à valider'),
    ).toBeInTheDocument();
    expect(bouton).toHaveAttribute('aria-expanded', 'true');
  });

  it('marque une notification comme lue et recharge (compteur resync)', async () => {
    mockedApi.listerNotifications
      .mockResolvedValueOnce(inbox({ nonLus: 1 }))
      .mockResolvedValue(
        inbox({
          nonLus: 0,
          notifications: [notif({ luLe: '2026-06-24T10:00:00.000Z' })],
        }),
      );
    mockedApi.marquerNotificationLue.mockResolvedValue(
      notif({ luLe: '2026-06-24T10:00:00.000Z' }),
    );
    render(<ClocheNotifications />);

    fireEvent.click(
      await screen.findByRole('button', { name: /notifications/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Marquer comme lu' }));

    await waitFor(() => {
      expect(mockedApi.marquerNotificationLue).toHaveBeenCalledWith('n1');
    });
    // Après resync : plus de bouton « Marquer comme lu » (notification lue).
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Marquer comme lu' }),
      ).not.toBeInTheDocument();
    });
  });

  it('journal informationnel : ne duplique PAS l’action « Valider »', async () => {
    mockedApi.listerNotifications.mockResolvedValue(inbox());
    render(<ClocheNotifications />);

    fireEvent.click(
      await screen.findByRole('button', { name: /notifications/i }),
    );

    // Le panneau archive la notification mais ne propose aucune action de validation
    // (celle-ci reste la source de vérité de l'encart A_VALIDER du planning).
    expect(
      screen.queryByRole('button', { name: /valider/i }),
    ).not.toBeInTheDocument();
  });

  it('panne / absence de ligne parent : cloche sans compteur, pas d’erreur', async () => {
    mockedApi.listerNotifications.mockRejectedValue(new Error('HTTP 404'));
    render(<ClocheNotifications />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Notifications' }),
      ).toBeInTheDocument();
    });
  });
});
