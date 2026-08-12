import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ExportDonneesFoyer, nomFichierExport } from './ExportDonneesFoyer';

vi.mock('../api/client', () => ({
  api: { exporterFoyer: vi.fn() },
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

const telechargerJson = vi.fn();
vi.mock('../utils/telechargement', () => ({
  telechargerJson: (nom: string, valeur: unknown) => {
    telechargerJson(nom, valeur);
  },
}));

import { api } from '../api/client';

const mockedApi = api as unknown as {
  exporterFoyer: ReturnType<typeof vi.fn>;
};

const FOYER_ID = 'abcd1234-0000-4000-8000-000000000000';

const DOCUMENT = {
  versionFormat: 1,
  genereLe: '2026-08-12T06:30:00.000Z',
  foyerId: FOYER_ID,
  situationFoyer: { parents: [{ email: 'alex@example.test' }] },
  gardeEtPlanning: { contrats: [], etablissements: [] },
  communications: { messagesInApp: [] },
};

describe('ExportDonneesFoyer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Un export dont on ne sait pas ce qu'il contient n'est pas un droit exercé,
  // c'est un fichier : le contenu est annoncé AVANT le clic.
  it('annonce ce que le fichier contient avant tout téléchargement', () => {
    render(<ExportDonneesFoyer foyerId={FOYER_ID} />);

    expect(
      screen.getByRole('heading', { level: 2, name: /Récupérer vos données/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/plannings saisis/i)).toBeInTheDocument();
    expect(screen.getByText(/format JSON/i)).toBeInTheDocument();
    expect(mockedApi.exporterFoyer).not.toHaveBeenCalled();
  });

  it('télécharge le document rendu par la passerelle, tel quel', async () => {
    mockedApi.exporterFoyer.mockResolvedValue(DOCUMENT);
    const utilisateur = userEvent.setup();
    render(<ExportDonneesFoyer foyerId={FOYER_ID} />);

    await utilisateur.click(
      screen.getByRole('button', { name: 'Télécharger mes données' }),
    );

    await waitFor(() => {
      expect(telechargerJson).toHaveBeenCalledWith(
        'donnees-foyer-abcd1234-2026-08-12.json',
        DOCUMENT,
      );
    });
    expect(mockedApi.exporterFoyer).toHaveBeenCalledWith(FOYER_ID);
  });

  // Le point de conception du lot, vu depuis l'écran : la passerelle refuse de
  // livrer un export amputé. L'échec doit donc rester VISIBLE — un fichier
  // partiel téléchargé en silence serait pire que pas de fichier du tout.
  it('affiche l’échec et ne télécharge RIEN quand la passerelle refuse', async () => {
    mockedApi.exporterFoyer.mockRejectedValue(new Error('service injoignable'));
    const utilisateur = userEvent.setup();
    render(<ExportDonneesFoyer foyerId={FOYER_ID} />);

    await utilisateur.click(
      screen.getByRole('button', { name: 'Télécharger mes données' }),
    );

    await waitFor(() => {
      expect(screen.getByText(/service injoignable/i)).toBeInTheDocument();
    });
    expect(telechargerJson).not.toHaveBeenCalled();
  });

  it('réarme le bouton après un échec, pour permettre un second essai', async () => {
    mockedApi.exporterFoyer.mockRejectedValue(new Error('service injoignable'));
    const utilisateur = userEvent.setup();
    render(<ExportDonneesFoyer foyerId={FOYER_ID} />);
    const bouton = screen.getByRole('button', {
      name: 'Télécharger mes données',
    });

    await utilisateur.click(bouton);

    await waitFor(() => {
      expect(bouton).not.toBeDisabled();
    });
  });
});

describe('nomFichierExport', () => {
  it('date le fichier avec l’instant de production du document', () => {
    expect(nomFichierExport(FOYER_ID, '2026-08-12T06:30:00.000Z')).toBe(
      'donnees-foyer-abcd1234-2026-08-12.json',
    );
  });

  // Un nom de fichier circule : dossier de téléchargement, pièce jointe,
  // capture d'écran. Il n'a pas à porter l'identifiant complet du foyer.
  it('ne porte jamais l’identifiant complet du foyer', () => {
    expect(
      nomFichierExport(FOYER_ID, '2026-08-12T06:30:00.000Z'),
    ).not.toContain(FOYER_ID);
  });
});
