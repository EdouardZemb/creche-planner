import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// LOT 7 / spec 11 §6.3 : audit d'accessibilité automatisé (axe-core) sur l'app
// servie, route par route, pour CONSIGNER un score WCAG 2.1 AA crédible.
//
// Architecture du test (alignée sur `parcours.e2e.spec.ts`) : le BFF est mocké
// par interception réseau (`page.route`) → exécution offline, déterministe, sans
// pile docker. Le `webServer` de `playwright.config.ts` ne sert que le front
// (vite dev sur http://localhost:4200).
//
// Le foyer actif est lu depuis `localStorage` (clé `creche:foyerId`) ; on l'amorce
// via `addInitScript` AVANT chargement pour que la racine `/` redirige vers le
// planning du foyer. Les contrats, eux, transitent désormais par le BFF : depuis
// le refactor API-backed (2026-06-06), `useContrats` lit la liste via
// `GET /api/v1/contrats?foyer=` — mockée dans `mockerBff` ci-dessous — et non plus
// dans `sessionStorage`. C'est cette liste qui alimente les onglets du planning (UT-01).
//
// Cibles explicites de l'audit (spec 11 §6.3) :
//   - UT-01 : pattern d'onglets `role="tab"` / `role="tabpanel"` du planning
//             (vérifié à la fois par axe et par une assertion ARIA dédiée).
//   - UT-02 : focus & annonce au changement de route (région live + focus <main>)
//             (vérifié par une assertion dédiée en complément de l'audit axe).

const FOYER_ID = 'foyer-a11y';
const ANNEE = new Date().getFullYear();
const MOIS = `${ANNEE}-10`;

// Tags WCAG visés : niveau A et AA, versions 2.0 et 2.1.
const TAGS_WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const dossier = {
  foyer: {
    id: FOYER_ID,
    ressourcesMensuellesCentimes: 671692,
    ressourcesMensuellesEuros: 6716.92,
    rfrCentimes: 7270500,
    rfrEuros: 72705,
    nbEnfantsACharge: 2,
    nbParts: 2.5,
    tranche: 3,
  },
  enfants: [
    {
      id: 'enf-1',
      foyerId: FOYER_ID,
      prenom: 'Mia',
      dateNaissance: '2024-12-08',
    },
    {
      id: 'enf-2',
      foyerId: FOYER_ID,
      prenom: 'Zoé',
      dateNaissance: '2023-03-12',
    },
  ],
};

// Deux contrats pour Mia → deux sous-onglets « modes » dans le planning, ce qui
// exerce pleinement le motif tablist (UT-01) sur les deux niveaux d'onglets.
const contratsLocaux = [
  {
    id: 'contrat-cantine',
    foyerId: FOYER_ID,
    enfant: 'Mia',
    mode: 'CANTINE',
    valideDu: `${ANNEE}-09-01`,
    valideAu: null,
    semaineAbcm: {
      LUNDI: { cantine: true },
      MERCREDI: { cantine: true },
      VENDREDI: { cantine: true },
    },
  },
  {
    id: 'contrat-peri',
    foyerId: FOYER_ID,
    enfant: 'Mia',
    mode: 'PERISCOLAIRE',
    valideDu: `${ANNEE}-09-01`,
    valideAu: null,
    semaineAbcm: {
      LUNDI: { periMatin: true, periSoir: true },
    },
  },
];

const coutMois = {
  foyerId: FOYER_ID,
  mois: MOIS,
  simule: false,
  totalCentimes: 20288,
  prestations: [
    {
      enfant: 'Mia',
      mode: 'CANTINE',
      totalCentimes: 20288,
      lignes: [
        { libelle: 'Cantine (16 j)', sens: 'debit', montantCentimes: 20288 },
      ],
    },
  ],
  lignes: [{ libelle: 'Total à payer', sens: 'debit', montantCentimes: 20288 }],
};

const coutAnnuel = {
  foyerId: FOYER_ID,
  annee: ANNEE,
  simule: false,
  totalCentimes: 243456,
  mois: Array.from({ length: 12 }, (_, i) => ({
    mois: `${ANNEE}-${String(i + 1).padStart(2, '0')}`,
    totalCentimes: 20288,
  })),
};

/**
 * Amorce les stockages navigateur AVANT le chargement de la page : foyer actif
 * (localStorage) et contrats du foyer (sessionStorage) attendus par `utils/store.ts`.
 */
async function amorcerStockage(page: Page): Promise<void> {
  await page.addInitScript(
    ({ foyerId, contrats }) => {
      localStorage.setItem('creche:foyerId', foyerId);
      sessionStorage.setItem(
        `creche:contrats:${foyerId}`,
        JSON.stringify(contrats),
      );
    },
    { foyerId: FOYER_ID, contrats: contratsLocaux },
  );
}

/** Mock du BFF `/api/v1/**` couvrant toutes les routes visitées par l'audit. */
async function mockerBff(page: Page): Promise<void> {
  await page.route('**/api/v1/**', async (route: Route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    const method = req.method();

    if (method === 'POST' && pathname.endsWith('/api/v1/foyers')) {
      return route.fulfill({ status: 201, json: dossier });
    }
    if (method === 'GET' && /\/api\/v1\/foyers\/[^/]+$/.test(pathname)) {
      return route.fulfill({ status: 200, json: dossier });
    }
    if (method === 'POST' && pathname.endsWith('/api/v1/contrats')) {
      return route.fulfill({ status: 201, json: contratsLocaux[0] });
    }
    // Liste des contrats (GET /api/v1/contrats?foyer=) — depuis le refactor
    // API-backed (2026-06-06), `useContrats` lit la liste ICI (et non plus dans
    // sessionStorage). C'est ce qui alimente les onglets « mode » du planning
    // audités en UT-01.
    if (method === 'GET' && pathname.endsWith('/api/v1/contrats')) {
      return route.fulfill({ status: 200, json: contratsLocaux });
    }
    if (method === 'PUT' && pathname.includes('/plannings/')) {
      return route.fulfill({ status: 204, body: '' });
    }
    if (method === 'GET' && pathname.endsWith('/api/v1/couts/annuel')) {
      return route.fulfill({ status: 200, json: coutAnnuel });
    }
    if (method === 'GET' && pathname.endsWith('/api/v1/couts')) {
      return route.fulfill({ status: 200, json: coutMois });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
}

/**
 * Exécute l'audit axe-core (tags WCAG A/AA) sur la page courante, journalise un
 * récapitulatif (violations / passes) puis renvoie le résultat brut.
 * `configurer` permet d'affiner l'instance (`exclude`, `disableRules`…).
 */
async function auditer(
  page: Page,
  libelleRoute: string,
  configurer?: (b: AxeBuilder) => AxeBuilder,
) {
  let builder = new AxeBuilder({ page }).withTags(TAGS_WCAG_AA);
  if (configurer) builder = configurer(builder);
  const resultats = await builder.analyze();

  // Récapitulatif consignable du score AA par route.
  // eslint-disable-next-line no-console
  console.log(
    `[axe AA] ${libelleRoute} → violations: ${resultats.violations.length}, ` +
      `passes: ${resultats.passes.length}, incomplete: ${resultats.incomplete.length}`,
  );
  if (resultats.violations.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[axe AA] ${libelleRoute} règles en échec : ` +
        resultats.violations.map((v) => `${v.id} (${v.impact})`).join(', '),
    );
  }
  return resultats;
}

test.describe("Audit d'accessibilité automatisé (axe-core, WCAG 2.1 AA)", () => {
  test.beforeEach(async ({ page }) => {
    await amorcerStockage(page);
    await mockerBff(page);
  });

  test('accueil / redirection racine — 0 violation AA', async ({ page }) => {
    // La racine redirige vers /foyers/:id/planning (foyer amorcé) : on attend la
    // stabilisation puis on audite la page atterrie.
    await page.goto('/');
    await expect(page).toHaveURL(/\/foyers\/foyer-a11y\/planning/);
    await expect(
      page.getByRole('heading', { name: /Planning mensuel/i }),
    ).toBeVisible();
    const r = await auditer(page, 'accueil→planning');
    expect(r.violations).toEqual([]);
  });

  test('formulaire foyer (/foyers/new) — 0 violation AA', async ({ page }) => {
    await page.goto('/foyers/new');
    await expect(
      page.getByRole('heading', { name: /Nouveau foyer/i }),
    ).toBeVisible();
    const r = await auditer(page, 'foyers/new');
    expect(r.violations).toEqual([]);
  });

  test('page contrats — 0 violation AA', async ({ page }) => {
    await page.goto(`/foyers/${FOYER_ID}/contrats`);
    await expect(
      page.getByRole('heading', { name: /Contrats du foyer/i }),
    ).toBeVisible();
    const r = await auditer(page, 'contrats');
    expect(r.violations).toEqual([]);
  });

  test('planning + onglets (UT-01) — 0 violation AA', async ({ page }) => {
    await page.goto(`/foyers/${FOYER_ID}/planning?mois=${MOIS}`);
    await expect(
      page.getByRole('heading', { name: /Planning mensuel/i }),
    ).toBeVisible();

    // UT-01 (WCAG 4.1.2 / 1.3.1) : pattern d'onglets complet. On vérifie que les
    // tablists existent et que chaque onglet sélectionné pointe (aria-controls)
    // un tabpanel réellement présent → garantit que ce que l'audit axe inspecte
    // est bien le motif ARIA attendu, pas un tablist partiel.
    const tablists = page.getByRole('tablist');
    await expect(tablists.first()).toBeVisible();
    const ongletEnfant = page.getByRole('tab', { name: 'Mia' });
    await expect(ongletEnfant).toHaveAttribute('aria-selected', 'true');
    await expect(ongletEnfant).toHaveAttribute(
      'aria-controls',
      'panneau-enfant-Mia',
    );
    await expect(
      page.locator('#panneau-enfant-Mia[role="tabpanel"]'),
    ).toBeVisible();
    // Sous-onglet « mode » → tabpanel (calendrier) correspondant.
    await expect(page.getByRole('tab', { name: /Cantine/i })).toHaveAttribute(
      'aria-controls',
      'panneau-mode-CANTINE',
    );
    await expect(
      page.locator('#panneau-mode-CANTINE[role="tabpanel"]'),
    ).toBeVisible();

    const r = await auditer(page, 'planning (UT-01 onglets)');
    expect(r.violations).toEqual([]);
  });

  test('coûts mensuels (planning, mode simulation) — 0 violation AA', async ({
    page,
  }) => {
    // Le coût du mois est rendu par le PanneauCoutMois du planning ; en mode
    // simulation, le delta simulé/réel (UT-09) est aussi rendu et audité.
    await page.goto(`/foyers/${FOYER_ID}/planning?mois=${MOIS}&simule=true`);
    await expect(page.getByText(/Coût du mois/i)).toBeVisible();
    await expect(page.getByText(/202,88/).first()).toBeVisible();
    const r = await auditer(page, 'coûts mensuels (panneau, simulation)');
    expect(r.violations).toEqual([]);
  });

  test('coûts annuels (/foyers/:id/couts) — 0 violation AA', async ({
    page,
  }) => {
    await page.goto(`/foyers/${FOYER_ID}/couts?simule=true`);
    await expect(
      page.getByRole('heading', { name: /Coûts annuels/i }),
    ).toBeVisible();
    // Le tableau annuel (avec colonne Delta UT-09) doit être rendu.
    await expect(page.getByRole('table')).toBeVisible();
    const r = await auditer(page, 'coûts annuels');
    expect(r.violations).toEqual([]);
  });

  test('UT-02 : focus & annonce au changement de route', async ({ page }) => {
    // UT-02 (WCAG 2.4.3) : à chaque navigation SPA, le focus est porté sur
    // <main id="contenu" tabindex="-1"> et le titre courant est publié dans une
    // région live aria-live="polite". On vérifie le comportement réel plutôt que
    // de seulement l'inspecter statiquement.
    await page.goto(`/foyers/${FOYER_ID}/contrats`);
    await expect(
      page.getByRole('heading', { name: /Contrats du foyer/i }),
    ).toBeVisible();

    // Région live d'annonce de route présente et polie (CA2). Ciblée par son
    // testid : depuis AQ-05, les calendriers portent leur propre région live de
    // mutation, un sélecteur global `p[aria-live]` matcherait plusieurs nœuds.
    const regionLive = page.getByTestId('annonce-route');
    await expect(regionLive).toHaveCount(1);
    await expect(regionLive).toHaveAttribute('aria-live', 'polite');
    await expect(regionLive).toHaveAttribute('role', 'status');

    // Navigation via le lien « Planning » → focus déplacé sur <main> (CA1).
    await page
      .getByRole('link', { name: /^Planning$/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/foyers\/foyer-a11y\/planning/);
    await expect(page.locator('main#contenu')).toBeFocused();

    // La région live annonce le nouveau titre de page (CA2).
    await expect(regionLive).toHaveText(/Planning/);

    // Le lien d'évitement « Aller au contenu » reste présent (CA3).
    await expect(
      page.getByRole('link', { name: /Aller au contenu/i }),
    ).toHaveAttribute('href', '#contenu');
  });
});
