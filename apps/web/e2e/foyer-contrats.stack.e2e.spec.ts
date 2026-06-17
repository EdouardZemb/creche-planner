import { test, expect } from '@playwright/test';
import { lireEtatSeed, urlContrats } from './support/stack';

// Parcours PILOTE de la Phase 15 (Lot 1) — valide la MÉCANIQUE du harnais
// E2E « stack réelle » : seed → stack Docker → vraie UI → assertions, SANS mock réseau.
//
// Régression couverte (doc 14) : les contrats étaient INVISIBLES dans l'UI car le
// front lisait le sessionStorage au lieu de l'API. Ici on vérifie contre la pile
// réelle que /foyers/:id/contrats liste bien les 4 contrats seedés, lus via
// GET /api/v1/contrats?foyer=<uuid>.
//
// Les 4 contrats seedés (scripts/seed-demo.mjs) :
//   - Zoé  / CRECHE_PSU   → « Zoé » + « Crèche PSU »
//   - Mia   / CRECHE_PSU   → « Mia »  + « Crèche PSU »
//   - Zoé  / CANTINE      → « Zoé » + « Cantine »
//   - Zoé  / PERISCOLAIRE → « Zoé » + « Périscolaire »

test('stack réelle : la page Contrats liste les 4 contrats seedés', async ({
  page,
}) => {
  // L'état du seed (UUID du foyer) est la source de vérité ; lève si le seed n'a pas tourné.
  const { foyerId } = lireEtatSeed();

  await page.goto(urlContrats(foyerId));

  // Fin du chargement : le titre de la page est rendu, puis l'indicateur
  // « Chargement des contrats… » disparaît (liste lue depuis l'API).
  await expect(
    page.getByRole('heading', { name: 'Contrats du foyer' }),
  ).toBeVisible();
  await expect(page.getByText('Chargement des contrats…')).toHaveCount(0);

  // Les deux enfants sont visibles (Zoé sur 3 contrats, Mia sur 1).
  await expect(page.getByText('Mia', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Zoé', { exact: true })).toHaveCount(3);

  // Les libellés de mode attendus (régression : ils s'affichaient vides / absents).
  await expect(page.getByText('Crèche PSU', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Cantine', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Périscolaire', { exact: true })).toHaveCount(1);

  // Garde globale : exactement 4 contrats listés (chaque ligne a un bouton « Modifier… »).
  await expect(
    page.getByRole('button', { name: /^Modifier le contrat de / }),
  ).toHaveCount(4);
});
