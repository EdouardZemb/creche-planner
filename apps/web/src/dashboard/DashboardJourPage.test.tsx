import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { jourCourantParis } from '@creche-planner/shared-semaine';
import { DashboardJourPage } from './DashboardJourPage';
import type {
  CoutMoisVue,
  NotificationAValider,
  PlageHoraire,
  SemaineBesoins,
  SemaineTypeCreche,
} from '../types/bff';

vi.mock('../api/client', () => ({
  api: {
    lireSemaineBesoins: vi.fn(),
    lireCoutMois: vi.fn(),
    listerAValider: vi.fn(),
  },
  // `messageErreur` (utils/erreurs) teste `e instanceof ApiError` : le mock doit
  // exposer la classe, sinon le chemin d'erreur lève « No ApiError export ».
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

const FOYER_ID = 'foyer-1';

// Semaine-type couvrant les 7 jours : quel que soit le jour réel du run, le
// contrat est « gardé » aujourd'hui (le test ne dépend pas du calendrier).
const PLAGE: PlageHoraire = {
  debutHeures: 8,
  debutMinutes: 30,
  finHeures: 17,
  finMinutes: 0,
};
const SEMAINE_TYPE: SemaineTypeCreche = {
  LUNDI: [PLAGE],
  MARDI: [PLAGE],
  MERCREDI: [PLAGE],
  JEUDI: [PLAGE],
  VENDREDI: [PLAGE],
  SAMEDI: [PLAGE],
  DIMANCHE: [PLAGE],
};

const semaineAvecGarde: SemaineBesoins = {
  semaineIso: '2026-W27',
  jours: [],
  etablissements: [
    { etablissementId: 'e1', libelle: 'Crèche du parc', preavisRegle: null },
  ],
  contrats: [
    {
      contratId: 'c1',
      enfant: 'Léa',
      mode: 'CRECHE_PSU',
      etablissementId: 'e1',
      besoins: {},
      semaineType: SEMAINE_TYPE,
    },
  ],
};

const semaineVide: SemaineBesoins = {
  semaineIso: '2026-W27',
  jours: [],
  etablissements: [],
  contrats: [],
};

// Semaine notifiée en attente de validation (carte « semaine à valider », lot 1 UX).
const aValider = (
  semaineIso: string,
  contratId = 'c1',
): NotificationAValider => ({
  contratId,
  foyerId: FOYER_ID,
  semaineIso,
  statut: 'A_VALIDER',
  notifieeLe: '2026-06-30T06:00:00Z',
  enfant: 'Léa',
  mode: 'CRECHE_PSU',
});

// Coût mensuel réel servi au bandeau « coût du mois » (P3c).
const coutMois = {
  foyerId: FOYER_ID,
  mois: '2026-07',
  simule: false,
  totalCentimes: 85116,
  prestations: [],
  lignes: [],
} as CoutMoisVue;

function renderPage(foyerId = FOYER_ID) {
  return render(
    <MemoryRouter initialEntries={[`/foyers/${foyerId}/dashboard`]}>
      <Routes>
        <Route
          path="/foyers/:foyerId/dashboard"
          element={<DashboardJourPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DashboardJourPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Le bandeau « coût du mois » (P3c) est secondaire : par défaut on sert un
    // coût valide pour qu'il ne pollue pas les autres cas (il s'efface seul si
    // l'appel échoue / charge).
    vi.mocked(api.lireCoutMois).mockResolvedValue(coutMois);
    // Rien à valider par défaut : la carte « semaine à valider » reste muette
    // dans les cas qui ne la concernent pas.
    vi.mocked(api.listerAValider).mockResolvedValue([]);
  });

  it('affiche le chargement initialement', () => {
    vi.mocked(api.lireSemaineBesoins).mockReturnValue(
      new Promise(() => undefined),
    );

    renderPage();

    expect(
      screen.getByText(/Chargement de votre journée/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: /Aujourd/i }),
    ).toBeInTheDocument();
  });

  it('liste les gardes du jour avec un lien « Modifier » deep-linké vers le contrat (P3a)', async () => {
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(semaineAvecGarde);

    renderPage();

    // La semaine-type couvre 7 j : Léa apparaît aussi dans la section « Demain »
    // (lot 2 UX) → sélecteurs pluriels + nom accessible EXACT pour le lien du jour.
    await screen.findAllByText('Léa');
    expect(
      screen.getAllByText('Crèche du parc', { exact: false }).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/Gardé/).length).toBeGreaterThan(0);

    // P3a : « Modifier » ouvre le planning directement sur l'onglet enfant + le
    // sous-onglet mode de cette garde, au mois du jour affiché (params lus par
    // PlanningPage), au lieu du planning générique.
    const lien = screen.getByRole('link', {
      name: 'Modifier la garde de Léa',
    });
    const url = new URL(lien.getAttribute('href')!, 'http://x');
    expect(url.pathname).toBe(`/foyers/${FOYER_ID}/planning`);
    expect(url.searchParams.get('enfant')).toBe('Léa');
    expect(url.searchParams.get('mode')).toBe('CRECHE_PSU');
    expect(url.searchParams.get('mois')).toBe(
      jourCourantParis(new Date()).slice(0, 7),
    );
    // Le titre d'onglet reflète la page (EX-05).
    expect(document.title).toMatch(/Aujourd/);
  });

  it('état vide : « Aucune garde prévue » + lien vers le planning', async () => {
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(semaineVide);

    renderPage();

    expect(
      await screen.findByText(/Aucune garde prévue aujourd/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Voir le planning/i }),
    ).toHaveAttribute('href', `/foyers/${FOYER_ID}/planning`);
  });

  it('erreur : message + bouton « Réessayer »', async () => {
    vi.mocked(api.lireSemaineBesoins).mockRejectedValue(new Error('panne'));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('panne')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: /Réessayer/i }),
    ).toBeInTheDocument();
  });

  it('bandeau « coût du mois » (P3c) : montant réel du mois courant + lien détail', async () => {
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(semaineVide);

    renderPage();

    // Coût réel formaté (851,16 €) rendu quel que soit le contenu de la journée.
    expect(await screen.findByText(/851,16/)).toBeInTheDocument();
    // Le coût demandé est celui du mois courant (Paris), non simulé.
    expect(api.lireCoutMois).toHaveBeenCalledWith(
      FOYER_ID,
      jourCourantParis(new Date()).slice(0, 7),
      false,
      expect.anything(),
    );
    expect(screen.getByRole('link', { name: /Détail/i })).toHaveAttribute(
      'href',
      `/foyers/${FOYER_ID}/couts`,
    );
  });

  it('carte « semaine à valider » : semaine en dates réelles + lien vers le planning', async () => {
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(semaineVide);
    vi.mocked(api.listerAValider).mockResolvedValue([aValider('2026-W28')]);

    renderPage();

    // Libellé parent (dates réelles, jamais le numéro ISO) : 2026-W28 = 6→12 juillet.
    expect(
      await screen.findByText(
        /La semaine du 6 au 12 juillet attend votre validation/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /Semaine à valider/i }),
    ).toBeInTheDocument();
    // La validation elle-même vit sur le planning (EncartValidation) : la carte y renvoie.
    expect(
      screen.getByRole('link', { name: /Vérifier et valider/i }),
    ).toHaveAttribute('href', `/foyers/${FOYER_ID}/planning`);
  });

  it('carte « semaine à valider » : dédoublonne par semaine et passe au pluriel', async () => {
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(semaineVide);
    // 3 notifications (2 contrats sur W28 + 1 sur W29) → 2 semaines distinctes.
    vi.mocked(api.listerAValider).mockResolvedValue([
      aValider('2026-W28', 'c1'),
      aValider('2026-W28', 'c2'),
      aValider('2026-W29', 'c1'),
    ]);

    renderPage();

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: /Semaines à valider/i,
      }),
    ).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    // Une ligne par SEMAINE (pas par contrat) : le détail par enfant vit sur le planning.
    expect(items.map((el) => el.textContent)).toEqual([
      'semaine du 6 au 12 juillet',
      'semaine du 13 au 19 juillet',
    ]);
  });

  it('carte « semaine à valider » : absente quand il n’y a rien à valider', async () => {
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(semaineVide);

    renderPage();

    await screen.findByText(/Aucune garde prévue aujourd/i);
    expect(
      screen.queryByRole('link', { name: /Vérifier et valider/i }),
    ).not.toBeInTheDocument();
  });

  it('carte « semaine à valider » : silencieuse si la liste échoue (journée préservée)', async () => {
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(semaineVide);
    vi.mocked(api.listerAValider).mockRejectedValue(
      new Error('notifs indispo'),
    );

    renderPage();

    expect(
      await screen.findByText(/Aucune garde prévue aujourd/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Vérifier et valider/i }),
    ).not.toBeInTheDocument();
  });

  it('bandeau « coût du mois » : silencieux si le coût échoue (journée préservée)', async () => {
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(semaineVide);
    vi.mocked(api.lireCoutMois).mockRejectedValue(new Error('coût indispo'));

    renderPage();

    // La journée reste lisible ; le bandeau ne rend rien (pas de lien « Détail »).
    expect(
      await screen.findByText(/Aucune garde prévue aujourd/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Détail/i }),
    ).not.toBeInTheDocument();
  });

  // Section « Demain » (lot 2 UX) : horloge factice pour fixer le calendrier
  // (même semaine / semaine suivante / fin de mois), `shouldAdvanceTime` pour
  // que les `waitFor` de testing-library continuent d'avancer.
  describe('section « Demain »', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function figerLe(dateIso: string) {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      // Midi UTC : la même date calendaire à Paris, été comme hiver.
      vi.setSystemTime(new Date(`${dateIso}T12:00:00Z`));
    }

    it('demain dans la même semaine : réutilise le fetch du jour, deep-link au mois de DEMAIN', async () => {
      // Vendredi 31 juillet : demain (samedi 1er août) est dans la même
      // semaine ISO mais dans le mois SUIVANT — le cas piège du paramètre mois.
      figerLe('2026-07-31');
      vi.mocked(api.lireSemaineBesoins).mockResolvedValue(semaineAvecGarde);

      renderPage();

      expect(
        await screen.findByRole('heading', { level: 2, name: 'Demain' }),
      ).toBeInTheDocument();
      // Sous-titre parent : jour nommé + date réelle.
      expect(screen.getByText(/Samedi 01\/08\/2026/)).toBeInTheDocument();
      // Semaine-type 7 j : Léa gardée aujourd'hui ET demain.
      expect(await screen.findAllByText('Léa')).toHaveLength(2);
      // Même semaine ISO → UN seul appel réseau, pas de fetch secondaire.
      expect(api.lireSemaineBesoins).toHaveBeenCalledTimes(1);
      // Le lien de demain porte le mois de demain (août)…
      const lienDemain = screen.getByRole('link', {
        name: 'Modifier la garde de Léa demain',
      });
      const urlDemain = new URL(lienDemain.getAttribute('href')!, 'http://x');
      expect(urlDemain.searchParams.get('mois')).toBe('2026-08');
      // … celui d'aujourd'hui reste sur juillet.
      const lienJour = screen.getByRole('link', {
        name: 'Modifier la garde de Léa',
      });
      const urlJour = new URL(lienJour.getAttribute('href')!, 'http://x');
      expect(urlJour.searchParams.get('mois')).toBe('2026-07');
    });

    it('demain en semaine ISO suivante (dimanche) : second fetch sur la semaine de demain', async () => {
      // Dimanche 5 juillet (fin de 2026-W27) : demain est le lundi de 2026-W28.
      figerLe('2026-07-05');
      const semaineSuivante: SemaineBesoins = {
        ...semaineAvecGarde,
        semaineIso: '2026-W28',
        contrats: [
          { ...semaineAvecGarde.contrats[0]!, contratId: 'c2', enfant: 'Tom' },
        ],
      };
      vi.mocked(api.lireSemaineBesoins).mockImplementation((_id, semaine) =>
        Promise.resolve(
          semaine === '2026-W28' ? semaineSuivante : semaineAvecGarde,
        ),
      );

      renderPage();

      // Aujourd'hui (W27) : Léa ; demain (W28) : Tom, servi par le 2e fetch.
      expect(await screen.findByText('Léa')).toBeInTheDocument();
      expect(await screen.findByText('Tom')).toBeInTheDocument();
      expect(api.lireSemaineBesoins).toHaveBeenCalledWith(
        FOYER_ID,
        '2026-W27',
        expect.anything(),
      );
      expect(api.lireSemaineBesoins).toHaveBeenCalledWith(
        FOYER_ID,
        '2026-W28',
        expect.anything(),
      );
    });

    it('aucune garde demain : une seule ligne sobre, pas de carte', async () => {
      // Mercredi 1er juillet, contrat gardé le mercredi uniquement.
      figerLe('2026-07-01');
      const mercrediSeul: SemaineBesoins = {
        ...semaineAvecGarde,
        contrats: [
          {
            ...semaineAvecGarde.contrats[0]!,
            semaineType: {
              LUNDI: [],
              MARDI: [],
              MERCREDI: [PLAGE],
              JEUDI: [],
              VENDREDI: [],
              SAMEDI: [],
              DIMANCHE: [],
            },
          },
        ],
      };
      vi.mocked(api.lireSemaineBesoins).mockResolvedValue(mercrediSeul);

      renderPage();

      expect(await screen.findByText('Léa')).toBeInTheDocument();
      const vide = await screen.findByText('Aucune garde prévue demain.');
      // Ligne sobre (muted), pas la carte lourde de l'état vide du jour.
      expect(vide.closest('.carte')).toBeNull();
      expect(vide).toHaveClass('muted');
    });

    it('échec du fetch de demain (semaine suivante) : la journée reste intacte, la section se tait', async () => {
      figerLe('2026-07-05'); // dimanche → le fetch de demain vise 2026-W28
      vi.mocked(api.lireSemaineBesoins).mockImplementation((_id, semaine) =>
        semaine === '2026-W28'
          ? Promise.reject(new Error('semaine suivante indispo'))
          : Promise.resolve(semaineAvecGarde),
      );

      renderPage();

      expect(await screen.findByText('Léa')).toBeInTheDocument();
      await waitFor(() => {
        expect(api.lireSemaineBesoins).toHaveBeenCalledWith(
          FOYER_ID,
          '2026-W28',
          expect.anything(),
        );
      });
      // Silence total : ni faux « aucune garde », ni erreur qui masque le jour.
      expect(
        screen.queryByRole('heading', { level: 2, name: 'Demain' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/Aucune garde prévue demain/),
      ).not.toBeInTheDocument();
    });
  });
});
