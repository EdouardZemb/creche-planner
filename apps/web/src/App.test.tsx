import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// L'App utilise <BrowserRouter> ; pour piloter l'URL initiale dans les tests on le
// remplace par un <MemoryRouter> dont les entrées sont lues dans une variable
// mutable (`entrees`) positionnée avant chaque rendu.
let entrees: string[] = ['/'];
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom',
    );
  return {
    ...actual,
    BrowserRouter: ({ children }: { children: React.ReactNode }) => (
      <actual.MemoryRouter initialEntries={entrees}>
        {children}
      </actual.MemoryRouter>
    ),
  };
});

// Pages métier remplacées par des marqueurs : ce lot ne teste que la coquille.
vi.mock('./foyer/FoyerFormPage', () => ({
  FoyerFormPage: () => <div>PAGE_NOUVEAU_FOYER</div>,
}));
vi.mock('./foyer/ContratsPage', () => ({
  ContratsPage: () => <div>PAGE_CONTRATS</div>,
}));
vi.mock('./planning/PlanningPage', () => ({
  PlanningPage: () => <div>PAGE_PLANNING</div>,
}));
vi.mock('./couts/CoutsAnnuelsPage', () => ({
  CoutsAnnuelsPage: () => <div>PAGE_COUTS</div>,
}));

// Client API mocké : useFoyer (réel) s'appuie dessus pour distinguer 404 vs 5xx.
// La classe est définie DANS la factory (hoistée) pour éviter l'accès à une
// variable de module avant initialisation.
vi.mock('./api/client', () => {
  class ApiError extends Error {
    status: number;
    corps: unknown;
    constructor(status: number, corps: unknown) {
      super(`HTTP ${status}`);
      this.name = 'ApiError';
      this.status = status;
      this.corps = corps;
    }
  }
  class AuthExpiredError extends Error {
    constructor() {
      super('Session expirée, reconnectez-vous.');
      this.name = 'AuthExpiredError';
    }
  }
  return {
    api: { lireFoyer: vi.fn(), listerFoyers: vi.fn(), listerAValider: vi.fn() },
    ApiError,
    AuthExpiredError,
  };
});

// La reconnexion désenregistre le SW puis recharge la page : injoignable sous
// jsdom (location.reload non implémenté) → mockée, testée unitairement dans
// utils/reconnexion.test.ts.
vi.mock('./utils/reconnexion', () => ({
  seReconnecter: vi.fn().mockResolvedValue(undefined),
}));

import { api, ApiError, AuthExpiredError } from './api/client';
import { seReconnecter } from './utils/reconnexion';
import { App } from './App';

const mockedApi = api as unknown as {
  lireFoyer: ReturnType<typeof vi.fn>;
  listerFoyers: ReturnType<typeof vi.fn>;
  listerAValider: ReturnType<typeof vi.fn>;
};

const FOYER_ID = 'f1';
const dossierFactice = {
  foyer: { id: FOYER_ID },
  enfants: [],
};

function rendre(url: string) {
  entrees = [url];
  return render(<App />);
}

describe('App — coquille de navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockedApi.lireFoyer.mockResolvedValue(dossierFactice);
    mockedApi.listerFoyers.mockResolvedValue([]);
    // Pastille de validation (Lot 4) dans la nav : rien à valider par défaut.
    mockedApi.listerAValider.mockResolvedValue([]);
  });

  it('Accueil : un foyer mémorisé redirige vers son planning sans appel de découverte', async () => {
    localStorage.setItem('creche:foyerId', FOYER_ID);
    rendre('/');

    await screen.findByText('PAGE_PLANNING');
    expect(mockedApi.listerFoyers).not.toHaveBeenCalled();
  });

  it('Accueil : sans foyer mémorisé, un foyer découvert côté serveur ouvre son planning', async () => {
    mockedApi.listerFoyers.mockResolvedValue([{ id: FOYER_ID }]);
    rendre('/');

    await screen.findByText('PAGE_PLANNING');
    // L'appel part d'un useEffect (useFoyer) : il peut suivre de peu
    // l'apparition de la page — on attend l'appel plutôt que de l'exiger.
    await waitFor(() => {
      expect(mockedApi.lireFoyer).toHaveBeenCalledWith(
        FOYER_ID,
        expect.anything(),
      );
    });
  });

  it('Accueil : sans foyer mémorisé ni foyer existant, on propose la création', async () => {
    mockedApi.listerFoyers.mockResolvedValue([]);
    rendre('/');

    expect(await screen.findByText('PAGE_NOUVEAU_FOYER')).toBeInTheDocument();
  });

  it('Accueil : la découverte en échec retombe sur la création (jamais bloquante)', async () => {
    mockedApi.listerFoyers.mockRejectedValue(new ApiError(503, undefined));
    rendre('/');

    expect(await screen.findByText('PAGE_NOUVEAU_FOYER')).toBeInTheDocument();
  });

  it('EX-03 : une URL inconnue affiche la page 404 avec des sorties (pas de redirection muette)', () => {
    rendre('/foyer/x/planing');
    expect(screen.getByText('Page introuvable')).toBeInTheDocument();
    // Sortie propre à la 404 (« Accueil »), pas une redirection muette vers /.
    expect(screen.getByRole('link', { name: 'Accueil' })).toHaveAttribute(
      'href',
      '/',
    );
    // Le header (et la 404) exposent toujours « Nouveau foyer ».
    expect(
      screen.getAllByRole('link', { name: 'Nouveau foyer' }).length,
    ).toBeGreaterThan(0);
  });

  it('EX-04 : le lien de la page active porte aria-current="page"', async () => {
    rendre(`/foyers/${FOYER_ID}/planning`);
    await screen.findByText('PAGE_PLANNING');

    const lienPlanning = screen.getByRole('link', { name: 'Planning' });
    expect(lienPlanning).toHaveAttribute('aria-current', 'page');
    expect(lienPlanning).toHaveClass('active');

    // La marque n'est pas active sur une sous-page (NavLink end).
    const marque = screen.getByRole('link', { name: 'Crèche Planner' });
    expect(marque).not.toHaveAttribute('aria-current');
  });

  it('EX-10 : skip-link « Aller au contenu » vers #contenu et nav nommée', () => {
    rendre('/foyers/new');
    const skip = screen.getByRole('link', { name: 'Aller au contenu' });
    expect(skip).toHaveAttribute('href', '#contenu');
    expect(
      screen.getByRole('navigation', { name: 'Navigation principale' }),
    ).toBeInTheDocument();
    expect(document.querySelector('main#contenu')).not.toBeNull();
  });

  it('EX-01 CA1 : foyer 404 → EtatVide « Foyer introuvable » + CTA créer', async () => {
    mockedApi.lireFoyer.mockRejectedValueOnce(new ApiError(404, undefined));
    rendre(`/foyers/inconnu/planning`);

    expect(await screen.findByText('Foyer introuvable')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Créer un nouveau foyer' }),
    ).toHaveAttribute('href', '/foyers/new');
    expect(screen.queryByText('PAGE_PLANNING')).not.toBeInTheDocument();
  });

  it('EX-01 CA2 : foyer 404 avec foyer mémorisé → « Revenir à mon foyer »', async () => {
    localStorage.setItem('creche:foyerId', FOYER_ID);
    mockedApi.lireFoyer.mockRejectedValueOnce(new ApiError(404, undefined));
    rendre(`/foyers/inconnu/planning`);

    await screen.findByText('Foyer introuvable');
    expect(
      screen.getByRole('link', { name: 'Revenir à mon foyer' }),
    ).toHaveAttribute('href', `/foyers/${FOYER_ID}/planning`);
  });

  it('EX-01 CA3 : panne 5xx → « Service indisponible » + bouton Réessayer', async () => {
    mockedApi.lireFoyer.mockRejectedValueOnce(new ApiError(503, undefined));
    rendre(`/foyers/${FOYER_ID}/planning`);

    expect(await screen.findByText('Service indisponible')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Réessayer' }),
    ).toBeInTheDocument();
    // On ne propose pas « créer un foyer » sur une simple indisponibilité.
    expect(
      screen.queryByRole('link', { name: 'Créer un nouveau foyer' }),
    ).not.toBeInTheDocument();
  });

  it('Session Access expirée → écran « Session expirée » (pas « Service indisponible »)', async () => {
    mockedApi.lireFoyer.mockRejectedValueOnce(new AuthExpiredError());
    rendre(`/foyers/${FOYER_ID}/planning`);

    expect(await screen.findByText('Session expirée')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Se reconnecter' }),
    ).toBeInTheDocument();
    // Ni l'écran de panne ni son « Réessayer » (qui resservirait le cache),
    // ni la proposition de créer un foyer.
    expect(screen.queryByText('Service indisponible')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Réessayer' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Créer un nouveau foyer' }),
    ).not.toBeInTheDocument();
  });

  it('Session expirée : « Se reconnecter » déclenche la reconnexion réseau (seReconnecter)', async () => {
    const user = userEvent.setup();
    localStorage.setItem('creche:foyerId', FOYER_ID);
    mockedApi.lireFoyer.mockRejectedValueOnce(new AuthExpiredError());
    rendre(`/foyers/${FOYER_ID}/planning`);

    await user.click(
      await screen.findByRole('button', { name: 'Se reconnecter' }),
    );

    expect(seReconnecter).toHaveBeenCalledOnce();
    // Le foyer mémorisé n'est PAS effacé (seul « introuvable » l'efface) :
    // après reconnexion, l'accueil ramène l'utilisateur sur son foyer.
    expect(localStorage.getItem('creche:foyerId')).toBe(FOYER_ID);
  });

  it('UT-02 CA1 : après une navigation, le focus est déplacé vers <main id="contenu" tabindex="-1">', async () => {
    const user = userEvent.setup();
    rendre(`/foyers/${FOYER_ID}/planning`);
    await screen.findByText('PAGE_PLANNING');

    const main = document.querySelector('main#contenu')!;
    expect(main).not.toBeNull();
    expect(main).toHaveAttribute('tabindex', '-1');
    // Au premier rendu, le hook ne capture pas le focus (chargement initial).
    expect(main).not.toHaveFocus();

    // Navigation interne vers une autre page foyer.
    await user.click(screen.getByRole('link', { name: 'Contrats' }));
    await screen.findByText('PAGE_CONTRATS');

    expect(main).toHaveFocus();
  });

  it('UT-02 CA2 : la région live polie annonce le titre de la page après navigation', async () => {
    const user = userEvent.setup();
    rendre(`/foyers/${FOYER_ID}/planning`);
    await screen.findByText('PAGE_PLANNING');

    const region = document.querySelector('[role="status"]')!;
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    // Aucune annonce au chargement initial.
    expect(region).toHaveTextContent('');

    await user.click(screen.getByRole('link', { name: 'Coûts annuels' }));
    await screen.findByText('PAGE_COUTS');

    await waitFor(() => {
      expect(region).toHaveTextContent('Coûts annuels');
    });
  });

  it('UT-02 CA3 : le lien d’évitement « Aller au contenu » cible toujours #contenu', () => {
    rendre('/foyers/new');
    const skip = screen.getByRole('link', { name: 'Aller au contenu' });
    expect(skip).toHaveAttribute('href', '#contenu');
    const main = document.querySelector('main#contenu');
    expect(main).not.toBeNull();
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('EX-02 : le header dérive ses liens du foyerId de la route (pas de localStorage)', async () => {
    // localStorage pointe vers un autre foyer : il ne doit PAS piloter le header.
    localStorage.setItem('creche:foyerId', 'autre-foyer');
    rendre(`/foyers/${FOYER_ID}/contrats`);
    await screen.findByText('PAGE_CONTRATS');

    expect(screen.getByRole('link', { name: 'Contrats' })).toHaveAttribute(
      'href',
      `/foyers/${FOYER_ID}/contrats`,
    );
    expect(screen.getByRole('link', { name: 'Planning' })).toHaveAttribute(
      'href',
      `/foyers/${FOYER_ID}/planning`,
    );
  });
});
