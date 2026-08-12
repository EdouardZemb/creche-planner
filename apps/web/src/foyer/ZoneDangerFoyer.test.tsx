import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MOT_DE_CONFIRMATION, ZoneDangerFoyer } from './ZoneDangerFoyer';

vi.mock('../api/client', () => ({
  api: { supprimerFoyer: vi.fn() },
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

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

const recharger = vi.fn();
vi.mock('../session/MoiContext', () => ({
  useMoi: () => ({
    email: 'parent@example.test',
    admin: false,
    foyers: ['foyer-123'],
    loading: false,
    recharger,
  }),
}));

const effacerFoyerId = vi.fn();
vi.mock('../utils/store', () => ({
  effacerFoyerId: () => {
    effacerFoyerId();
  },
}));

import { api, ApiError } from '../api/client';

const mockedApi = api as unknown as {
  supprimerFoyer: ReturnType<typeof vi.fn>;
};

const FOYER_ID = 'foyer-123';

function rendre(props?: Partial<Parameters<typeof ZoneDangerFoyer>[0]>) {
  render(
    <ZoneDangerFoyer
      foyerId={FOYER_ID}
      nbEnfants={2}
      nbContrats={3}
      {...props}
    />,
  );
}

/** Ouvre la modale et recopie le mot de confirmation. */
async function ouvrirEtConfirmerLaSaisie(
  user: ReturnType<typeof userEvent.setup>,
) {
  await user.click(
    screen.getByRole('button', { name: 'Effacer cette famille' }),
  );
  await user.type(
    screen.getByLabelText(`Pour confirmer, tapez ${MOT_DE_CONFIRMATION}`),
    MOT_DE_CONFIRMATION,
  );
}

describe('ZoneDangerFoyer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.supprimerFoyer.mockResolvedValue(undefined);
  });

  it('annonce ce qui part, chiffres à l’appui, avant toute action', async () => {
    const user = userEvent.setup();
    rendre();

    await user.click(
      screen.getByRole('button', { name: 'Effacer cette famille' }),
    );

    expect(
      screen.getByText(/2 enfant\(s\), 3 contrat\(s\) de garde/),
    ).toBeInTheDocument();
  });

  it('reste muet sur les chiffres quand ils sont à zéro (rien de faux affirmé)', async () => {
    const user = userEvent.setup();
    rendre({ nbEnfants: 0, nbContrats: 0 });

    await user.click(
      screen.getByRole('button', { name: 'Effacer cette famille' }),
    );

    expect(screen.queryByText(/enfant\(s\)/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/seront effacés définitivement/),
    ).toBeInTheDocument();
  });

  it('verrouille l’action tant que le mot de confirmation n’est pas recopié', async () => {
    const user = userEvent.setup();
    rendre();

    await user.click(
      screen.getByRole('button', { name: 'Effacer cette famille' }),
    );
    const confirmer = screen.getByRole('button', {
      name: 'Effacer définitivement',
    });
    expect(confirmer).toBeDisabled();

    // Une saisie approchante ne suffit pas : la comparaison est exacte.
    await user.type(
      screen.getByLabelText(`Pour confirmer, tapez ${MOT_DE_CONFIRMATION}`),
      'supprimer',
    );
    expect(confirmer).toBeDisabled();
    expect(mockedApi.supprimerFoyer).not.toHaveBeenCalled();
  });

  it('efface, oublie le foyer mémorisé, invalide /moi puis quitte la page', async () => {
    const user = userEvent.setup();
    rendre();

    await ouvrirEtConfirmerLaSaisie(user);
    await user.click(
      screen.getByRole('button', { name: 'Effacer définitivement' }),
    );

    await waitFor(() => {
      expect(mockedApi.supprimerFoyer).toHaveBeenCalledWith(FOYER_ID);
    });
    // Sans ces deux gestes, l'en-tête et la racine continueraient de pointer
    // vers un foyer disparu jusqu'au prochain rechargement complet.
    expect(effacerFoyerId).toHaveBeenCalledTimes(1);
    expect(recharger).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/mes-foyers', { replace: true });
  });

  it('sur échec : annonce l’erreur, ne quitte pas la page et n’oublie rien', async () => {
    const user = userEvent.setup();
    mockedApi.supprimerFoyer.mockRejectedValue(new ApiError(502, null));
    rendre();

    await ouvrirEtConfirmerLaSaisie(user);
    await user.click(
      screen.getByRole('button', { name: 'Effacer définitivement' }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Service indisponible/)).toBeInTheDocument();
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(effacerFoyerId).not.toHaveBeenCalled();
    // La modale est refermée : rouvrir sur une erreur inviterait à réessayer un
    // geste qui a peut-être abouti côté serveur.
    expect(
      screen.queryByRole('button', { name: 'Effacer définitivement' }),
    ).not.toBeInTheDocument();
  });

  it('« Annuler » referme sans rien effacer et remet la saisie à zéro', async () => {
    const user = userEvent.setup();
    rendre();

    await ouvrirEtConfirmerLaSaisie(user);
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(mockedApi.supprimerFoyer).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', { name: 'Effacer cette famille' }),
    );
    expect(
      screen.getByLabelText(`Pour confirmer, tapez ${MOT_DE_CONFIRMATION}`),
    ).toHaveValue('');
  });
});
