import { test, expect } from '@playwright/test';
import { lireEtatSeed, urlContrats } from './support/stack';

/**
 * Parcours « versionnement du contrat » (SFD 30 lot 5) contre la stack réelle :
 *   - « Modifier » ouvre le choix avenant / correction / historique (pas d'édition
 *     directe destructive) ;
 *   - un avenant à une date future s'enregistre et l'historique montre 2 versions ;
 *   - la correction affiche un aperçu d'impact (mois recalculés) avant enregistrement.
 *
 * On cible le contrat de Mia (unique, CRECHE_PSU) pour un libellé non ambigu.
 */

test('stack réelle : avenant + historique + aperçu de correction', async ({
  page,
}) => {
  const { foyerId } = lireEtatSeed();
  await page.goto(urlContrats(foyerId));

  await expect(
    page.getByRole('heading', { name: 'Contrats', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Chargement des contrats…')).toHaveCount(0);

  // 1) « Modifier » ouvre le menu de choix (langage parent, sans jargon).
  await page
    .getByRole('button', { name: 'Modifier le contrat de Mia' })
    .click();
  const menu = page.getByRole('dialog');
  await expect(menu).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Changer à partir d’une date/ }),
  ).toBeVisible();

  // 2) Avenant à une date future : garde le passé, applique les nouveaux paramètres.
  await page
    .getByRole('button', { name: /Changer à partir d’une date/ })
    .click();
  const dateEffet = page.getByLabel('À partir du');
  await expect(dateEffet).toBeVisible();
  // H6 : aucun champ d'identité (enfant / mode / établissement) dans l'avenant.
  await expect(page.getByLabel('Enfant')).toHaveCount(0);

  const anneeProchaine = new Date().getFullYear() + 1;
  await dateEffet.fill(`${anneeProchaine}-09-01`);
  await page.getByRole('button', { name: 'Enregistrer le changement' }).click();

  await expect(
    page.getByText(/Changement enregistré pour le contrat de Mia/),
  ).toBeVisible();

  // 3) L'historique montre désormais (au moins) deux versions.
  await page
    .getByRole('button', { name: 'Modifier le contrat de Mia' })
    .click();
  await page.getByRole('button', { name: /Voir l’historique/ }).click();
  await expect(page.getByText('Historique — Mia')).toBeVisible();
  await expect(page.getByText(/À partir du/).first()).toBeVisible();
  const lignes = page.getByRole('listitem');
  expect(await lignes.count()).toBeGreaterThanOrEqual(2);

  // 4) La correction affiche un aperçu d'impact (mois recalculés) avant d'écrire.
  await page
    .getByRole('button', { name: 'Modifier le contrat de Mia' })
    .click();
  await page
    .getByRole('button', { name: /Corriger les paramètres actuels/ })
    .click();
  await page.getByRole('button', { name: /Voir l’impact et corriger/ }).click();
  // L'aperçu d'impact liste les mois recalculés (au moins un).
  await expect(page.getByText(/recalculé/)).toBeVisible();
  // On quitte sans corriger : rien n'est écrit.
  await page.getByRole('button', { name: 'Annuler' }).first().click();
});
