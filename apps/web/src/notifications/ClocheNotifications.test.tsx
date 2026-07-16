import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
    sujet: 'Planning de la semaine du 29 juin au 5 juillet 2026 à valider',
    corps:
      'Le planning de Léa pour la semaine du 29 juin au 5 juillet 2026 est à valider.',
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
      screen.getByText(
        'Planning de la semaine du 29 juin au 5 juillet 2026 à valider',
      ),
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

  const LIEN = '/foyers/foyer-1/planning?semaine=2026-W27';

  it('notification avec lien : carte tapable qui mène à l’éditeur, marque lu et ferme le panneau', async () => {
    mockedApi.listerNotifications.mockResolvedValue(
      inbox({ notifications: [notif({ lien: LIEN })] }),
    );
    mockedApi.marquerNotificationLue.mockResolvedValue(
      notif({ lien: LIEN, luLe: '2026-06-24T10:00:00.000Z' }),
    );
    render(
      <MemoryRouter>
        <ClocheNotifications />
      </MemoryRouter>,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: /notifications/i }),
    );

    // Carte entièrement tapable (un lien), pointant vers l'éditeur de la semaine.
    const carte = screen.getByRole('link');
    expect(carte).toHaveAttribute('href', LIEN);
    expect(carte).toHaveTextContent(
      'Planning de la semaine du 29 juin au 5 juillet 2026 à valider',
    );
    // Pas de bouton « Marquer comme lu » : le tap vaut accusé de lecture.
    expect(
      screen.queryByRole('button', { name: 'Marquer comme lu' }),
    ).not.toBeInTheDocument();

    fireEvent.click(carte);

    // Accusé de lecture fire-and-forget déclenché par le tap.
    await waitFor(() => {
      expect(mockedApi.marquerNotificationLue).toHaveBeenCalledWith('n1');
    });
    // Le panneau se ferme à la navigation (le titre du panneau disparaît).
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: 'Notifications' }),
      ).not.toBeInTheDocument();
    });
  });

  it('notification lue avec lien : le tap navigue sans réémettre d’accusé de lecture', async () => {
    mockedApi.listerNotifications.mockResolvedValue(
      inbox({
        nonLus: 0,
        notifications: [
          notif({ lien: LIEN, luLe: '2026-06-24T10:00:00.000Z' }),
        ],
      }),
    );
    render(
      <MemoryRouter>
        <ClocheNotifications />
      </MemoryRouter>,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: /notifications/i }),
    );
    fireEvent.click(screen.getByRole('link'));

    // Déjà lue : aucun accusé de lecture superflu (garde `luLe === null`).
    expect(mockedApi.marquerNotificationLue).not.toHaveBeenCalled();
  });

  it('état chargement : le panneau ouvert montre le spinner', async () => {
    // Requête qui ne résout jamais : le panneau reste en chargement.
    mockedApi.listerNotifications.mockReturnValue(new Promise(() => undefined));
    render(<ClocheNotifications />);

    fireEvent.click(
      await screen.findByRole('button', { name: /notifications/i }),
    );

    expect(
      screen.getByText('Chargement des notifications…'),
    ).toBeInTheDocument();
  });

  it('état erreur : message + « Réessayer » qui recharge la liste', async () => {
    mockedApi.listerNotifications
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockResolvedValue(inbox());
    render(<ClocheNotifications />);

    fireEvent.click(
      await screen.findByRole('button', { name: /notifications/i }),
    );

    // Panneau ouvert sur l'état erreur (data === null).
    expect(
      await screen.findByText('Notifications indisponibles'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    // La relance charge la liste : la notification apparaît.
    expect(
      await screen.findByText(
        'Planning de la semaine du 29 juin au 5 juillet 2026 à valider',
      ),
    ).toBeInTheDocument();
  });

  it('état vide : message rassurant, aucune notification', async () => {
    mockedApi.listerNotifications.mockResolvedValue(
      inbox({ nonLus: 0, notifications: [] }),
    );
    render(<ClocheNotifications />);

    fireEvent.click(
      await screen.findByRole('button', { name: /notifications/i }),
    );

    expect(await screen.findByText('Aucune notification')).toBeInTheDocument();
    expect(
      screen.getByText(/rien de nouveau pour le moment/i),
    ).toBeInTheDocument();
  });

  it('horodatage : date ET heure (UTC) de la notification', async () => {
    mockedApi.listerNotifications.mockResolvedValue(inbox());
    render(<ClocheNotifications />);

    fireEvent.click(
      await screen.findByRole('button', { name: /notifications/i }),
    );

    // creeLe '2026-06-23T06:01:00.000Z' → « 23/06/2026 à 06:01 ».
    expect(screen.getByText('23/06/2026 à 06:01')).toBeInTheDocument();
  });

  it('indice « N sur M » quand le total dépasse les notifications affichées', async () => {
    mockedApi.listerNotifications.mockResolvedValue(
      inbox({ nonLus: 5, notifications: [notif()] }),
    );
    render(<ClocheNotifications />);

    fireEvent.click(
      await screen.findByRole('button', { name: /notifications/i }),
    );

    expect(screen.getByText(/5 non lues au total/i)).toBeInTheDocument();
  });

  it('« Tout marquer comme lu » : rejoue l’accusé sur les non-lus visibles puis resync', async () => {
    mockedApi.listerNotifications
      .mockResolvedValueOnce(
        inbox({
          nonLus: 2,
          notifications: [notif({ id: 'n1' }), notif({ id: 'n2' })],
        }),
      )
      .mockResolvedValue(
        inbox({
          nonLus: 0,
          notifications: [
            notif({ id: 'n1', luLe: '2026-06-24T10:00:00.000Z' }),
            notif({ id: 'n2', luLe: '2026-06-24T10:00:00.000Z' }),
          ],
        }),
      );
    mockedApi.marquerNotificationLue.mockResolvedValue(
      notif({ luLe: '2026-06-24T10:00:00.000Z' }),
    );
    render(<ClocheNotifications />);

    fireEvent.click(
      await screen.findByRole('button', { name: /notifications/i }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Tout marquer comme lu' }),
    );

    // Un accusé idempotent par non-lu visible (n1 et n2).
    await waitFor(() => {
      expect(mockedApi.marquerNotificationLue).toHaveBeenCalledWith('n1');
      expect(mockedApi.marquerNotificationLue).toHaveBeenCalledWith('n2');
    });
    // Après resync : plus de bouton « Tout marquer comme lu » (tout est lu).
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Tout marquer comme lu' }),
      ).not.toBeInTheDocument();
    });
  });

  it('fermeture par Échap : le panneau se ferme et le déclencheur reprend aria-expanded=false', async () => {
    mockedApi.listerNotifications.mockResolvedValue(inbox());
    render(<ClocheNotifications />);

    const bouton = await screen.findByRole('button', {
      name: /notifications/i,
    });
    fireEvent.click(bouton);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(bouton).toHaveAttribute('aria-expanded', 'false');
  });
});
