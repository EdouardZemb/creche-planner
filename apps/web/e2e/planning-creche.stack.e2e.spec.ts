import { test, expect } from '@playwright/test';
import { lireEtatSeed, urlPlanning } from './support/stack';

// Parcours Phase 15 (Lot 2) — RÉGRESSION `CalendrierCreche` : le calendrier crèche
// marquait TOUT le mois « gardé » (week-end compris) parce que la semaine-type porte
// les 7 jours, les jours non gardés étant un tableau vide `[]`. Le correctif ne marque
// un jour que s'il porte AU MOINS une plage horaire (semaineType[jour].length > 0).
//
// Données seedées (jeu de référence) (scripts/seed-demo.mjs) : crèche PSU Zoé + Mia,
// 2026-01 → 2026-07, jours gardés = LUNDI, MERCREDI, VENDREDI
// (PAS mardi/jeudi, PAS samedi/dimanche).
//
// Approche : on s'appuie sur la LISTE clavier « Saisir une absence » de
// CalendrierCreche, qui rend exactement `joursGardesListe` (les jours réellement
// gardés du mois) — c'est la MÊME logique que celle de la régression, donc une
// assertion fidèle, et bien plus robuste que d'inspecter le canvas FullCalendar.
// Chaque jour gardé y est rendu via formaterDateFr → « JJ/MM/AAAA ».

// Mois de référence : mars 2026 (plein dans la période contractuelle crèche).
const MOIS = '2026-03';

// Jours de mars 2026, déduits du calendrier (1er mars 2026 = dimanche).
// Gardés (lun/mer/ven) — échantillon attendu PRÉSENT dans la liste :
const JOURS_GARDES_ATTENDUS = [
  '02/03/2026', // lundi
  '04/03/2026', // mercredi
  '06/03/2026', // vendredi
  '09/03/2026', // lundi
  '11/03/2026', // mercredi
  '13/03/2026', // vendredi
];
// Non gardés — mardis + jeudis + week-ends — échantillon attendu ABSENT de la liste :
const JOURS_NON_GARDES_ATTENDUS = [
  '03/03/2026', // mardi (jour ouvré mais NON contractualisé)
  '10/03/2026', // mardi
  '05/03/2026', // jeudi (jour ouvré mais NON contractualisé)
  '12/03/2026', // jeudi
  '01/03/2026', // dimanche
  '07/03/2026', // samedi
  '08/03/2026', // dimanche
  '15/03/2026', // dimanche
];

test('stack réelle : le calendrier crèche marque lun/mer/ven, PAS le week-end', async ({
  page,
}) => {
  const { foyerId } = lireEtatSeed();

  // Navigation directe : le foyer vient de l'URL. Le mois est porté par le query
  // param `mois` (PlanningPage lit searchParams), inutile de manipuler l'input.
  await page.goto(`${urlPlanning(foyerId)}?mois=${MOIS}`);

  // Le premier enfant (Zoé) et son contrat crèche valide pour mars 2026 sont
  // sélectionnés par défaut (contratValidePourMois). On force malgré tout l'onglet
  // mode « Crèche » pour ne dépendre d'aucun ordre de contrats.
  await expect(
    page.getByRole('heading', { name: 'Planning mensuel' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Crèche' }).click();

  // La liste clavier des jours gardés ne s'affiche que s'il existe au moins un
  // jour gardé : sa présence prouve déjà que le mois est bien « crèche ».
  const listeJoursGardes = page
    .getByRole('group', { name: /Saisir une absence/i })
    .getByRole('listitem');
  await expect(listeJoursGardes.first()).toBeVisible();

  // Mars 2026 : 5 lundis, 4 mercredis, 4 vendredis = 13 jours gardés.
  await expect(listeJoursGardes).toHaveCount(13);

  // Chaque jour gardé attendu (lun/mer/ven) est PRÉSENT dans la liste.
  for (const jour of JOURS_GARDES_ATTENDUS) {
    await expect(
      listeJoursGardes.filter({ hasText: jour }),
      `Le ${jour} doit être marqué gardé`,
    ).toHaveCount(1);
  }

  // Cœur de la régression : AUCUN mardi/jeudi ni jour de week-end n'est marqué gardé.
  for (const jour of JOURS_NON_GARDES_ATTENDUS) {
    await expect(
      listeJoursGardes.filter({ hasText: jour }),
      `Le ${jour} ne doit PAS être marqué gardé (régression week-end/mardi)`,
    ).toHaveCount(0);
  }
});
