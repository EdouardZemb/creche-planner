import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlanningPage } from './PlanningPage';
import type { DossierFoyerVue } from '../types/bff';

// Mock du module api/client
vi.mock('../api/client', () => ({
  api: {
    lireFoyer: vi.fn(),
    listerContrats: vi.fn(),
    ecrirePlanning: vi.fn(),
    lirePlanning: vi.fn(),
    modifierContrat: vi.fn(),
    listerAValider: vi.fn(),
    validerSemaine: vi.fn(),
    // Ouvrir l'éditeur hebdo (auto-ouverture via `?semaine`) charge la vue consolidée.
    lireSemaineBesoins: vi.fn(),
    ecrireSemaineBesoins: vi.fn(),
    lireBrouillonEtablissement: vi.fn(),
    envoyerRecapEtablissement: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    corps: unknown;
    constructor(status: number, corps: unknown) {
      super(`HTTP ${status}`);
      this.status = status;
      this.corps = corps;
    }
  },
  // Exporté par le vrai module et importé par useFoyer : requis dans le mock.
  AuthExpiredError: class AuthExpiredError extends Error {},
}));

// Mock de FullCalendar pour éviter les erreurs jsdom
vi.mock('@fullcalendar/react', () => ({
  default: ({ events }: { events?: unknown[] }) => (
    <div data-testid="fullcalendar">
      {Array.isArray(events) ? `${events.length} evenements` : '0 evenements'}
    </div>
  ),
}));

vi.mock('@fullcalendar/daygrid', () => ({ default: {} }));
vi.mock('@fullcalendar/interaction', () => ({ default: {} }));

// Le panneau coût est testé séparément ; on l'isole pour ne pas déclencher ses fetchs.
vi.mock('../couts/PanneauCoutMois', () => ({
  PanneauCoutMois: () => <div data-testid="panneau-cout" />,
}));

import { api } from '../api/client';

const dossierMock: DossierFoyerVue = {
  foyer: {
    id: 'foyer-1',
    ressourcesMensuellesCentimes: 300000,
    ressourcesMensuellesEuros: 3000,
    rfrCentimes: 3600000,
    rfrEuros: 36000,
    nbEnfantsACharge: 1,
    nbParts: 1,
    tranche: 2,
  },
  enfants: [
    {
      id: 'enfant-1',
      foyerId: 'foyer-1',
      prenom: 'Alice',
      dateNaissance: '2022-03-15',
    },
    {
      id: 'enfant-2',
      foyerId: 'foyer-1',
      prenom: 'Bob',
      dateNaissance: '2020-07-20',
    },
  ],
  parents: [],
};

function renderPage(foyerId = 'foyer-1', search = '') {
  return render(
    <MemoryRouter initialEntries={[`/foyers/${foyerId}/planning${search}`]}>
      <Routes>
        <Route path="/foyers/:foyerId/planning" element={<PlanningPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

// Semaine notifiée `2026-W27` (29 juin → 5 juillet), consommée par l'éditeur hebdo
// quand le lien profond `?semaine` ouvre celui-ci d'office.
const A_VALIDER_W27 = [
  {
    contratId: '55555555-0000-4000-8000-000000000000',
    foyerId: 'foyer-1',
    semaineIso: '2026-W27',
    statut: 'A_VALIDER' as const,
    notifieeLe: '2026-06-23T06:00:00.000Z',
  },
];

const SEMAINE_BESOINS_W27 = {
  semaineIso: '2026-W27',
  jours: [
    '2026-06-29',
    '2026-06-30',
    '2026-07-01',
    '2026-07-02',
    '2026-07-03',
    '2026-07-04',
    '2026-07-05',
  ],
  etablissements: [],
  contrats: [],
};

describe('PlanningPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Par défaut : aucun contrat (lu via l'API GET /api/v1/contrats?foyer=).
    vi.mocked(api.listerContrats).mockResolvedValue([]);
    vi.mocked(api.lirePlanning).mockResolvedValue({ saisie: null });
    // Encart de validation (Lot 4) : rien à valider par défaut.
    vi.mocked(api.listerAValider).mockResolvedValue([]);
    vi.mocked(api.lireSemaineBesoins).mockResolvedValue(SEMAINE_BESOINS_W27);
  });

  it('affiche le chargement puis le titre', async () => {
    let resolve!: (v: DossierFoyerVue) => void;
    const promise = new Promise<DossierFoyerVue>((r) => {
      resolve = r;
    });
    vi.mocked(api.lireFoyer).mockReturnValue(promise);

    renderPage();

    expect(screen.getByText(/Chargement du foyer/i)).toBeInTheDocument();

    resolve(dossierMock);

    const titre = await screen.findByText(/Planning mensuel/i);
    expect(titre).toBeInTheDocument();
  });

  it('affiche les onglets enfants apres chargement', async () => {
    vi.mocked(api.lireFoyer).mockResolvedValue(dossierMock);

    renderPage();

    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('affiche un etat vide avec CTA si aucun contrat pour cet enfant (EX-07)', async () => {
    vi.mocked(api.lireFoyer).mockResolvedValue(dossierMock);

    renderPage();

    await screen.findByText('Alice');
    expect(
      screen.getByText(/Aucun contrat pour cet enfant/i),
    ).toBeInTheDocument();

    const cta = screen.getByRole('link', { name: /Créer un contrat/i });
    expect(cta).toHaveAttribute('href', '/foyers/foyer-1/contrats');
  });

  it('affiche un etat vide avec CTA si ni enfant ni contrat (EX-07)', async () => {
    vi.mocked(api.lireFoyer).mockResolvedValue({
      ...dossierMock,
      enfants: [],
    });

    renderPage();

    expect(
      await screen.findByText(/Aucun enfant ni contrat/i),
    ).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /Créer un contrat/i });
    expect(cta).toHaveAttribute('href', '/foyers/foyer-1/contrats');
  });

  it('definit le titre de la page (EX-05)', async () => {
    vi.mocked(api.lireFoyer).mockResolvedValue(dossierMock);

    renderPage();

    await screen.findByText(/Planning mensuel/i);
    expect(document.title).toBe('Planning — Crèche Planner');
  });

  it('affiche le calendrier quand un contrat CRECHE_PSU est stocke', async () => {
    vi.mocked(api.lireFoyer).mockResolvedValue(dossierMock);

    vi.mocked(api.listerContrats).mockResolvedValue([
      {
        id: 'contrat-1',
        foyerId: 'foyer-1',
        enfant: 'Alice',
        enfantId: 'enfant-alice',
        mode: 'CRECHE_PSU',
        valideDu: '2026-01-01',
        valideAu: null,
        semaineType: {
          LUNDI: [
            { debutHeures: 8, debutMinutes: 0, finHeures: 17, finMinutes: 0 },
          ],
        },
      },
    ]);

    renderPage();

    await screen.findByText('Alice');
    expect(await screen.findByTestId('fullcalendar')).toBeInTheDocument();
  });

  it('affiche une erreur si le chargement echoue', async () => {
    vi.mocked(api.lireFoyer).mockRejectedValue(
      new Error('Serveur indisponible'),
    );

    renderPage();

    expect(
      await screen.findByText(/Serveur indisponible/i),
    ).toBeInTheDocument();
  });

  it('affiche la case a cocher Mode simulation', async () => {
    vi.mocked(api.lireFoyer).mockResolvedValue(dossierMock);

    renderPage();

    await screen.findByText(/Planning mensuel/i);
    expect(screen.getByLabelText(/Mode simulation/i)).toBeInTheDocument();
  });

  it('affiche le badge « Simulation » si simule=true dans les searchParams', async () => {
    vi.mocked(api.lireFoyer).mockResolvedValue(dossierMock);

    renderPage('foyer-1', '?simule=true');

    await screen.findByText(/Planning mensuel/i);
    expect(screen.getByText('Simulation')).toBeInTheDocument();
  });

  it('lit le mois depuis l URL (EX-06)', async () => {
    vi.mocked(api.lireFoyer).mockResolvedValue(dossierMock);

    renderPage('foyer-1', '?mois=2026-03');

    await screen.findByText(/Planning mensuel/i);
    const input = screen.getByLabelText(/Mois/i) as HTMLInputElement;
    expect(input.value).toBe('2026-03');
  });

  it('marque l onglet enfant actif via aria-selected (EX-10)', async () => {
    vi.mocked(api.lireFoyer).mockResolvedValue(dossierMock);

    renderPage('foyer-1', '?enfant=Bob');

    const alice = await screen.findByRole('tab', { name: 'Alice' });
    const bob = await screen.findByRole('tab', { name: 'Bob' });
    expect(bob).toHaveAttribute('aria-selected', 'true');
    expect(alice).toHaveAttribute('aria-selected', 'false');
  });

  it('relie chaque onglet enfant a son tabpanel (UT-01/CA1)', async () => {
    vi.mocked(api.lireFoyer).mockResolvedValue(dossierMock);

    renderPage('foyer-1', '?enfant=Alice');

    const alice = await screen.findByRole('tab', { name: 'Alice' });
    expect(alice).toHaveAttribute('id', 'onglet-enfant-Alice');
    expect(alice).toHaveAttribute('aria-controls', 'panneau-enfant-Alice');

    // Deux tabpanels imbriqués (enfant → mode) : on cible celui de l'enfant via
    // son nom accessible (aria-labelledby → onglet « Alice »).
    const panneau = screen.getByRole('tabpanel', { name: 'Alice' });
    expect(panneau).toHaveAttribute('id', 'panneau-enfant-Alice');
    expect(panneau).toHaveAttribute('aria-labelledby', 'onglet-enfant-Alice');
  });

  it('applique un roving tabindex aux onglets enfants (UT-01/CA2)', async () => {
    vi.mocked(api.lireFoyer).mockResolvedValue(dossierMock);

    renderPage('foyer-1', '?enfant=Alice');

    const alice = await screen.findByRole('tab', { name: 'Alice' });
    const bob = screen.getByRole('tab', { name: 'Bob' });
    expect(alice).toHaveAttribute('tabindex', '0');
    expect(bob).toHaveAttribute('tabindex', '-1');
  });

  it('navigue entre onglets enfants avec les fleches (UT-01/CA2)', async () => {
    const user = userEvent.setup();
    vi.mocked(api.lireFoyer).mockResolvedValue(dossierMock);

    renderPage('foyer-1', '?enfant=Alice');

    const alice = await screen.findByRole('tab', { name: 'Alice' });
    alice.focus();
    expect(alice).toHaveFocus();

    await user.keyboard('{ArrowRight}');

    const bob = await screen.findByRole('tab', { name: 'Bob' });
    expect(bob).toHaveAttribute('aria-selected', 'true');
    expect(bob).toHaveFocus();

    // Bouclage : depuis Bob, ArrowRight revient sur Alice.
    await user.keyboard('{ArrowRight}');
    const aliceApres = await screen.findByRole('tab', { name: 'Alice' });
    expect(aliceApres).toHaveFocus();
    expect(aliceApres).toHaveAttribute('aria-selected', 'true');
  });

  it('relie les onglets mode a leur tabpanel et gere le clavier (UT-01)', async () => {
    const user = userEvent.setup();
    vi.mocked(api.lireFoyer).mockResolvedValue(dossierMock);

    vi.mocked(api.listerContrats).mockResolvedValue([
      {
        id: 'contrat-1',
        foyerId: 'foyer-1',
        enfant: 'Alice',
        enfantId: 'enfant-alice',
        mode: 'CRECHE_PSU',
        valideDu: '2026-01-01',
        valideAu: null,
        semaineType: {},
      },
      {
        id: 'contrat-2',
        foyerId: 'foyer-1',
        enfant: 'Alice',
        enfantId: 'enfant-alice',
        mode: 'ABCM',
        valideDu: '2026-01-01',
        valideAu: null,
        semaineType: {},
      },
    ]);

    renderPage('foyer-1', '?enfant=Alice');

    const ongletPsu = await screen.findByRole('tab', { name: 'Crèche' });
    expect(ongletPsu).toHaveAttribute('id', 'onglet-mode-CRECHE_PSU');
    expect(ongletPsu).toHaveAttribute(
      'aria-controls',
      'panneau-mode-CRECHE_PSU',
    );
    expect(ongletPsu).toHaveAttribute('tabindex', '0');

    const ongletAbcm = screen.getByRole('tab', { name: 'ABCM' });
    expect(ongletAbcm).toHaveAttribute('tabindex', '-1');

    // Le tabpanel actif (calendrier) est relié à l'onglet PSU.
    const panneaux = screen.getAllByRole('tabpanel');
    const panneauMode = panneaux.find(
      (p) => p.getAttribute('id') === 'panneau-mode-CRECHE_PSU',
    );
    expect(panneauMode).toBeDefined();
    expect(panneauMode).toHaveAttribute(
      'aria-labelledby',
      'onglet-mode-CRECHE_PSU',
    );

    // Flèche droite -> ABCM, focus géré.
    ongletPsu.focus();
    await user.keyboard('{ArrowRight}');
    const abcmApres = await screen.findByRole('tab', { name: 'ABCM' });
    expect(abcmApres).toHaveAttribute('aria-selected', 'true');
    expect(abcmApres).toHaveFocus();
  });

  it('supporte Home et End sur les onglets enfants (UT-01/CA2)', async () => {
    const user = userEvent.setup();
    vi.mocked(api.lireFoyer).mockResolvedValue(dossierMock);

    renderPage('foyer-1', '?enfant=Alice');

    const alice = await screen.findByRole('tab', { name: 'Alice' });
    alice.focus();

    await user.keyboard('{End}');
    expect(await screen.findByRole('tab', { name: 'Bob' })).toHaveFocus();

    await user.keyboard('{Home}');
    expect(await screen.findByRole('tab', { name: 'Alice' })).toHaveFocus();
  });

  // Régression largeur (débordement mobile) : à la saisie d'une absence crèche,
  // FullCalendar surcalculait sa largeur sur petit écran et, faute de borne sur
  // la colonne flex, étirait la page au-delà du viewport (débordement horizontal).
  // Le correctif borne CHAQUE enfant de `.planning-zone` à `max-width: 100%`.
  // jsdom ne calcule pas le layout : on vérifie ici le contrat structurel (les
  // styles stabilisateurs), la mesure pixel étant couverte par l'e2e mobile.
  it('borne les colonnes du planning à 100% (anti-débordement mobile)', async () => {
    vi.mocked(api.lireFoyer).mockResolvedValue(dossierMock);

    const { container } = renderPage();
    await screen.findByText(/Planning mensuel/i);

    const zone = container.querySelector('.planning-zone');
    expect(zone).not.toBeNull();
    const colonnes = Array.from(zone!.children) as HTMLElement[];
    // Deux colonnes : zone principale (calendrier) + panneau coût.
    expect(colonnes.length).toBeGreaterThanOrEqual(2);
    for (const colonne of colonnes) {
      expect(colonne.style.maxWidth).toBe('100%');
    }
    // La colonne principale doit aussi pouvoir se rétrécir sous la largeur
    // intrinsèque de son contenu (sinon la borne ne sert à rien en flex).
    expect(colonnes[0]!.style.minWidth).not.toBe('');
  });

  it('lien profond ?semaine ouvre d’office l’éditeur de la semaine (Lot 1)', async () => {
    vi.mocked(api.lireFoyer).mockResolvedValue(dossierMock);
    vi.mocked(api.listerAValider).mockResolvedValue(A_VALIDER_W27);

    renderPage('foyer-1', '?semaine=2026-W27');

    // L'éditeur de la semaine notifiée s'ouvre sans aucun clic (entrée du parcours).
    expect(
      await screen.findByRole('heading', {
        name: /Éditer les besoins de la semaine du 29 juin au 5 juillet/i,
      }),
    ).toBeInTheDocument();
  });

  it('?semaine invalide : se comporte comme sans paramètre (éditeur fermé)', async () => {
    vi.mocked(api.lireFoyer).mockResolvedValue(dossierMock);
    vi.mocked(api.listerAValider).mockResolvedValue(A_VALIDER_W27);

    renderPage('foyer-1', '?semaine=pas-une-semaine');

    // La page se charge normalement mais l'éditeur ne s'auto-ouvre pas (regex rejetée).
    await screen.findByText(/Planning mensuel/i);
    expect(
      screen.queryByRole('heading', { name: /Éditer les besoins/i }),
    ).not.toBeInTheDocument();
    expect(api.lireSemaineBesoins).not.toHaveBeenCalled();
  });

  it('affiche le libelle de mode accentue dans les onglets (EX-13)', async () => {
    vi.mocked(api.lireFoyer).mockResolvedValue(dossierMock);

    vi.mocked(api.listerContrats).mockResolvedValue([
      {
        id: 'contrat-1',
        foyerId: 'foyer-1',
        enfant: 'Alice',
        enfantId: 'enfant-alice',
        mode: 'CRECHE_PSU',
        valideDu: '2026-01-01',
        valideAu: null,
        semaineType: {
          LUNDI: [
            { debutHeures: 8, debutMinutes: 0, finHeures: 17, finMinutes: 0 },
          ],
        },
      },
    ]);

    renderPage();

    const onglet = await screen.findByRole('tab', { name: 'Crèche' });
    expect(onglet).toHaveAttribute('aria-selected', 'true');
    // Plus aucun libellé ASCII non accentué, ni le sigle « PSU » (jargon parent).
    expect(screen.queryByText('Creche')).not.toBeInTheDocument();
    expect(screen.queryByText('Crèche PSU')).not.toBeInTheDocument();
  });
});
