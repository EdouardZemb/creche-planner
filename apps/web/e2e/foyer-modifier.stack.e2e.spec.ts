import { test, expect, type APIRequestContext } from '@playwright/test';
import { lireEtatSeed, urlPlanning } from './support/stack';

// Parcours « cycle de vie du foyer » (P2) — le PARENT modifie les scalaires de
// son foyer depuis l'écran dédié (`/foyers/:id/modifier`), contre la pile réelle.
//
// L'écran édite UNIQUEMENT les scalaires (ressources/RFR/parts/nb enfants) ; il
// pré-remplit via GET /api/v1/foyers/:id puis enregistre via PUT /api/v1/foyers/:id.
//
// ⚠️ État partagé : la BDD est seedée une fois et les autres specs (couts/planning)
// dépendent des ressources du foyer (elles pilotent la tranche → le coût PSU). On
// RESTAURE donc systématiquement les valeurs d'origine en `afterEach` (même en cas
// d'échec), via l'API directe, pour ne pas contaminer la pile.

const urlModifier = (foyerId: string): string => `/foyers/${foyerId}/modifier`;

/** Scalaires d'un foyer (euros), tels qu'attendus par PUT /api/v1/foyers/:id. */
interface ScalairesFoyer {
  ressourcesMensuelles: number;
  rfr: number;
  nbEnfantsACharge: number;
  nbParts: number;
}

/** Lit les scalaires courants du foyer (euros) via l'API. */
async function lireScalaires(
  request: APIRequestContext,
  foyerId: string,
): Promise<ScalairesFoyer> {
  const reponse = await request.get(`/api/v1/foyers/${foyerId}`);
  expect(reponse.ok()).toBeTruthy();
  const dossier = (await reponse.json()) as {
    foyer: {
      ressourcesMensuellesEuros: number;
      rfrEuros: number;
      nbEnfantsACharge: number;
      nbParts: number;
    };
  };
  return {
    ressourcesMensuelles: dossier.foyer.ressourcesMensuellesEuros,
    rfr: dossier.foyer.rfrEuros,
    nbEnfantsACharge: dossier.foyer.nbEnfantsACharge,
    nbParts: dossier.foyer.nbParts,
  };
}

test.describe('stack réelle : le parent modifie les ressources de son foyer', () => {
  let foyerId: string;
  let origine: ScalairesFoyer | null = null;

  test.beforeEach(async ({ request }) => {
    foyerId = lireEtatSeed().foyerId;
    origine = await lireScalaires(request, foyerId);
  });

  // Restaure l'état seedé quoi qu'il arrive (les specs couts/planning en dépendent).
  test.afterEach(async ({ request }) => {
    if (origine) {
      const reponse = await request.put(`/api/v1/foyers/${foyerId}`, {
        data: origine,
      });
      expect(reponse.ok()).toBeTruthy();
      origine = null;
    }
  });

  test('édite les ressources mensuelles depuis l’écran dédié et persiste', async ({
    page,
  }) => {
    await page.goto(urlModifier(foyerId));
    await expect(
      page.getByRole('heading', { name: 'Modifier le foyer' }),
    ).toBeVisible();

    // Le formulaire est pré-rempli avec la valeur courante (euros).
    const champRessources = page.getByLabel(/Ressources mensuelles/);
    await expect(champRessources).toHaveValue(
      String(origine!.ressourcesMensuelles),
    );

    // Saisit une nouvelle valeur distinctive et enregistre.
    await champRessources.fill('7000');
    await page
      .getByRole('button', { name: 'Enregistrer les modifications' })
      .click();

    // Retour au planning au succès.
    await expect(page).toHaveURL(new RegExp(`/foyers/${foyerId}/planning`));
    await expect(
      page.getByRole('heading', { name: 'Planning mensuel' }),
    ).toBeVisible();

    // Persistance : en rouvrant l'écran, le champ porte la nouvelle valeur.
    await page.goto(urlModifier(foyerId));
    await expect(page.getByLabel(/Ressources mensuelles/)).toHaveValue('7000');
  });
});

// Le point d'entrée « Modifier le foyer » est visible dans l'en-tête dès qu'un
// foyer est actif (propriétaire ; non conditionné à un rôle admin) — et mène à
// l'écran d'édition.
test('stack réelle : l’en-tête expose « Modifier le foyer » et y mène', async ({
  page,
}) => {
  const { foyerId } = lireEtatSeed();

  await page.goto(urlPlanning(foyerId));
  const lien = page.getByRole('link', { name: 'Modifier le foyer' });
  await expect(lien).toBeVisible();

  await lien.click();
  await expect(page).toHaveURL(new RegExp(`/foyers/${foyerId}/modifier`));
  await expect(
    page.getByRole('heading', { name: 'Modifier le foyer' }),
  ).toBeVisible();
});
