import { test, expect, type Page } from '@playwright/test';
import { lireEtatSeed, urlPlanning } from './support/stack';

// Parcours Phase 15 (Lot 2) — RÉGRESSION « garde de période » sur le calendrier ABCM.
// Deux propriétés à verrouiller :
//   1. Les jours réservés (cantine / périscolaire) n'apparaissent QU'aux jours inscrits
//      dans la semaine ABCM, et PAS les autres jours ouvrés.
//   2. AUCUN jour ABCM n'est marqué AVANT la date de validité du contrat
//      (valideDu = 2026-09-01) : la garde de période interdit d'afficher des présences
//      sur un mois antérieur à la rentrée.
//
// Données seedées (jeu de référence) (scripts/seed-demo.mjs), Zoé :
//   - CANTINE      : LUNDI, JEUDI          (à partir du 2026-09-01)
//   - PERISCOLAIRE : VENDREDI (péri soir)  (à partir du 2026-09-01)
//
// Le calendrier ABCM (CalendrierAbcm) ne fournit PAS de liste clavier pour
// CANTINE/PERISCOLAIRE (réservée à l'ALSH) : on inspecte donc le rendu FullCalendar.
// En v6, chaque jour est un `td.fc-daygrid-day[data-date="YYYY-MM-DD"]` et le titre
// d'un évènement est rendu dans `.fc-event-title`. On scope par cellule de jour.

/** Cellule de jour FullCalendar (v6) pour la date ISO donnée. */
function cellule(page: Page, iso: string) {
  return page.locator(`td.fc-daygrid-day[data-date="${iso}"]`);
}

/**
 * Titres d'évènements rendus DANS la grille du calendrier (`.fc-event-title`).
 * On scope sur la grille pour ne pas confondre avec le libellé du mode affiché
 * dans l'onglet (« Cantine ») ou l'en-tête du panneau (« — Cantine »).
 */
function evenements(page: Page, titre: string) {
  return page.locator('.fc-event-title', { hasText: titre });
}

test('stack réelle : ABCM cantine lun/jeu + péri vendredi, rien les autres jours', async ({
  page,
}) => {
  const { foyerId } = lireEtatSeed();

  // Octobre 2026 : plein dans l'année scolaire 2026/2027 (contrat ABCM actif).
  await page.goto(`${urlPlanning(foyerId)}?mois=2026-10&enfant=Zoé`);
  await expect(
    page.getByRole('heading', { name: 'Planning mensuel' }),
  ).toBeVisible();

  // --- CANTINE : lun/jeu marqués, mardi/mercredi/vendredi/week-end NON -------
  await page.getByRole('tab', { name: 'Cantine' }).click();
  // Attendre que le calendrier soit monté (la grille FullCalendar est rendue).
  await expect(cellule(page, '2026-10-01')).toBeVisible();

  // Semaine du 5 au 11 octobre 2026 (lundi 5 → dimanche 11).
  await expect(
    cellule(page, '2026-10-05').locator('.fc-event-title'),
    'lundi → cantine',
  ).toHaveText('Cantine');
  await expect(
    cellule(page, '2026-10-08').locator('.fc-event-title'),
    'jeudi → cantine',
  ).toHaveText('Cantine');
  // Mardi, mercredi, vendredi et week-end : pas de cantine (jours NON inscrits).
  await expect(
    cellule(page, '2026-10-06').locator('.fc-event-title'),
    'mardi → pas de cantine',
  ).toHaveCount(0);
  await expect(
    cellule(page, '2026-10-07').locator('.fc-event-title'),
    'mercredi → pas de cantine',
  ).toHaveCount(0);
  await expect(
    cellule(page, '2026-10-09').locator('.fc-event-title'),
    'vendredi → pas de cantine',
  ).toHaveCount(0);
  await expect(
    cellule(page, '2026-10-10').locator('.fc-event-title'),
    'samedi → pas de cantine',
  ).toHaveCount(0);
  await expect(
    cellule(page, '2026-10-11').locator('.fc-event-title'),
    'dimanche → pas de cantine',
  ).toHaveCount(0);

  // --- PERISCOLAIRE : vendredi marqué, autres jours NON ---------------------
  await page.getByRole('tab', { name: 'Périscolaire' }).click();
  await expect(cellule(page, '2026-10-01')).toBeVisible();

  // Zoé n'a que le péri SOIR le vendredi → le calendrier affiche « Soir »
  // (titre par séance, plus précis que le générique « Périscolaire »).
  await expect(
    cellule(page, '2026-10-09').locator('.fc-event-title'),
    'vendredi → périscolaire (soir)',
  ).toHaveText('Soir');
  // Lundi/jeudi (jours cantine) ne portent PAS de périscolaire.
  await expect(
    cellule(page, '2026-10-05').locator('.fc-event-title'),
    'lundi → pas de périscolaire',
  ).toHaveCount(0);
  await expect(
    cellule(page, '2026-10-08').locator('.fc-event-title'),
    'jeudi → pas de périscolaire',
  ).toHaveCount(0);
});

test('stack réelle : garde de période — aucun jour ABCM avant la rentrée (juin 2026)', async ({
  page,
}) => {
  const { foyerId } = lireEtatSeed();

  // Juin 2026 : AVANT la rentrée (contrat ABCM valideDu = 2026-09-01).
  // Aucune présence cantine/péri ne doit apparaître (garde de période).
  await page.goto(
    `${urlPlanning(foyerId)}?mois=2026-06&enfant=Zoé&mode=CANTINE`,
  );
  await expect(
    page.getByRole('heading', { name: 'Planning mensuel' }),
  ).toBeVisible();

  // Le calendrier est monté…
  await expect(cellule(page, '2026-06-01')).toBeVisible();
  // …mais AUCUN évènement « Cantine » n'est rendu dans la grille sur tout le mois
  // (on scope sur .fc-event-title pour ignorer l'onglet/le titre « Cantine »).
  await expect(evenements(page, 'Cantine')).toHaveCount(0);

  // Idem pour le périscolaire (titre par séance « Soir » pour Zoé).
  await page.getByRole('tab', { name: 'Périscolaire' }).click();
  await expect(cellule(page, '2026-06-01')).toBeVisible();
  await expect(evenements(page, 'Soir')).toHaveCount(0);
});
