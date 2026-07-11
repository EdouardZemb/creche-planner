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
    // Lot 3 onboarding : la carte « aucune garde » interroge les contrats du
    // foyer (via `useContrats`) pour distinguer un foyer neuf d'un foyer actif.
    listerContrats: vi.fn(),
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
import { viderCacheAsync } from '../hooks/useAsync';
import type { ContratLocal } from '../types/bff';

const FOYER_ID = 'foyer-1';

// Contrat factice minimal : seule sa PRÉSENCE compte (la carte « aucune garde »
// ne lit que `contrats.length`).
const contratFactice = {
  id: 'c1',
  foyerId: FOYER_ID,
} as unknown as ContratLocal;

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

// Horloge factice pour fixer le calendrier (jour de la semaine, changement de
// semaine ISO), `shouldAdvanceTime` pour que les `waitFor` continuent d'avancer.
function figerLe(dateIso: string) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // Midi UTC : la même date calendaire à Paris, été comme hiver.
  vi.setSystemTime(new Date(`${dateIso}T12:00:00Z`));
}

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
    // `useContrats` met en cache par foyer (clé module-level) : on le vide entre
    // les tests pour que chaque cas parte d'un état de contrats propre.
    viderCacheAsync();
    // Le bandeau « coût du mois » (P3c) est secondaire : par défaut on sert un
    // coût valide pour qu'il ne pollue pas les autres cas (il s'efface seul si
    // l'appel échoue / charge).
    vi.mocked(api.lireCoutMois).mockResolvedValue(coutMois);
    // Rien à valider par défaut : la carte « semaine à valider » reste muette
    // dans les cas qui ne la concernent pas.
    vi.mocked(api.listerAValider).mockResolvedValue([]);
    // Par défaut le foyer a AU MOINS un contrat : la carte « aucune garde »
    // garde son comportement historique (« Prochaine garde » + « Voir le
    // planning »). Les cas « foyer neuf » redéfinissent une liste vide.
    vi.mocked(api.listerContrats).mockResolvedValue([contratFactice]);
  });

  it('affiche une carte squelette au chargement, annoncée aux lecteurs d’écran (lot 3 UX)', () => {
    vi.mocked(api.lireSemaineBesoins).mockReturnValue(
      new Promise(() => undefined),
    );

    renderPage();

    // Le texte de chargement reste servi aux lecteurs d'écran (sr-only)…
    const annonce = screen.getByText(/Chargement de votre journée/i);
    expect(annonce).toHaveClass('sr-only');
    expect(annonce.closest('.carte')).not.toBeNull();
    // … à côté d'une silhouette de liste de gardes, purement décorative
    // (aria-hidden) : la structure de l'écran est là dès le premier rendu,
    // pas de « pop ».
    const silhouette = screen.getByRole('list', { hidden: true });
    expect(silhouette).toHaveAttribute('aria-hidden', 'true');
    expect(silhouette.querySelectorAll('.jour-rangee')).toHaveLength(2);
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

  it('parle parent : « Horaires modifiés » (jamais « Ajusté ») et « Centre de loisirs (ALSH) » (lot 4 UX)', async () => {
    const aujourdhui = jourCourantParis(new Date());
    const jourSansSaisie = {
      joursSupplementaires: [],
      absences: [],
      ajustements: [],
      exceptions: [],
      joursAlsh: [],
    };
    const vue: SemaineBesoins = {
      ...semaineAvecGarde,
      contrats: [
        {
          ...semaineAvecGarde.contrats[0]!,
          // Absence INTÉRIEURE à la plage 08:30–17:00 → jeton « ajuste ».
          besoins: {
            [aujourdhui]: {
              ...jourSansSaisie,
              absences: [
                {
                  debutHeures: 10,
                  debutMinutes: 0,
                  finHeures: 14,
                  finMinutes: 0,
                  preavisJours: 0,
                  certificatMaladie: false,
                },
              ],
            },
          },
        },
        {
          contratId: 'c-alsh',
          enfant: 'Tom',
          mode: 'ALSH',
          etablissementId: null,
          besoins: {
            [aujourdhui]: {
              ...jourSansSaisie,
              joursAlsh: [{ date: aujourdhui, type: 'COMPLETE' }],
            },
          },
        },
      ],
    };
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(vue);

    renderPage();

    // Le jargon du planning est traduit pour le parent, localement à l'écran.
    expect(await screen.findByText(/Horaires modifiés/)).toBeInTheDocument();
    expect(screen.queryByText(/Ajusté/)).not.toBeInTheDocument();
    expect(screen.getByText(/Centre de loisirs \(ALSH\)/)).toBeInTheDocument();
  });

  it('reflète un ajustement d’heures du jour : libellé déduit + présence réelle', async () => {
    const aujourdhui = jourCourantParis(new Date());
    const jourSansSaisie = {
      joursSupplementaires: [],
      absences: [],
      ajustements: [],
      exceptions: [],
      joursAlsh: [],
    };
    const vue: SemaineBesoins = {
      ...semaineAvecGarde,
      contrats: [
        {
          ...semaineAvecGarde.contrats[0]!,
          // Base 08:30–17:00 ; présence réelle 08:00–17:00 → arrivée avancée.
          besoins: {
            [aujourdhui]: {
              ...jourSansSaisie,
              ajustements: [
                {
                  date: aujourdhui,
                  debutHeures: 8,
                  debutMinutes: 0,
                  finHeures: 17,
                  finMinutes: 0,
                  preavisJours: 0,
                  certificatMaladie: false,
                },
              ],
            },
          },
        },
      ],
    };
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(vue);

    renderPage();

    expect(await screen.findByText(/Arrivée avancée/)).toBeInTheDocument();
    expect(screen.getAllByText(/08:00–17:00/).length).toBeGreaterThan(0);
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

  it('foyer neuf (0 contrat) : oriente vers « Créer un contrat » (lot 3 onboarding)', async () => {
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(semaineVide);
    // Aucun contrat : le foyer vient d'être créé, rien à planifier encore.
    vi.mocked(api.listerContrats).mockResolvedValue([]);

    renderPage();

    // Le premier geste utile est proposé en primaire, vers la page Contrats…
    const cta = await screen.findByRole('link', { name: 'Créer un contrat' });
    expect(cta).toHaveAttribute('href', `/foyers/${FOYER_ID}/contrats`);
    expect(
      screen.getByText(/Pour démarrer, créez le contrat de garde/i),
    ).toBeInTheDocument();
    // …et les sorties « planning » (culs-de-sac pour un foyer neuf) disparaissent.
    expect(
      screen.queryByRole('link', { name: /Voir le planning/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Prochaine garde/)).not.toBeInTheDocument();
  });

  it('foyer actif (≥ 1 contrat) : garde « Voir le planning », pas de CTA contrat', async () => {
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(semaineVide);
    vi.mocked(api.listerContrats).mockResolvedValue([contratFactice]);

    renderPage();

    expect(
      await screen.findByText(/Aucune garde prévue aujourd/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Voir le planning/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Créer un contrat' }),
    ).not.toBeInTheDocument();
  });

  it('erreur : libellé générique en mots de parent + bouton « Réessayer » (lot 3 UX)', async () => {
    vi.mocked(api.lireSemaineBesoins).mockRejectedValue(new Error('panne'));

    renderPage();

    // Le message technique remonté par l'API (« panne ») n'est jamais montré :
    // le parent lit un libellé générique rassurant et actionnable.
    await waitFor(() => {
      expect(
        screen.getByText(/Impossible de charger votre journée/),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText('panne')).not.toBeInTheDocument();
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

  it('bandeau « coût du mois » : rendu APRÈS la journée et « Demain » (lot 3 UX)', async () => {
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(semaineAvecGarde);

    renderPage();

    const detail = await screen.findByRole('link', { name: /Détail/i });
    const demain = await screen.findByRole('heading', {
      level: 2,
      name: 'Demain',
    });
    // Le bandeau (qui apparaît après coup, une fois le coût chargé) vit en bas
    // de page : son arrivée tardive ne décale plus les gardes au-dessus.
    expect(
      demain.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

  // « Prochaine garde » de l'état vide (lot 4 UX) : quand rien aujourd'hui,
  // dire au parent quand ça reprend — semaine chargée d'abord, puis semaine
  // ISO suivante via un fetch silencieux, silence au-delà.
  describe('« Prochaine garde » (état vide)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    // Contrat crèche gardé uniquement les jours fournis (les autres vides).
    const gardeLe = (jours: Partial<SemaineTypeCreche>): SemaineBesoins => ({
      ...semaineAvecGarde,
      contrats: [
        {
          ...semaineAvecGarde.contrats[0]!,
          semaineType: {
            LUNDI: [],
            MARDI: [],
            MERCREDI: [],
            JEUDI: [],
            VENDREDI: [],
            SAMEDI: [],
            DIMANCHE: [],
            ...jours,
          },
        },
      ],
    });

    it('trouvée dans la semaine courante : date en mots de parent, aucun fetch secondaire', async () => {
      // Mardi 30 juin (2026-W27), garde le vendredi 3 juillet : même semaine.
      figerLe('2026-06-30');
      vi.mocked(api.lireSemaineBesoins).mockResolvedValue(
        gardeLe({ VENDREDI: [PLAGE] }),
      );

      renderPage();

      expect(
        await screen.findByText(/Aucune garde prévue aujourd/),
      ).toBeInTheDocument();
      expect(await screen.findByText('vendredi 3 juillet')).toBeInTheDocument();
      expect(screen.getByText(/Prochaine garde/)).toBeInTheDocument();
      // Tout est déduit de la semaine déjà chargée : UN seul appel réseau
      // (« Demain » — mercredi, même semaine — n'en fait pas non plus).
      expect(api.lireSemaineBesoins).toHaveBeenCalledTimes(1);
    });

    it('week-end : cherchée dans la semaine ISO suivante via un fetch silencieux', async () => {
      // Samedi 4 juillet (2026-W27), garde le lundi → lundi 6 juillet (W28).
      figerLe('2026-07-04');
      const vueCourante = gardeLe({ LUNDI: [PLAGE] });
      const vueSuivante: SemaineBesoins = {
        ...gardeLe({ LUNDI: [PLAGE] }),
        semaineIso: '2026-W28',
      };
      vi.mocked(api.lireSemaineBesoins).mockImplementation((_id, semaine) =>
        Promise.resolve(semaine === '2026-W28' ? vueSuivante : vueCourante),
      );

      renderPage();

      expect(
        await screen.findByText(/Aucune garde prévue aujourd/),
      ).toBeInTheDocument();
      expect(await screen.findByText('lundi 6 juillet')).toBeInTheDocument();
      expect(api.lireSemaineBesoins).toHaveBeenCalledWith(
        FOYER_ID,
        '2026-W28',
        expect.anything(),
      );
    });

    it('rien sous ~2 semaines : état vide inchangé, pas de fausse promesse', async () => {
      figerLe('2026-07-04');
      // Aucune garde nulle part (semaine-type vide, courante comme suivante).
      vi.mocked(api.lireSemaineBesoins).mockResolvedValue(gardeLe({}));

      renderPage();

      expect(
        await screen.findByText(/Aucune garde prévue aujourd/),
      ).toBeInTheDocument();
      // La semaine suivante a bien été sondée… sans rien donner → silence.
      await waitFor(() => {
        expect(api.lireSemaineBesoins).toHaveBeenCalledWith(
          FOYER_ID,
          '2026-W28',
          expect.anything(),
        );
      });
      expect(screen.queryByText(/Prochaine garde/)).not.toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /Voir le planning/i }),
      ).toBeInTheDocument();
    });
  });
});
