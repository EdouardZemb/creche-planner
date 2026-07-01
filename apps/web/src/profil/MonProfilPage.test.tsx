import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MonProfilPage } from './MonProfilPage';
import type { MonProfilVue, PreferenceVue } from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    monProfil: vi.fn(),
    majPreferences: vi.fn(),
    modifierParent: vi.fn(),
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
  monProfil: ReturnType<typeof vi.fn>;
  majPreferences: ReturnType<typeof vi.fn>;
  modifierParent: ReturnType<typeof vi.fn>;
};

function pref(
  typeNotification: PreferenceVue['typeNotification'],
  canal: PreferenceVue['canal'],
  actif: boolean,
): PreferenceVue {
  return {
    typeNotification,
    canal,
    actif,
    consentementAt: null,
    desabonneAt: null,
  };
}

function profil(p: Partial<MonProfilVue> = {}): MonProfilVue {
  return {
    parentId: 'p1',
    foyerId: 'f1',
    email: 'moi@example.test',
    prenom: 'Alex',
    nom: 'Dupont',
    principal: true,
    preferences: [
      pref('VALIDATION_HEBDO', 'EMAIL', true),
      pref('VALIDATION_HEBDO', 'IN_APP', true),
    ],
    ...p,
  };
}

describe('MonProfilPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('affiche mes informations et mes préférences (les deux canaux cochés)', async () => {
    mockedApi.monProfil.mockResolvedValue(profil());
    render(<MonProfilPage />);

    // Bloc identité : ma ligne parent, restreinte à moi.
    expect(
      await screen.findByDisplayValue('moi@example.test'),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('Alex')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Dupont')).toBeInTheDocument();

    // Bloc notifications : les deux canaux du type de service, cochés.
    expect(screen.getByRole('checkbox', { name: 'E-mail' })).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /application/i }),
    ).toBeChecked();
  });

  it('enregistre mes informations (PUT parent, statut principal conservé)', async () => {
    mockedApi.monProfil.mockResolvedValue(profil());
    mockedApi.modifierParent.mockResolvedValue({
      id: 'p1',
      foyerId: 'f1',
      email: 'nouveau@example.test',
      prenom: 'Alex',
      nom: 'Dupont',
      principal: true,
      ordre: 0,
      actif: true,
    });
    render(<MonProfilPage />);

    fireEvent.change(await screen.findByLabelText(/Adresse e-mail/i), {
      target: { value: 'nouveau@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(mockedApi.modifierParent).toHaveBeenCalledWith('f1', 'p1', {
        email: 'nouveau@example.test',
        prenom: 'Alex',
        nom: 'Dupont',
        principal: true,
      });
    });
    expect(await screen.findByText('Profil enregistré.')).toBeInTheDocument();
  });

  it('décoche un canal et persiste la préférence', async () => {
    mockedApi.monProfil.mockResolvedValue(profil());
    mockedApi.majPreferences.mockResolvedValue([
      pref('VALIDATION_HEBDO', 'EMAIL', true),
      pref('VALIDATION_HEBDO', 'IN_APP', false),
    ]);
    render(<MonProfilPage />);

    const inApp = await screen.findByRole('checkbox', { name: /application/i });
    fireEvent.click(inApp);

    await waitFor(() => {
      expect(mockedApi.majPreferences).toHaveBeenCalledWith({
        preferences: [
          {
            typeNotification: 'VALIDATION_HEBDO',
            canal: 'IN_APP',
            actif: false,
          },
        ],
      });
    });
    expect(
      await screen.findByText('Préférences enregistrées.'),
    ).toBeInTheDocument();
  });

  it('verrouille le dernier canal actif d’un type de service', async () => {
    // Seul l'e-mail est actif → sa case est verrouillée (interdit de tout couper).
    mockedApi.monProfil.mockResolvedValue(
      profil({
        preferences: [
          pref('VALIDATION_HEBDO', 'EMAIL', true),
          pref('VALIDATION_HEBDO', 'IN_APP', false),
        ],
      }),
    );
    render(<MonProfilPage />);

    const email = await screen.findByRole('checkbox', { name: 'E-mail' });
    expect(email).toBeChecked();
    expect(email).toBeDisabled();
    expect(screen.getByText(/Dernier canal actif/i)).toBeInTheDocument();
    // La case décochée reste modifiable.
    expect(
      screen.getByRole('checkbox', { name: /application/i }),
    ).not.toBeDisabled();
  });

  it('annule le décochage et affiche un message si l’API refuse (400)', async () => {
    mockedApi.monProfil.mockResolvedValue(profil());
    mockedApi.majPreferences.mockRejectedValue(new ApiError(400, undefined));
    render(<MonProfilPage />);

    const inApp = await screen.findByRole('checkbox', { name: /application/i });
    fireEvent.click(inApp);

    // Rollback optimiste : la case redevient cochée.
    await waitFor(() => {
      expect(inApp).toBeChecked();
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /au moins un canal doit rester actif/i,
    );
  });

  it('affiche une erreur récupérable si le profil ne se charge pas', async () => {
    mockedApi.monProfil.mockRejectedValue(new ApiError(500, undefined));
    render(<MonProfilPage />);

    expect(
      await screen.findByRole('button', { name: 'Réessayer' }),
    ).toBeInTheDocument();
  });

  it('relie l’erreur de champ e-mail (400) via aria-describedby', async () => {
    mockedApi.monProfil.mockResolvedValue(profil());
    mockedApi.modifierParent.mockRejectedValue(
      new ApiError(400, [
        { champ: 'email', message: 'adresse e-mail invalide' },
      ]),
    );
    render(<MonProfilPage />);

    fireEvent.change(await screen.findByLabelText(/Adresse e-mail/i), {
      target: { value: 'nope' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

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
