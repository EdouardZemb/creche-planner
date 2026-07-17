import { render, screen, waitFor, within } from '@testing-library/react';
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
// Chaque marqueur pose son titre via le VRAI `useTitrePage` (comme la page réelle),
// pour que l'annonce de route — qui lit désormais le titre RÉEL de la page (Lot 2) —
// reflète l'écran affiché.
vi.mock('./foyer/FoyerFormPage', async () => {
  const { useTitrePage } = await vi.importActual<
    typeof import('./hooks/useTitrePage')
  >('./hooks/useTitrePage');
  return {
    FoyerFormPage: function FoyerFormPage() {
      useTitrePage('Créer ma famille');
      return <div>PAGE_NOUVEAU_FOYER</div>;
    },
  };
});
vi.mock('./foyer/ContratsPage', async () => {
  const { useTitrePage } = await vi.importActual<
    typeof import('./hooks/useTitrePage')
  >('./hooks/useTitrePage');
  return {
    ContratsPage: function ContratsPage() {
      useTitrePage('Contrats');
      return <div>PAGE_CONTRATS</div>;
    },
  };
});
vi.mock('./planning/PlanningPage', async () => {
  const { useTitrePage } = await vi.importActual<
    typeof import('./hooks/useTitrePage')
  >('./hooks/useTitrePage');
  return {
    PlanningPage: function PlanningPage() {
      useTitrePage('Planning');
      return <div>PAGE_PLANNING</div>;
    },
  };
});
vi.mock('./dashboard/DashboardJourPage', async () => {
  const { useTitrePage } = await vi.importActual<
    typeof import('./hooks/useTitrePage')
  >('./hooks/useTitrePage');
  return {
    DashboardJourPage: function DashboardJourPage() {
      useTitrePage('Aujourd’hui');
      return <div>PAGE_DASHBOARD</div>;
    },
  };
});
vi.mock('./couts/CoutsAnnuelsPage', async () => {
  const { useTitrePage } = await vi.importActual<
    typeof import('./hooks/useTitrePage')
  >('./hooks/useTitrePage');
  return {
    CoutsAnnuelsPage: function CoutsAnnuelsPage() {
      useTitrePage('Coûts annuels');
      return <div>PAGE_COUTS</div>;
    },
  };
});

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
    api: {
      lireFoyer: vi.fn(),
      listerFoyers: vi.fn(),
      listerAValider: vi.fn(),
      listerNotifications: vi.fn(),
      moi: vi.fn(),
    },
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
  listerNotifications: ReturnType<typeof vi.fn>;
  moi: ReturnType<typeof vi.fn>;
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
    // Cloche in-app (PR6) : inbox vide par défaut (rendue quand une identité existe).
    mockedApi.listerNotifications.mockResolvedValue({
      notifications: [],
      nonLus: 0,
    });
    // Par défaut : aucune identité (mode hérité) + admin permissif → la prod
    // actuelle / les tests historiques conservent leur comportement.
    mockedApi.moi.mockResolvedValue({ email: null, admin: true, foyers: [] });
  });

  it('Accueil : un foyer mémorisé redirige vers son tableau de bord sans appel de découverte', async () => {
    localStorage.setItem('creche:foyerId', FOYER_ID);
    rendre('/');

    await screen.findByText('PAGE_DASHBOARD');
    expect(mockedApi.listerFoyers).not.toHaveBeenCalled();
  });

  it('Accueil : sans foyer mémorisé, un foyer découvert côté serveur ouvre son tableau de bord', async () => {
    mockedApi.listerFoyers.mockResolvedValue([{ id: FOYER_ID }]);
    rendre('/');

    await screen.findByText('PAGE_DASHBOARD');
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
      screen.getAllByRole('link', { name: 'Nouvelle famille' }).length,
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

    expect(await screen.findByText('Famille introuvable')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Créer une nouvelle famille' }),
    ).toHaveAttribute('href', '/foyers/new');
    expect(screen.queryByText('PAGE_PLANNING')).not.toBeInTheDocument();
  });

  it('EX-01 CA2 : foyer 404 avec foyer mémorisé → « Revenir à mon foyer »', async () => {
    localStorage.setItem('creche:foyerId', FOYER_ID);
    mockedApi.lireFoyer.mockRejectedValueOnce(new ApiError(404, undefined));
    rendre(`/foyers/inconnu/planning`);

    await screen.findByText('Famille introuvable');
    expect(
      screen.getByRole('link', { name: 'Revenir à ma famille' }),
    ).toHaveAttribute('href', `/foyers/${FOYER_ID}/dashboard`);
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
      screen.queryByRole('link', { name: 'Créer une nouvelle famille' }),
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
      screen.queryByRole('link', { name: 'Créer une nouvelle famille' }),
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

  it('UT-02 (swap tardif) : un foyer 404 à l’URL /dashboard annonce « Famille introuvable » (pas « Aujourd’hui »)', async () => {
    mockedApi.lireFoyer.mockRejectedValueOnce(new ApiError(404, undefined));
    rendre(`/foyers/inconnu/dashboard`);

    // L'écran de récupération remplace l'Outlet AU MÊME chemin : l'annonce doit
    // suivre le titre RÉELLEMENT affiché, pas le titre dérivé du pathname.
    await screen.findByText('Famille introuvable');
    const region = screen.getByTestId('annonce-route');
    await waitFor(() => {
      expect(region).toHaveTextContent('Famille introuvable');
    });
    // document.title et annonce concordent.
    expect(document.title).toBe('Famille introuvable — Crèche Planner');
  });

  it('UT-02 CA3 : le lien d’évitement « Aller au contenu » cible toujours #contenu', () => {
    rendre('/foyers/new');
    const skip = screen.getByRole('link', { name: 'Aller au contenu' });
    expect(skip).toHaveAttribute('href', '#contenu');
    const main = document.querySelector('main#contenu');
    expect(main).not.toBeNull();
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('Nav mobile : « Plus » regroupe les pages de gestion en disclosure (aria-expanded/aria-controls)', async () => {
    const user = userEvent.setup();
    rendre(`/foyers/${FOYER_ID}/planning`);
    await screen.findByText('PAGE_PLANNING');

    const bouton = screen.getByRole('button', { name: 'Plus' });
    expect(bouton).toHaveAttribute('aria-expanded', 'false');
    const idPanneau = bouton.getAttribute('aria-controls')!;
    const panneau = document.getElementById(idPanneau)!;
    expect(panneau).not.toBeNull();
    // Les pages de gestion vivent dans le panneau…
    expect(
      within(panneau).getByRole('link', { name: 'Contrats' }),
    ).toBeInTheDocument();
    expect(
      within(panneau).getByRole('link', { name: 'Crèches & écoles' }),
    ).toBeInTheDocument();
    expect(
      within(panneau).getByRole('link', { name: 'Ma famille' }),
    ).toBeInTheDocument();
    // … pas les destinations quotidiennes (elles forment la barre d'onglets).
    expect(
      within(panneau).queryByRole('link', { name: 'Planning' }),
    ).not.toBeInTheDocument();
    expect(panneau).not.toHaveClass('ouvert');

    await user.click(bouton);
    expect(bouton).toHaveAttribute('aria-expanded', 'true');
    expect(panneau).toHaveClass('ouvert');

    // Naviguer depuis le panneau le referme (mobile : il masquerait la page).
    await user.click(within(panneau).getByRole('link', { name: 'Contrats' }));
    await screen.findByText('PAGE_CONTRATS');
    expect(bouton).toHaveAttribute('aria-expanded', 'false');
    expect(panneau).not.toHaveClass('ouvert');
  });

  it('Nav : « Coûts annuels » garde son nom accessible malgré le libellé court d’onglet', async () => {
    rendre(`/foyers/${FOYER_ID}/planning`);
    await screen.findByText('PAGE_PLANNING');

    expect(screen.getByRole('link', { name: 'Coûts annuels' })).toHaveAttribute(
      'href',
      `/foyers/${FOYER_ID}/couts`,
    );
  });

  it('La cloche de notifications vit dans l’en-tête, HORS de la navigation principale', async () => {
    mockedApi.moi.mockResolvedValue({
      email: 'parent@test.fr',
      admin: false,
      foyers: [FOYER_ID],
    });
    rendre(`/foyers/${FOYER_ID}/planning`);
    await screen.findByText('PAGE_PLANNING');

    const cloche = await screen.findByRole('button', {
      name: 'Notifications',
    });
    const nav = screen.getByRole('navigation', {
      name: 'Navigation principale',
    });
    expect(nav).not.toContainElement(cloche);
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

describe('App — mode borné par identité (PR6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockedApi.lireFoyer.mockResolvedValue(dossierFactice);
    mockedApi.listerFoyers.mockResolvedValue([]);
    mockedApi.listerAValider.mockResolvedValue([]);
  });

  it('identité + 1 foyer autorisé : ouvre directement son tableau de bord (sans découverte)', async () => {
    mockedApi.moi.mockResolvedValue({
      email: 'parent@test.fr',
      admin: false,
      foyers: [FOYER_ID],
    });
    rendre('/');

    await screen.findByText('PAGE_DASHBOARD');
    // Le foyer découle de l'identité, pas de listerFoyers (découverte héritée).
    expect(mockedApi.listerFoyers).not.toHaveBeenCalled();
  });

  it('identité + 0 foyer : écran « créer mon foyer » (self-service, P5)', async () => {
    mockedApi.moi.mockResolvedValue({
      email: 'inconnu@test.fr',
      admin: false,
      foyers: [],
    });
    rendre('/');

    expect(
      await screen.findByText('Vous n’avez pas encore créé votre famille'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Créer ma famille' }),
    ).toHaveAttribute('href', '/foyers/new');
    // La page de création n'est pas rendue d'office : elle suit un clic.
    expect(screen.queryByText('PAGE_NOUVEAU_FOYER')).not.toBeInTheDocument();
  });

  it('identité + N foyers : le sélecteur nomme chaque famille par ses enfants', async () => {
    mockedApi.moi.mockResolvedValue({
      email: 'parent@test.fr',
      admin: false,
      foyers: [FOYER_ID, 'f2'],
    });
    mockedApi.lireFoyer.mockImplementation((id: string) =>
      id === FOYER_ID
        ? Promise.resolve({
            foyer: { id: FOYER_ID },
            enfants: [{ prenom: 'Léa' }, { prenom: 'Noé' }],
            parents: [],
          })
        : Promise.resolve({
            foyer: { id: 'f2' },
            enfants: [{ prenom: 'Tom' }],
            parents: [],
          }),
    );
    rendre('/');

    expect(await screen.findByText('Choisir une famille')).toBeInTheDocument();
    // Chaque carte est un lien nommé par les prénoms (Intl.ListFormat 'fr').
    const lea = await screen.findByRole('link', {
      name: 'Famille de Léa et Noé',
    });
    expect(lea).toHaveAttribute('href', `/foyers/${FOYER_ID}/dashboard`);
    const tom = screen.getByRole('link', { name: 'Famille de Tom' });
    expect(tom).toHaveAttribute('href', '/foyers/f2/dashboard');
    // Plus aucun libellé ordinal (« Ouvrir la famille 1/2 »).
    expect(screen.queryByText(/Ouvrir la famille/)).not.toBeInTheDocument();
    // Vraie liste sémantique (ul/li).
    expect(lea.closest('li')).not.toBeNull();
  });

  it('N foyers sans enfant : le libellé retombe sur le parent principal (nom, puis e-mail)', async () => {
    mockedApi.moi.mockResolvedValue({
      email: 'parent@test.fr',
      admin: false,
      foyers: [FOYER_ID, 'f2'],
    });
    mockedApi.lireFoyer.mockImplementation((id: string) =>
      id === FOYER_ID
        ? Promise.resolve({
            foyer: { id: FOYER_ID },
            enfants: [],
            parents: [
              {
                prenom: 'Marie',
                nom: 'Curie',
                email: 'marie@test.fr',
                principal: true,
              },
            ],
          })
        : Promise.resolve({
            foyer: { id: 'f2' },
            enfants: [],
            parents: [
              {
                prenom: null,
                nom: null,
                email: 'jean@test.fr',
                principal: true,
              },
            ],
          }),
    );
    rendre('/');

    expect(
      await screen.findByRole('link', { name: 'Famille Marie Curie' }),
    ).toHaveAttribute('href', `/foyers/${FOYER_ID}/dashboard`);
    // Parent sans prénom/nom : repli sur l'e-mail, jamais un ordinal.
    expect(screen.getByRole('link', { name: 'jean@test.fr' })).toHaveAttribute(
      'href',
      '/foyers/f2/dashboard',
    );
  });

  it('N foyers : un dossier en échec dégrade sa seule carte sans masquer les autres', async () => {
    mockedApi.moi.mockResolvedValue({
      email: 'parent@test.fr',
      admin: false,
      foyers: [FOYER_ID, 'f2'],
    });
    mockedApi.lireFoyer.mockImplementation((id: string) =>
      id === FOYER_ID
        ? Promise.resolve({
            foyer: { id: FOYER_ID },
            enfants: [{ prenom: 'Léa' }],
            parents: [],
          })
        : Promise.reject(new ApiError(503, undefined)),
    );
    rendre('/');

    // La famille chargée reste lisible…
    expect(
      await screen.findByRole('link', { name: 'Famille de Léa' }),
    ).toHaveAttribute('href', `/foyers/${FOYER_ID}/dashboard`);
    // … et la carte en échec offre un repli cliquable (jamais bloquant).
    expect(
      screen.getByRole('link', { name: 'Ouvrir cette famille' }),
    ).toHaveAttribute('href', '/foyers/f2/dashboard');
  });

  it('N foyers : tous les dossiers en échec → EtatVide « Réessayer »', async () => {
    mockedApi.moi.mockResolvedValue({
      email: 'parent@test.fr',
      admin: false,
      foyers: [FOYER_ID, 'f2'],
    });
    mockedApi.lireFoyer.mockRejectedValue(new ApiError(503, undefined));
    rendre('/');

    expect(
      await screen.findByText('Impossible de charger vos familles'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Réessayer' }),
    ).toBeInTheDocument();
    // Aucune carte de famille n'est rendue quand tout échoue.
    expect(
      screen.queryByRole('link', { name: 'Ouvrir cette famille' }),
    ).not.toBeInTheDocument();
  });

  it('cache localStorage hors ensemble autorisé : ignoré (plus une source de vérité)', async () => {
    localStorage.setItem('creche:foyerId', 'foyer-non-autorise');
    mockedApi.moi.mockResolvedValue({
      email: 'parent@test.fr',
      admin: false,
      foyers: [FOYER_ID],
    });
    rendre('/');

    // Le cache forgé est ignoré → on ouvre le seul foyer autorisé, pas le cache.
    await screen.findByText('PAGE_DASHBOARD');
    await waitFor(() => {
      expect(mockedApi.lireFoyer).toHaveBeenCalledWith(
        FOYER_ID,
        expect.anything(),
      );
    });
    expect(mockedApi.lireFoyer).not.toHaveBeenCalledWith(
      'foyer-non-autorise',
      expect.anything(),
    );
  });

  it('non-admin : le lien « Nouveau foyer » disparaît de l’en-tête', async () => {
    mockedApi.moi.mockResolvedValue({
      email: 'parent@test.fr',
      admin: false,
      foyers: [FOYER_ID],
    });
    rendre(`/foyers/${FOYER_ID}/planning`);
    await screen.findByText('PAGE_PLANNING');

    expect(
      screen.queryByRole('link', { name: 'Nouvelle famille' }),
    ).not.toBeInTheDocument();
  });

  it('admin : le lien « Nouveau foyer » reste présent', async () => {
    mockedApi.moi.mockResolvedValue({
      email: 'admin@test.fr',
      admin: true,
      foyers: [FOYER_ID],
    });
    rendre(`/foyers/${FOYER_ID}/planning`);
    await screen.findByText('PAGE_PLANNING');

    expect(
      screen.getByRole('link', { name: 'Nouvelle famille' }),
    ).toBeInTheDocument();
  });

  it('P5 : non-admin SANS foyer garde « Nouveau foyer » (1ʳᵉ création self-service)', async () => {
    mockedApi.moi.mockResolvedValue({
      email: 'parent@test.fr',
      admin: false,
      foyers: [],
    });
    mockedApi.listerFoyers.mockResolvedValue([{ id: FOYER_ID }]);
    rendre(`/foyers/${FOYER_ID}/planning`);
    await screen.findByText('PAGE_PLANNING');

    expect(
      screen.getByRole('link', { name: 'Nouvelle famille' }),
    ).toBeInTheDocument();
  });

  it('P5 : hors contexte foyer, « Modifier mon foyer » mène à l’édition de son foyer', async () => {
    mockedApi.moi.mockResolvedValue({
      email: 'parent@test.fr',
      admin: false,
      foyers: [FOYER_ID],
    });
    // Page 404 (hors /foyers/:id) : le raccourci d'en-tête doit apparaître.
    rendre('/page-inconnue');

    // On vise l'en-tête (la page 404 porte son propre CTA « Nouveau foyer »).
    const nav = await screen.findByRole('navigation', {
      name: 'Navigation principale',
    });
    const lien = within(nav).getByRole('link', { name: 'Voir ma famille' });
    expect(lien).toHaveAttribute('href', `/foyers/${FOYER_ID}/modifier`);
    // Dans l'en-tête, « Nouveau foyer » est masqué (create-once, non-admin).
    expect(
      within(nav).queryByRole('link', { name: 'Nouvelle famille' }),
    ).not.toBeInTheDocument();
  });
});
