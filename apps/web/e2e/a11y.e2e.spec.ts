import { test, expect, devices, type Page, type Route } from '@playwright/test';
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
// tableau de bord « Aujourd'hui » du foyer (P3b). Les contrats, eux, transitent
// désormais par le BFF : depuis
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

// Tags WCAG visés : niveau A et AA, versions 2.0, 2.1 **et 2.2** (lot 9).
//
// ⚠️ `wcag22aa` n'est PAS décoratif et son absence ne se voyait pas : c'est le
// seul tag qui sélectionne `target-size` (SC 2.5.8), la seule règle 2.2 qu'axe
// sache exécuter — et cette règle est déclarée `enabled: false` dans axe-core,
// donc rien ne la fait tourner tant qu'un tag ne la nomme pas. Mesuré au lot 9 :
// avec les quatre tags d'origine, axe sélectionnait 69 règles et `target-size`
// n'en faisait pas partie. Un audit vert ne disait alors RIEN de WCAG 2.2.
const TAGS_WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

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

// Vue hebdo consolidée servie au tableau de bord « Aujourd'hui » (P3b) : foyer
// SANS garde planifiée → l'écran affiche l'état vide accessible (« Aucune garde
// prévue aujourd'hui » + lien vers le planning), déterministe quel que soit le
// jour réel où tourne l'audit. C'est cette page que la redirection racine audite.
const semaineBesoinsVide = {
  semaineIso: `${ANNEE}-W01`,
  jours: [],
  etablissements: [],
  contrats: [],
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
    // Tableau de bord « Aujourd'hui » (P3b) : vue hebdo consolidée du foyer
    // (GET /api/v1/notifications/semaine/:foyer/:semaine/besoins).
    if (
      method === 'GET' &&
      pathname.includes('/notifications/semaine/') &&
      pathname.endsWith('/besoins')
    ) {
      return route.fulfill({ status: 200, json: semaineBesoinsVide });
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
  console.log(
    `[axe AA] ${libelleRoute} → violations: ${resultats.violations.length}, ` +
      `passes: ${resultats.passes.length}, incomplete: ${resultats.incomplete.length}`,
  );
  if (resultats.violations.length > 0) {
    console.log(
      `[axe AA] ${libelleRoute} règles en échec : ` +
        resultats.violations.map((v) => `${v.id} (${v.impact})`).join(', '),
    );
  }
  return resultats;
}

// --- Lot L8 : surfaces « Profil & communication parent » (post-L6/L7) ---------
// Auditées en MOCKÉ comme le reste du fichier. Les mocks `/moi*` sont LOCAUX à
// chaque test (enregistrés APRÈS `mockerBff` → priorité au dernier) : on ne monte
// PAS la cloche sur les 6 audits existants ni ne casse la redirection racine.
const MON_PROFIL = {
  parentId: 'parent-a11y',
  foyerId: FOYER_ID,
  email: 'parent@test.fr',
  prenom: 'Camille',
  nom: 'Martin',
  principal: true,
  preferences: [
    {
      typeNotification: 'VALIDATION_HEBDO',
      canal: 'EMAIL',
      actif: true,
      consentementAt: null,
      desabonneAt: null,
    },
    {
      typeNotification: 'VALIDATION_HEBDO',
      canal: 'IN_APP',
      actif: true,
      consentementAt: null,
      desabonneAt: null,
    },
  ],
};

// `MoiVue` : email non-null ⇒ la cloche se monte (App.tsx `moi.email !== null`).
const MOI = { email: 'parent@test.fr', admin: false, foyers: [FOYER_ID] };

const INBOX = {
  notifications: [
    {
      id: 'notif-a11y-1',
      type: 'VALIDATION_HEBDO',
      sujet: 'Planning de la semaine du 29 juin au 5 juillet 2026 à valider',
      corps:
        'Le planning de Mia pour la semaine du 29 juin au 5 juillet 2026 est à valider.',
      creeLe: '2026-06-23T06:01:00.000Z',
      luLe: null,
      lien: `/foyers/${FOYER_ID}/planning?semaine=2026-W27`,
    },
  ],
  nonLus: 1,
};

test.describe("Audit d'accessibilité automatisé (axe-core, WCAG 2.1 AA)", () => {
  test.beforeEach(async ({ page }) => {
    await amorcerStockage(page);
    await mockerBff(page);
  });

  test('accueil / redirection racine — 0 violation AA', async ({ page }) => {
    // La racine redirige vers /foyers/:id/dashboard (foyer amorcé, P3b) : on
    // attend la stabilisation puis on audite le tableau de bord « Aujourd'hui ».
    await page.goto('/');
    await expect(page).toHaveURL(/\/foyers\/foyer-a11y\/dashboard/);
    await expect(
      page.getByRole('heading', { name: /Aujourd’hui/i }),
    ).toBeVisible();
    const r = await auditer(page, 'accueil→dashboard');
    expect(r.violations).toEqual([]);
  });

  test('formulaire foyer (/foyers/new) — 0 violation AA', async ({ page }) => {
    await page.goto('/foyers/new');
    await expect(
      page.getByRole('heading', { name: /Créer ma famille/i }),
    ).toBeVisible();
    const r = await auditer(page, 'foyers/new');
    expect(r.violations).toEqual([]);
  });

  test('page contrats — 0 violation AA', async ({ page }) => {
    await page.goto(`/foyers/${FOYER_ID}/contrats`);
    // Lot 2 « page contrats pro » : h1 « Contrats » (exact ≠ h2 « Vos contrats »).
    await expect(
      page.getByRole('heading', { name: 'Contrats', exact: true }),
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
    // Le tableau annuel (avec colonne Écart UT-09) doit être rendu.
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
    // Lot 2 « page contrats pro » : h1 « Contrats » (exact ≠ h2 « Vos contrats »).
    await expect(
      page.getByRole('heading', { name: 'Contrats', exact: true }),
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

  test('désabonnement sans jeton (état invalide) — 0 violation AA', async ({
    page,
  }) => {
    // Sans `?token=`, DesabonnementPage passe direct à l'état 'invalide' : rend un
    // `role="alert"`, ZÉRO appel backend.
    await page.goto('/desabonnement');
    await expect(page.getByRole('alert')).toBeVisible();
    const r = await auditer(page, 'desabonnement (invalide)');
    expect(r.violations).toEqual([]);
  });

  test('mentions (/mentions, page publique) — 0 violation AA', async ({
    page,
  }) => {
    // Page publique d'information sur les données (doc 37 § 5) : aucun appel
    // backend, aucun contexte de foyer requis — un agent d'établissement y
    // arrive depuis un courriel, sans compte.
    await page.goto('/mentions');
    await expect(
      page.getByRole('heading', {
        name: 'Informations sur vos données',
        level: 1,
      }),
    ).toBeVisible();
    const r = await auditer(page, 'mentions');
    expect(r.violations).toEqual([]);
  });

  test('mon profil (formulaire préférences) — 0 violation AA', async ({
    page,
  }) => {
    // Mock local de `/moi/profil` (prioritaire sur le catch-all) → formulaire réel
    // rendu. Ancres STABLES qui survivent au reframe L7 : h1 « Mon profil » + au
    // moins une case à cocher (on n'assert PAS un libellé de section évolutif).
    await page.route('**/api/v1/moi/profil', (route) =>
      route.fulfill({ status: 200, json: MON_PROFIL }),
    );
    await page.goto('/mon-profil');
    await expect(
      page.getByRole('heading', { name: 'Mon profil' }),
    ).toBeVisible();
    await expect(page.getByRole('checkbox').first()).toBeVisible();
    const r = await auditer(page, 'mon-profil');
    expect(r.violations).toEqual([]);
  });

  test('cloche ouverte (dialog Modale) — 0 violation AA + fermeture Échap', async ({
    page,
  }) => {
    // Mocks locaux AVANT le goto : `/moi` (email non-null → la cloche se monte) et
    // `/moi/notifications` (≥1 non-lu, ≥1 avec lien). MoiProvider tire `/moi` au
    // montage → le mock doit précéder la navigation.
    await page.route('**/api/v1/moi/notifications', (route) =>
      route.fulfill({ status: 200, json: INBOX }),
    );
    await page.route('**/api/v1/moi', (route) =>
      route.fulfill({ status: 200, json: MOI }),
    );
    await page.goto(`/foyers/${FOYER_ID}/dashboard`);

    // Ouvre le panneau : c'est désormais un dialog (porté par Modale, L6).
    const cloche = page.getByRole('button', { name: /Notifications/i });
    await cloche.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(cloche).toHaveAttribute('aria-expanded', 'true');

    const r = await auditer(page, 'cloche (dialog ouvert)');
    expect(r.violations).toEqual([]);

    // Fermeture au clavier (Échap, héritée de Modale) → dialog démonté.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});

// --- Lot 9 : WCAG 2.2 sur la PRÉSENTATION MOBILE -----------------------------
//
// Le `playwright.config.ts` n'a qu'un projet, `Desktop Chrome` : jusqu'au lot 9,
// l'audit axe n'avait donc **jamais** vu l'app telle que son utilisateur
// principal la voit. Ce n'est pas un simple changement de largeur — sous 768 px,
// trois structures n'existent QUE là : la barre d'onglets fixe du bas, la
// feuille « Plus » posée au-dessus du contenu, et la modale en bottom-sheet.
// Sur desktop, `display: contents` dissout les deux premières en simples liens
// d'en-tête ; l'audit les voyait, mais jamais dans leur présentation réelle.
//
// `devices['Pixel 5']` porte un `defaultBrowserType` que Playwright REFUSE dans
// un `describe` (« forces a new worker ») : on l'écarte et on garde le reste
// (viewport, isMobile, hasTouch, deviceScaleFactor).
const { defaultBrowserType: _navigateurIgnore, ...PIXEL_5 } =
  devices['Pixel 5'];

test.describe('Audit WCAG 2.2 AA — présentation mobile (< 768 px)', () => {
  test.use(PIXEL_5);

  test.beforeEach(async ({ page }) => {
    await amorcerStockage(page);
    await mockerBff(page);
  });

  test('planning (barre d’onglets fixe visible) — 0 violation AA', async ({
    page,
  }) => {
    await page.goto(`/foyers/${FOYER_ID}/planning?mois=${MOIS}`);
    await expect(
      page.getByRole('heading', { name: /Planning mensuel/i }),
    ).toBeVisible();
    // La barre d'onglets n'existe qu'ici : c'est bien la présentation mobile.
    await expect(page.locator('.nav-onglets')).toBeVisible();
    const r = await auditer(page, 'mobile/planning');
    expect(r.violations).toEqual([]);
  });

  test('formulaire foyer (cibles tactiles, SC 2.5.8) — 0 violation AA', async ({
    page,
  }) => {
    await page.goto('/foyers/new');
    await expect(
      page.getByRole('heading', { name: /Créer ma famille/i }),
    ).toBeVisible();
    const r = await auditer(page, 'mobile/foyers-new');
    expect(r.violations).toEqual([]);
  });

  test('panneau « Plus » ouvert — 0 violation AA', async ({ page }) => {
    await page.goto(`/foyers/${FOYER_ID}/planning?mois=${MOIS}`);
    await page.getByRole('button', { name: /Plus/ }).click();
    await expect(page.locator('.nav-plus-panneau.ouvert')).toBeVisible();
    const r = await auditer(page, 'mobile/panneau-plus');
    expect(r.violations).toEqual([]);
  });

  test('SC 2.4.11 : sortir du panneau « Plus » au clavier ne laisse aucun focus sous la feuille', async ({
    page,
  }) => {
    // Constat d'origine (lot 9) : le panneau est un disclosure — ni piège de
    // focus, ni `inert`. `Tab` depuis son dernier lien continuait DANS le
    // contenu, sous une feuille `position: fixed`. Mesuré alors : 6 à 31
    // contrôles entièrement recouverts par écran, dont les actions primaires.
    await page.goto(`/foyers/${FOYER_ID}/contrats`);
    await expect(
      page.getByRole('heading', { name: 'Contrats', exact: true }),
    ).toBeVisible();

    const panneau = page.locator('.nav-plus-panneau');
    await page.getByRole('button', { name: /Plus/ }).click();
    await expect(panneau).toHaveClass(/ouvert/);

    // Traversée clavier réelle : on tabule jusqu'à ce que le focus quitte la
    // nav, en vérifiant à CHAQUE arrêt qu'il n'est pas recouvert par la feuille.
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      const verdict = await page.evaluate(() => {
        const el = document.activeElement;
        if (!(el instanceof HTMLElement)) return null;
        const feuille = document.querySelector('.nav-plus-panneau.ouvert');
        if (feuille === null || feuille.contains(el)) return null;
        const f = feuille.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return null;
        // « Entièrement masqué » au sens du SC 2.4.11 (minimum).
        const masque =
          r.top >= f.top &&
          r.bottom <= f.bottom &&
          r.left >= f.left &&
          r.right <= f.right;
        return masque
          ? `${el.tagName} « ${(el.textContent ?? '').trim().slice(0, 40)} »`
          : null;
      });
      expect(
        verdict,
        `focus entièrement masqué par la feuille « Plus » : ${verdict ?? ''}`,
      ).toBeNull();
    }
  });

  test('SC 3.2.6 : le mécanisme d’aide occupe le même rang relatif sur chaque page', async ({
    page,
  }) => {
    // Aide au sens du SC 3.2.6 : la page publique d'information sur les données,
    // qui porte la marche à suivre pour joindre le service. Elle est atteignable
    // depuis tout écran par le pied de page — et doit y occuper le même rang.
    for (const url of [
      `/foyers/${FOYER_ID}/dashboard`,
      `/foyers/${FOYER_ID}/contrats`,
      '/mentions',
    ]) {
      await page.goto(url);
      const rang = await page.evaluate(() => {
        const pied = document.querySelector('main#contenu > .pied-page');
        if (pied === null) return 'aucun pied de page dans <main>';
        const parent = pied.parentElement;
        if (parent === null) return 'pied sans parent';
        return parent.lastElementChild === pied
          ? 'dernier enfant de main'
          : `rang ${Array.from(parent.children).indexOf(pied)} sur ${parent.children.length}`;
      });
      expect(rang, `rang du mécanisme d’aide sur ${url}`).toBe(
        'dernier enfant de main',
      );
    }
  });
});
