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

/**
 * Crée un foyer **isolé** avec un unique parent (via l'API BFF, mode hérité en
 * stack e2e), et renvoie son id. Sert les scénarios « retrait de parent » : un
 * foyer dédié évite de dépendre du nombre de parents du foyer seedé et de heurter
 * la garde « dernier parent actif » (le retrait exige ≥ 2 parents, sauf le test
 * qui la vérifie justement).
 */
async function creerFoyerAvecParent(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const reponse = await request.post('/api/v1/foyers', {
    data: {
      ressourcesMensuelles: 3000,
      rfr: 30000,
      nbEnfantsACharge: 1,
      nbParts: 2,
      enfants: [],
      parents: [{ email }],
    },
  });
  expect(reponse.ok()).toBeTruthy();
  const dossier = (await reponse.json()) as { foyer: { id: string } };
  return dossier.foyer.id;
}

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

// Gestion des parents (P3) : depuis l'écran d'édition, le parent ajoute un
// nouveau parent puis le retire — écritures unitaires contre la pile réelle
// (POST puis DELETE /api/v1/foyers/:id/parents[...]). Le retrait passe désormais
// par une modale de confirmation (geste destructif, Lot 1).
//
// Foyer DÉDIÉ avec un parent initial : le retrait du parent ajouté laisse ≥ 1
// parent actif (garde « dernier parent » non déclenchée) et isole ce test.
test('stack réelle : le parent ajoute puis retire un parent (via modale)', async ({
  page,
  request,
}) => {
  const foyerId = await creerFoyerAvecParent(
    request,
    `parent-init-${Date.now()}@example.test`,
  );
  const email = `parent-e2e-${Date.now()}@example.test`;

  await page.goto(urlModifier(foyerId));
  await expect(
    page.getByRole('heading', { name: 'Modifier le foyer' }),
  ).toBeVisible();

  // Le bloc « Ajouter un parent » porte ses propres champs (l'écran affiche déjà
  // le parent initial) → on s'y limite via son conteneur.
  const blocAjout = page.locator('.parent-ligne', {
    hasText: 'Ajouter un parent',
  });
  await blocAjout.getByLabel(/Adresse e-mail/).fill(email);
  await blocAjout.getByRole('button', { name: '+ Ajouter ce parent' }).click();

  // Le parent ajouté apparaît comme une ligne éditable : son bouton « Retirer »
  // porte sa désignation par défaut (sans prénom/nom = l'e-mail) dans son nom
  // accessible, ce qui l'identifie sans ambiguïté.
  const boutonRetirer = page.getByRole('button', {
    name: `Retirer le parent ${email}`,
  });
  await expect(boutonRetirer).toBeVisible();

  await boutonRetirer.click();

  // Confirmation obligatoire : le clic « Retirer » DANS la modale déclenche le retrait.
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Retirer', exact: true })
    .click();

  // Retiré : la ligne (et son bouton) disparaît de l'écran.
  await expect(boutonRetirer).toHaveCount(0);
});

// Garde « dernier parent actif » (Lot 1) : sur un foyer à un seul parent, tenter
// de le retirer est REFUSÉ par svc-foyer (409 DERNIER_PARENT_ACTIF) → message
// explicite et la ligne demeure. La garde ne modifie rien → sûr sur la pile.
test('stack réelle : retirer le dernier parent est bloqué avec un message explicite', async ({
  page,
  request,
}) => {
  const email = `dernier-parent-${Date.now()}@example.test`;
  const foyerId = await creerFoyerAvecParent(request, email);

  await page.goto(urlModifier(foyerId));
  const boutonRetirer = page.getByRole('button', {
    name: `Retirer le parent ${email}`,
  });
  await expect(boutonRetirer).toBeVisible();
  await boutonRetirer.click();

  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Retirer', exact: true })
    .click();

  // Refus explicite (message Lot 1) et la ligne reste affichée.
  await expect(
    page.getByText(/Impossible de retirer le dernier parent/),
  ).toBeVisible();
  await expect(boutonRetirer).toBeVisible();
});

// Gestion des enfants (P4) : depuis l'écran d'édition, le parent ajoute un
// enfant, l'édite (renommage) puis le supprime — écritures unitaires contre la
// pile réelle (POST / PUT / DELETE /api/v1/foyers/:id/enfants[...]).
//
// Auto-nettoyant : la suppression est un HARD DELETE, donc l'enfant ajouté ne
// laisse aucune trace en BDD à la fin (pas d'afterEach de restauration requis).
// Le prénom est rendu unique par exécution pour l'identifier parmi d'éventuels
// enfants seedés.
test('stack réelle : le parent ajoute, édite puis supprime un enfant', async ({
  page,
}) => {
  const { foyerId } = lireEtatSeed();
  const prenom = `EnfantE2E${Date.now()}`;
  const prenomModifie = `${prenom}-bis`;

  await page.goto(urlModifier(foyerId));
  await expect(
    page.getByRole('heading', { name: 'Modifier le foyer' }),
  ).toBeVisible();

  // Ajout via le bloc dédié (l'écran peut déjà afficher des enfants seedés).
  const blocAjout = page.locator('.enfant-ligne', {
    hasText: 'Ajouter un enfant',
  });
  await blocAjout.getByLabel(/Prénom/).fill(prenom);
  await blocAjout.getByLabel(/Date de naissance/).fill('2024-12-08');
  await blocAjout.getByRole('button', { name: '+ Ajouter cet enfant' }).click();

  // L'enfant ajouté apparaît comme une ligne éditable : son bouton « Supprimer »
  // porte sa désignation (le prénom) dans son nom accessible.
  const boutonSupprimer = page.getByRole('button', {
    name: `Supprimer l’enfant ${prenom}`,
  });
  await expect(boutonSupprimer).toBeVisible();

  // Édition : on renomme l'enfant dans SA ligne (celle qui porte ce bouton). Le
  // nom accessible du bouton « Supprimer » suit le prénom saisi → après l'avoir
  // renommé, on re-cible la ligne par le NOUVEAU nom pour enregistrer/supprimer
  // (l'ancien locator ne matcherait plus).
  await page
    .locator('.enfant-ligne', { has: boutonSupprimer })
    .getByLabel(/Prénom/)
    .fill(prenomModifie);

  const boutonSupprimerModifie = page.getByRole('button', {
    name: `Supprimer l’enfant ${prenomModifie}`,
  });
  const ligneModifiee = page.locator('.enfant-ligne', {
    has: boutonSupprimerModifie,
  });
  await ligneModifiee.getByRole('button', { name: 'Enregistrer' }).click();

  // Suppression (hard delete) : le clic ouvre la modale de confirmation (Lot 1),
  // puis le clic « Supprimer » DANS la modale efface la ligne.
  await boutonSupprimerModifie.click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Supprimer', exact: true })
    .click();
  await expect(boutonSupprimerModifie).toHaveCount(0);
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
