import { test, expect, type Page } from '@playwright/test';
import { lireEtatSeed, urlPlanning } from './support/stack';

// Parcours « saisie de planning crèche (CRECHE_PSU) » sur stack réelle (Lot C).
//
// Complète la couverture E2E de la saisie laissée ouverte par
// `planning-ajustement.stack.e2e.spec.ts` (qui ne couvre que le mode CANTINE).
// On valide ici, sur le calendrier crèche de Zoé, trois parcours :
//   (a) AJOUT d'un jour de garde ponctuel (jour non gardé du contrat) ;
//   (b) ABSENCE pleine journée puis ABSENCE PARTIELLE (heures d'arrivée/départ) ;
//   (c) portée « TOUS LES MOIS » = modification DURABLE du contrat (puis revert).
//
// IMPORTANT : la BDD est seedée une fois pour toute la suite (scripts/seed-demo.mjs)
// et la spec des coûts annuels assert des montants précis (Zoé 412,20 € + Mia
// 438,96 € = 851,16 € de janvier à juillet 2026). Chaque test ci-dessous REVIENT
// à l'état nominal pour ne PAS contaminer les autres specs :
//   - (a) supprime le jour ajouté ;
//   - (b) supprime l'absence ;
//   - (c) ré-applique « tous les mois » l'opération inverse → la semaine-type du
//     contrat retrouve sa forme seedée (LUNDI/MERCREDI/VENDREDI). La
//     mensualité crèche est calculée à partir du contrat (heuresAnnuelles /
//     nbMensualites), conservées par `modifierContrat` ; le cascade-delete des
//     `planning_mois` n'affecte donc pas le coût de base, qui reconverge.
//
// Contrat crèche seedé (Zoé, CRECHE_PSU, 01/01 → 31/07/2026) :
//   LUNDI · MERCREDI · VENDREDI, 08:30–17:00 (semaine type indicative).
// Mois de travail : juin 2026.
//   - 2026-06-01 = LUNDI    → jour gardé (absences)
//   - 2026-06-02 = MARDI    → jour NON gardé (ajout ponctuel / durable)

/** Cellule de jour FullCalendar (v6) pour la date ISO donnée. */
function cellule(page: Page, iso: string) {
  return page.locator(`td.fc-daygrid-day[data-date="${iso}"]`);
}

/** Date ISO `YYYY-MM-DD` → libellé français `JJ/MM/AAAA` (comme l'UI). */
function libelleFr(iso: string): string {
  const [a, m, j] = iso.split('-');
  return `${j}/${m}/${a}`;
}

/** Exécute `action` puis attend l'enregistrement serveur du planning (PUT, debounce 800 ms). */
async function attendreEnregistrement(page: Page, action: () => Promise<void>) {
  const reponse = page.waitForResponse(
    (r) => /\/plannings\//.test(r.url()) && r.request().method() === 'PUT',
  );
  await action();
  await reponse;
}

/** Exécute `action` puis attend la modification durable du contrat (PUT /contrats/:id). */
async function attendreModifContrat(page: Page, action: () => Promise<void>) {
  const reponse = page.waitForResponse(
    (r) => /\/contrats\/[^/]+$/.test(r.url()) && r.request().method() === 'PUT',
  );
  await action();
  await reponse;
}

/**
 * Ouvre la modale d'absence d'un jour GARDÉ via la liste clavier accessible
 * (« Saisir » / « Modifier ») plutôt que par un clic sur la grille FullCalendar
 * (dont le `dateClick` sur un jour porteur d'événement est peu fiable à piloter).
 * Renvoie le dialog ouvert.
 */
async function ouvrirAbsence(page: Page, iso: string) {
  const ligne = page
    .getByRole('group', { name: /Saisir une absence/i })
    .getByRole('listitem')
    .filter({ hasText: libelleFr(iso) });
  await ligne.getByRole('button', { name: /Saisir|Modifier/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * Ouvre la modale d'AJOUT/ÉDITION d'un jour NON gardé. Ces jours ne figurent
 * PAS dans la liste clavier (réservée aux jours gardés) : on passe donc par le
 * `dateClick` de la grille FullCalendar.
 *
 * Piège (mémoire de phases) : le `dateClick` est PEU FIABLE à piloter. Deux
 * parades combinées ici :
 *  - cibler `.fc-daygrid-day-top` (la zone du numéro de jour), JAMAIS le centre
 *    de la cellule : quand le jour porte déjà une pastille « Ajouté » (dans
 *    `.fc-daygrid-day-events`), un clic au centre tombe sur l'événement et ne
 *    déclenche pas `dateClick` ;
 *  - réessayer le clic jusqu'à ce que la modale s'ouvre (le handler peut rater
 *    un premier clic sur une grille fraîchement (re)montée).
 * Renvoie le dialog ouvert.
 */
async function ouvrirAjout(page: Page, iso: string) {
  const haut = cellule(page, iso).locator('.fc-daygrid-day-top');
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    await haut.click();
    await expect(dialog).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15000 });
  return dialog;
}

/**
 * Ouvre la page Planning sur le mois donné et force l'onglet « Crèche PSU » de
 * Zoé (sans dépendre de l'ordre des contrats), puis attend que la grille soit
 * prête. Reproduit le parcours d'`planning-creche.stack.e2e.spec.ts`.
 */
async function ouvrirPlanningCreche(page: Page, foyerId: string, mois: string) {
  await page.goto(`${urlPlanning(foyerId)}?mois=${mois}&enfant=Zoé`);
  await expect(
    page.getByRole('heading', { name: 'Planning mensuel' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Crèche PSU' }).click();
}

test.describe('stack réelle : saisie de planning crèche (Zoé)', () => {
  const MOIS = '2026-06';
  const LUNDI = '2026-06-01'; // jour gardé
  const MARDI = '2026-06-02'; // jour non gardé

  test('(a) ajouter un jour de garde ponctuel persiste après rechargement', async ({
    page,
  }) => {
    const { foyerId } = lireEtatSeed();
    await ouvrirPlanningCreche(page, foyerId, MOIS);
    await expect(cellule(page, MARDI)).toBeVisible();

    // État initial : mardi non gardé → aucun événement sur la cellule.
    await expect(cellule(page, MARDI).locator('.fc-event-title')).toHaveCount(
      0,
    );

    // Ajouter le mardi (jour supplémentaire ponctuel). Heures par défaut.
    let dialog = await ouvrirAjout(page, MARDI);
    await expect(dialog).toContainText(`Ajouter le ${libelleFr(MARDI)}`);
    await attendreEnregistrement(page, () =>
      dialog.getByRole('button', { name: 'Confirmer' }).click(),
    );

    // Le jour passe « Ajouté » et l'écart vs contrat le reflète (+1 jour).
    // (On matche la partie ASCII pour éviter la normalisation Unicode de « Écart ».)
    await expect(cellule(page, MARDI).locator('.fc-event-title')).toHaveText(
      'Ajouté',
    );
    await expect(page.getByText(/\+1\s+jour/)).toBeVisible();

    // PERSISTANCE : après rechargement, l'ajout est restitué depuis le serveur.
    await page.reload();
    await expect(cellule(page, MARDI)).toBeVisible();
    await expect(cellule(page, MARDI).locator('.fc-event-title')).toHaveText(
      'Ajouté',
    );

    // Nettoyage : supprimer le jour ajouté (retour à l'état nominal seedé).
    dialog = await ouvrirAjout(page, MARDI);
    await attendreEnregistrement(page, () =>
      dialog.getByRole('button', { name: 'Supprimer' }).click(),
    );
    await expect(cellule(page, MARDI).locator('.fc-event-title')).toHaveCount(
      0,
    );
  });

  test('(b) absence pleine journée puis partielle (heures) persiste après rechargement', async ({
    page,
  }) => {
    const { foyerId } = lireEtatSeed();
    await ouvrirPlanningCreche(page, foyerId, MOIS);
    await expect(cellule(page, LUNDI)).toBeVisible();

    // État initial : lundi gardé → événement « Gardé ».
    await expect(cellule(page, LUNDI).locator('.fc-event-title')).toHaveText(
      'Gardé',
    );

    // 1) Absence PLEINE JOURNÉE (case « Absence toute la journée » cochée par défaut).
    let dialog = await ouvrirAbsence(page, LUNDI);
    await expect(dialog).toContainText(`Absence du ${libelleFr(LUNDI)}`);
    await expect(dialog.getByLabel('Absence toute la journée')).toBeChecked();
    await attendreEnregistrement(page, () =>
      dialog.getByRole('button', { name: 'Confirmer' }).click(),
    );

    // Le jour passe « Absent » et l'écart vs contrat le reflète (-1 jour).
    await expect(cellule(page, LUNDI).locator('.fc-event-title')).toHaveText(
      'Absent',
    );
    await expect(page.getByText(/-1\s+jour/)).toBeVisible();

    // PERSISTANCE : après rechargement, l'absence est restituée depuis le serveur.
    await page.reload();
    await expect(cellule(page, LUNDI).locator('.fc-event-title')).toHaveText(
      'Absent',
    );

    // 2) ABSENCE PARTIELLE : passer en heures d'arrivée/départ (décocher « toute
    //    la journée ») et saisir une plage. La modale rouvre via « Modifier ».
    dialog = await ouvrirAbsence(page, LUNDI);
    const caseJournee = dialog.getByLabel('Absence toute la journée');
    await caseJournee.uncheck();
    await dialog.getByLabel('Heure d’arrivée').fill('11:00');
    await dialog.getByLabel('Heure de départ').fill('14:00');
    await attendreEnregistrement(page, () =>
      dialog.getByRole('button', { name: 'Confirmer' }).click(),
    );

    // L'absence partielle compte toujours comme un retrait de jour (écart -1).
    await expect(cellule(page, LUNDI).locator('.fc-event-title')).toHaveText(
      'Absent',
    );

    // PERSISTANCE : la plage horaire saisie est réhydratée → « toute la journée »
    // n'est plus cochée (la plage ne couvre pas toute la garde du contrat).
    // On attend que la réhydratation serveur ait marqué le jour « Absent » avant
    // d'ouvrir la modale (sinon `ouvrirSaisie` lit un état encore vide).
    await page.reload();
    await expect(cellule(page, LUNDI).locator('.fc-event-title')).toHaveText(
      'Absent',
    );
    dialog = await ouvrirAbsence(page, LUNDI);
    await expect(
      dialog.getByLabel('Absence toute la journée'),
    ).not.toBeChecked();
    await expect(dialog.getByLabel('Heure d’arrivée')).toHaveValue('11:00');
    await expect(dialog.getByLabel('Heure de départ')).toHaveValue('14:00');

    // Nettoyage : supprimer l'absence (retour à l'état nominal seedé).
    await attendreEnregistrement(page, () =>
      dialog.getByRole('button', { name: 'Supprimer' }).click(),
    );
    await expect(cellule(page, LUNDI).locator('.fc-event-title')).toHaveText(
      'Gardé',
    );
  });

  test('(c) portée « tous les mois » modifie durablement le contrat (puis revert)', async ({
    page,
  }) => {
    const { foyerId } = lireEtatSeed();
    await ouvrirPlanningCreche(page, foyerId, MOIS);
    await expect(cellule(page, MARDI)).toBeVisible();

    // État initial : le mardi n'est PAS un jour gardé du contrat.
    await expect(cellule(page, MARDI).locator('.fc-event-title')).toHaveCount(
      0,
    );

    // 1) AJOUT DURABLE : ouvrir le mardi, choisir « Tous les mois », confirmer.
    //    Une modale de confirmation (modification du contrat) s'ouvre ensuite.
    let dialog = await ouvrirAjout(page, MARDI);
    await dialog.getByRole('radio', { name: /Tous les mois/ }).check();
    await dialog.getByRole('button', { name: 'Confirmer' }).click();

    const confirmation = page.getByRole('dialog', {
      name: 'Modifier le contrat ?',
    });
    await expect(confirmation).toBeVisible();
    await attendreModifContrat(page, () =>
      confirmation.getByRole('button', { name: 'Modifier le contrat' }).click(),
    );

    // Le contrat est rechargé : le mardi devient un jour gardé (événement « Gardé »).
    await expect(cellule(page, MARDI).locator('.fc-event-title')).toHaveText(
      'Gardé',
    );

    // PERSISTANCE : après rechargement, le mardi gardé est restitué (contrat durci).
    await page.reload();
    await expect(cellule(page, MARDI).locator('.fc-event-title')).toHaveText(
      'Gardé',
    );

    // 2) REVERT DURABLE : retirer à nouveau le mardi « tous les mois » pour
    //    restaurer la semaine-type seedée (LUNDI/MERCREDI/VENDREDI). Le
    //    mardi étant désormais gardé, on passe par la liste clavier (absence).
    dialog = await ouvrirAbsence(page, MARDI);
    await dialog.getByRole('radio', { name: /Tous les mois/ }).check();
    await dialog.getByRole('button', { name: 'Confirmer' }).click();

    const confirmation2 = page.getByRole('dialog', {
      name: 'Modifier le contrat ?',
    });
    await expect(confirmation2).toBeVisible();
    await attendreModifContrat(page, () =>
      confirmation2
        .getByRole('button', { name: 'Modifier le contrat' })
        .click(),
    );

    // Retour à l'état nominal : le mardi n'est plus gardé.
    await expect(cellule(page, MARDI).locator('.fc-event-title')).toHaveCount(
      0,
    );
    await page.reload();
    await expect(cellule(page, MARDI).locator('.fc-event-title')).toHaveCount(
      0,
    );
  });
});
