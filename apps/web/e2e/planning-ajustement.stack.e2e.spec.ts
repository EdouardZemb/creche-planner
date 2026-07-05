import { test, expect, type Page } from '@playwright/test';
import {
  lireEtatSeed,
  urlPlanning,
  attendreEnregistrementPlanning as attendreEnregistrement,
  rechargerEtRelirePlanning,
} from './support/stack';

// Parcours « ajustement de planning par jour » sur stack réelle.
// Vérifie l'ajout et le retrait ponctuels d'un jour (exceptions ABCM) ET leur
// PERSISTANCE serveur (rechargement de page → la saisie est réhydratée depuis
// `GET /api/v1/contrats/:id/plannings/:mois`).
//
// IMPORTANT : la BDD est seedée une fois pour toute la suite (scripts/seed-demo.mjs)
// et le test des coûts annuels assert des montants précis. Chaque test ci-dessous
// REVIENT à l'état nominal (bouton « Réinitialiser ») pour ne pas contaminer les
// autres specs.
//
// Données seedées (Zoé, CANTINE) : LUNDI/JEUDI à partir du 2026-09-01.
//   - 2026-10-05 = lundi (cantine réservée)
//   - 2026-10-07 = mercredi (pas de cantine)

/** Cellule de jour FullCalendar (v6) pour la date ISO donnée. */
function cellule(page: Page, iso: string) {
  return page.locator(`td.fc-daygrid-day[data-date="${iso}"]`);
}

/** Date ISO `YYYY-MM-DD` → libellé français `JJ/MM/AAAA` (comme l'UI). */
function libelleFr(iso: string): string {
  const [a, m, j] = iso.split('-');
  return `${j}/${m}/${a}`;
}

/**
 * Ouvre la modale d'ajustement d'un jour via la liste clavier accessible
 * (« Ajuster un jour ») plutôt que par un clic sur la grille FullCalendar (dont
 * le `dateClick` est peu fiable à piloter et entre en conflit avec l'eventClick
 * d'un jour déjà marqué). Renvoie le dialog ouvert.
 */
async function ouvrirAjustement(page: Page, iso: string) {
  const ligne = page.getByRole('listitem').filter({ hasText: libelleFr(iso) });
  await ligne.getByRole('button', { name: 'Ajuster' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('stack réelle : retirer un jour de cantine persiste après rechargement', async ({
  page,
}) => {
  const { foyerId } = lireEtatSeed();
  await page.goto(
    `${urlPlanning(foyerId)}?mois=2026-10&enfant=Zoé&mode=CANTINE`,
  );
  await expect(cellule(page, '2026-10-05')).toBeVisible();

  // État initial : lundi 05/10 = cantine réservée.
  await expect(
    cellule(page, '2026-10-05').locator('.fc-event-title'),
  ).toHaveText('Cantine');

  // Retirer la cantine du lundi (exception cantine=false).
  let dialog = await ouvrirAjustement(page, '2026-10-05');
  await dialog.getByLabel('Cantine', { exact: true }).uncheck();
  await attendreEnregistrement(page, () =>
    dialog.getByRole('button', { name: 'Confirmer' }).click(),
  );

  // Le jour passe « Retiré » et l'écart vs contrat le reflète (-1 jour).
  // (On matche la partie ASCII pour éviter la normalisation Unicode de « Écart ».)
  await expect(
    cellule(page, '2026-10-05').locator('.fc-event-title'),
  ).toHaveText('Retiré');
  await expect(page.getByText(/-1\s+jour/)).toBeVisible();

  // PERSISTANCE : après rechargement, le retrait est restitué depuis le serveur.
  await rechargerEtRelirePlanning(page);
  await expect(cellule(page, '2026-10-05')).toBeVisible();
  await expect(
    cellule(page, '2026-10-05').locator('.fc-event-title'),
  ).toHaveText('Retiré');

  // Nettoyage : réinitialiser le jour (retour à l'état nominal seedé).
  dialog = await ouvrirAjustement(page, '2026-10-05');
  await attendreEnregistrement(page, () =>
    dialog.getByRole('button', { name: 'Réinitialiser' }).click(),
  );
  await expect(
    cellule(page, '2026-10-05').locator('.fc-event-title'),
  ).toHaveText('Cantine');
});

test('stack réelle : ajouter un jour de cantine persiste après rechargement', async ({
  page,
}) => {
  const { foyerId } = lireEtatSeed();
  await page.goto(
    `${urlPlanning(foyerId)}?mois=2026-10&enfant=Zoé&mode=CANTINE`,
  );
  await expect(cellule(page, '2026-10-07')).toBeVisible();

  // État initial : mercredi 07/10 = pas de cantine.
  await expect(
    cellule(page, '2026-10-07').locator('.fc-event-title'),
  ).toHaveCount(0);

  // Ajouter la cantine le mercredi (exception cantine=true).
  let dialog = await ouvrirAjustement(page, '2026-10-07');
  await dialog.getByLabel('Cantine', { exact: true }).check();
  await attendreEnregistrement(page, () =>
    dialog.getByRole('button', { name: 'Confirmer' }).click(),
  );

  await expect(
    cellule(page, '2026-10-07').locator('.fc-event-title'),
  ).toHaveText('Ajouté');

  // PERSISTANCE : après rechargement, l'ajout est restitué depuis le serveur.
  await rechargerEtRelirePlanning(page);
  await expect(cellule(page, '2026-10-07')).toBeVisible();
  await expect(
    cellule(page, '2026-10-07').locator('.fc-event-title'),
  ).toHaveText('Ajouté');

  // Nettoyage : réinitialiser le jour (retour à l'état nominal seedé).
  dialog = await ouvrirAjustement(page, '2026-10-07');
  await attendreEnregistrement(page, () =>
    dialog.getByRole('button', { name: 'Réinitialiser' }).click(),
  );
  await expect(
    cellule(page, '2026-10-07').locator('.fc-event-title'),
  ).toHaveCount(0);
});
