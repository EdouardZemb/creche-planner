import { test, expect, type Route } from '@playwright/test';

// DoD Phase 8 : « planifier un mois → lire le coût consolidé ».
// Le BFF est mocké par interception réseau (page.route) → test offline et
// déterministe, sans pile docker. On exerce le parcours réel de l'UI :
// créer un foyer → créer un contrat cantine → ouvrir le planning → écrire le
// planning (PUT) → lire le coût du mois (CT-10 = 20 288 c = 202,88 €).

const FOYER_ID = 'foyer-e2e';

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

const contrat = {
  id: 'contrat-1',
  foyerId: FOYER_ID,
  enfant: 'Mia',
  mode: 'CANTINE',
  valideDu: '2026-10-01',
  valideAu: null,
};

const coutMois = {
  foyerId: FOYER_ID,
  mois: '2026-10',
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

test('parcours : créer foyer → contrat cantine → planning → coût du mois', async ({
  page,
}) => {
  let planningEcrit = false;

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
      return route.fulfill({ status: 201, json: contrat });
    }
    // Liste des contrats (GET /api/v1/contrats?foyer=) — depuis le refactor
    // API-backed (2026-06-06), la page Contrats/Planning lit la liste ici et
    // non plus dans sessionStorage. Sans ce handler, la liste reste vide et le
    // contrat « Cantine » n'apparaît jamais.
    if (method === 'GET' && pathname.endsWith('/api/v1/contrats')) {
      return route.fulfill({ status: 200, json: [contrat] });
    }
    if (method === 'PUT' && pathname.includes('/plannings/')) {
      planningEcrit = true;
      return route.fulfill({ status: 204, body: '' });
    }
    if (method === 'GET' && pathname.endsWith('/api/v1/couts')) {
      return route.fulfill({ status: 200, json: coutMois });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });

  // 1. Création du foyer (formulaire pré-rempli) → /contrats.
  await page.goto('/foyers/new');
  await page.getByRole('button', { name: /Créer le foyer/i }).click();
  await expect(page).toHaveURL(/\/foyers\/foyer-e2e\/contrats/);

  // 2. Création d'un contrat cantine pour Mia.
  await page.getByRole('button', { name: /Nouveau contrat/i }).click();
  await page.locator('#contrat-mode').selectOption('CANTINE');
  await page.locator('#contrat-enfant').selectOption({ label: 'Mia' });
  await page.locator('#contrat-valideDu').fill('2026-10-01');
  // Établissement OBLIGATOIRE depuis P5 : créé à la volée (aucune liste à mocker).
  await page.locator('#contrat-etablissement').selectOption('__nouveau__');
  await page.locator('#contrat-nouvel-etab-nom').fill('École ABCM');
  await page.getByRole('button', { name: /Créer le contrat/i }).click();

  // Le contrat apparaît dans la liste.
  await expect(page.getByText('Cantine')).toBeVisible();

  // 3. Ouverture du planning.
  await page
    .getByRole('link', { name: /^Planning$/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/foyers\/foyer-e2e\/planning/);

  // Cale le mois sur octobre 2026 (mois du coût mocké).
  await page.locator('input[type="month"]').fill('2026-10');

  // 4. Lecture du coût du mois (202,88 € = CT-10).
  await expect(page.getByText(/202,88/).first()).toBeVisible();

  // 5. Écriture du planning : cocher le PAI (cantine) déclenche un PUT.
  await page.getByLabel(/PAI/i).check();
  await expect.poll(() => planningEcrit, { timeout: 5000 }).toBe(true);
});
