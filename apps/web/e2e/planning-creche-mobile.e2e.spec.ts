import { test, expect, devices, type Page, type Route } from '@playwright/test';

// Phase C (UI mobile) — vérifie le RENDU RÉEL du calendrier crèche sur petit
// écran, ce que les tests unitaires ne peuvent pas couvrir : ils mockent
// entièrement FullCalendar (jsdom ne met rien en page). Ici on rend le vrai
// FullCalendar dans Chromium émulé en mobile.
//
// Comme les autres specs de cette famille (cf. parcours.e2e.spec.ts), le BFF est
// mocké par interception réseau (`page.route`) → exécution offline, déterministe,
// sans pile docker ; le `webServer` de playwright.config.ts ne sert que le front.
//
// Émulation mobile (Pixel 5 → chromium, isMobile + hasTouch) appliquée à TOUT ce
// fichier : les autres specs gardent leur viewport desktop.
test.use({ ...devices['Pixel 5'] });

const FOYER_ID = 'foyer-mobile';
// Mois fixe (déterminisme du rendu et de la baseline screenshot) : le contrat
// court de 2026-01-01 sans fin → ce mois est toujours « dans la période ».
const MOIS = '2026-06';

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
  // Mia (1re de la liste) porte le contrat crèche → onglet sélectionné par défaut.
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

// Plage de garde type 09:00–16:30 ; semaine lun→ven → jours « Gardé » dessinés
// côté client (joursGardes) à partir de semaineType, sans dépendre de lirePlanning.
const PLAGE = {
  debutHeures: 9,
  debutMinutes: 0,
  finHeures: 16,
  finMinutes: 30,
};
const contrat = {
  id: 'contrat-creche-1',
  foyerId: FOYER_ID,
  enfant: 'Mia',
  mode: 'CRECHE_PSU',
  valideDu: '2026-01-01',
  valideAu: null,
  heuresAnnuellesContractualisees: 1607,
  nbMensualites: 11,
  semaineType: {
    LUNDI: [PLAGE],
    MARDI: [PLAGE],
    MERCREDI: [PLAGE],
    JEUDI: [PLAGE],
    VENDREDI: [PLAGE],
  },
};

const coutMois = {
  foyerId: FOYER_ID,
  mois: MOIS,
  simule: false,
  totalCentimes: 85116,
  prestations: [
    {
      enfant: 'Mia',
      mode: 'CRECHE_PSU',
      totalCentimes: 85116,
      lignes: [
        { libelle: 'Crèche PSU', sens: 'debit', montantCentimes: 85116 },
      ],
    },
  ],
  lignes: [{ libelle: 'Total à payer', sens: 'debit', montantCentimes: 85116 }],
};

async function mockerBff(page: Page): Promise<void> {
  await page.route('**/api/v1/**', async (route: Route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    const method = req.method();

    if (method === 'GET' && /\/api\/v1\/foyers\/[^/]+$/.test(pathname)) {
      return route.fulfill({ status: 200, json: dossier });
    }
    // useContrats lit la liste ici (ContratLocal[]) ; on inclut semaineType —
    // ce que la vraie gateway ne renvoie pas, mais le front l'utilise tel quel.
    if (method === 'GET' && pathname.endsWith('/api/v1/contrats')) {
      return route.fulfill({ status: 200, json: [contrat] });
    }
    // Aucune saisie serveur : le calendrier n'affiche que les jours « Gardé ».
    if (method === 'GET' && pathname.includes('/plannings/')) {
      return route.fulfill({ status: 200, json: { saisie: null } });
    }
    if (method === 'GET' && pathname.endsWith('/api/v1/couts')) {
      return route.fulfill({ status: 200, json: coutMois });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
}

/** Ouvre le planning de Mia sur le mois fixe et attend le rendu du calendrier. */
async function ouvrirCalendrier(page: Page): Promise<void> {
  await mockerBff(page);
  // enfant=Mia par défaut (1re de la liste), mode=CRECHE_PSU (seul contrat valide).
  await page.goto(`/foyers/${FOYER_ID}/planning?mois=${MOIS}`);
  await expect(page.locator('.fc')).toBeVisible();
  // Les pastilles « Gardé » confirment que la semaine type est rendue.
  await expect(
    page.locator('.fc').getByText('Gardé', { exact: true }).first(),
  ).toBeVisible();
}

test('calendrier crèche mobile : cellules tactiles, pas de débordement, onglets scrollables', async ({
  page,
}) => {
  await ouvrirCalendrier(page);

  // 1a. La règle CSS de cible tactile s'applique : min-height calculé du cadre
  //     de case-jour ≥ 44px (cf. .fc-daygrid-day-frame { min-height: 2.75rem }).
  const minHeight = await page
    .locator('.fc-daygrid-day-frame')
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).minHeight));
  expect(minHeight).toBeGreaterThanOrEqual(44);

  // 1b. Cible tactile réelle : une case-jour effectivement rendue (celle qui
  //     porte une pastille « Gardé ») mesure au moins 44px de haut.
  const caseGardee = page
    .locator('.fc-daygrid-day')
    .filter({ has: page.locator('.fc-event') })
    .first();
  const hauteurCase = await caseGardee.evaluate(
    (el) => el.getBoundingClientRect().height,
  );
  expect(hauteurCase).toBeGreaterThanOrEqual(44);

  // 2. Aucun débordement horizontal de la page sur 393px de large.
  const deborde = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(deborde).toBe(false);

  // 3. Les onglets (enfants / modes) sont en défilement horizontal sur mobile
  //    (nowrap + overflow-x auto), pas en retour à la ligne.
  const onglets = page.locator('.onglets').first();
  await expect(onglets).toHaveCSS('flex-wrap', 'nowrap');
  await expect(onglets).toHaveCSS('overflow-x', 'auto');
});

test('rendu visuel du calendrier crèche (mobile)', async ({ page }) => {
  // La baseline screenshot est spécifique à l'OS/au moteur de rendu : générée
  // localement (win32), elle n'existe pas pour le runner CI (linux). On garde
  // donc ce contrôle visuel hors CI — les assertions de layout ci-dessus, elles,
  // protègent durablement la Phase C partout.
  test.skip(
    !!process.env['CI'],
    'baseline screenshot spécifique à l’OS, générée localement',
  );

  await ouvrirCalendrier(page);
  // Laisse les requêtes mockées (foyer/contrats/planning/coût) se résoudre et le
  // panneau coût se peindre : sans cela, l'arrivée tardive du coût décale `.fc`
  // et `toHaveScreenshot` échoue sur « element is not stable ».
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(/851,16/).first()).toBeVisible();
  // Fige le visuel du calendrier (grille + pastilles « Gardé ») en mobile.
  await expect(page.locator('.fc')).toHaveScreenshot(
    'calendrier-creche-mobile.png',
    {
      maxDiffPixelRatio: 0.02,
    },
  );
});
