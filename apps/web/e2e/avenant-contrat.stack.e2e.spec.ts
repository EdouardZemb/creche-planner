import { test, expect } from '@playwright/test';
import { lireEtatSeed, urlContrats } from './support/stack';

/**
 * Parcours « versionnement du contrat » (SFD 30 lot 5) contre la stack réelle :
 *   - « Modifier » ouvre le choix avenant / correction / historique (pas d'édition
 *     directe destructive) ;
 *   - un avenant à une date future s'enregistre et l'historique montre 2 versions ;
 *   - la correction affiche un aperçu d'impact (mois recalculés) avant enregistrement.
 *
 * L'avenant cible le contrat de Mia (unique, CRECHE_PSU → libellé non ambigu) ;
 * l'aperçu de correction cible la crèche de Zoé, JAMAIS mutée par ce test :
 * « Corriger les paramètres actuels » vise la version encore ouverte, or après
 * l'avenant celle de Mia est l'avenant futur — au-delà de la fin de son contrat,
 * donc zéro mois couvert. Sur Zoé, la version courante couvre les mois enregistrés
 * du seed, et l'aperçu reste vérifiable même au retry Playwright (pile déjà mutée
 * par la tentative précédente).
 */

test('stack réelle : avenant + historique + aperçu de correction', async ({
  page,
}, testInfo) => {
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
  // Date d'effet unique PAR TENTATIVE : l'avenant créé ici survit dans la pile
  // au retry Playwright (CI), et reposer la même date répond « Un changement
  // existe déjà à cette date » — le toast de succès n'apparaît alors jamais.
  const jourEffet = String(1 + testInfo.retry).padStart(2, '0');
  await dateEffet.fill(`${anneeProchaine}-09-${jourEffet}`);
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
  //    Sur la crèche de Zoé (cf. en-tête) — sa carte est ciblée par enfant + mode,
  //    car « Modifier le contrat de Zoé » existe aussi pour cantine/périscolaire.
  await page
    .locator('.carte-contrat')
    .filter({ hasText: 'Zoé' })
    .filter({ hasText: 'Crèche' })
    .getByRole('button', { name: 'Modifier le contrat de Zoé' })
    .click();
  await page
    .getByRole('button', { name: /Corriger les paramètres actuels/ })
    .click();
  await page.getByRole('button', { name: /Voir l’impact et corriger/ }).click();
  // L'aperçu d'impact liste les mois recalculés (au moins un). Motif avec
  // décompte (« N mois sera/seront recalculé(s) ») : les intros statiques du
  // formulaire et de la modale contiennent aussi « recalculés » — un /recalculé/
  // nu matche plusieurs éléments (violation strict mode) et passerait même sans
  // impact chargé.
  await expect(
    page.getByText(/\d+ mois (sera|seront) recalculé/),
  ).toBeVisible();
  // On quitte sans corriger : rien n'est écrit. Le Annuler visé est celui DE LA
  // MODALE (le formulaire de correction en a un aussi, sous l'overlay qui
  // intercepte les clics).
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Annuler' })
    .click();
});
