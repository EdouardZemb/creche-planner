import { test, expect, type Page } from '@playwright/test';
import {
  lireEtatSeed,
  urlPlanning,
  attendreEnregistrementPlanning as attendreEnregistrement,
} from './support/stack';

// Parcours « Signaler une absence en 2 taps » (A1) sur stack réelle.
//
// Depuis le tableau de bord « Aujourd'hui », un bouton sur la rangée de garde
// CRÈCHE ouvre une modale de confirmation sans champ ; confirmer écrit une
// absence pleine journée par read-modify-write du mois (le PUT planning est un
// remplacement complet). On FIGE l'horloge du navigateur sur un LUNDI de garde de
// Zoé (semaine-type crèche seedée LUN/MER/VEN 08:30–17:00, contrat 01/01→31/07/2026)
// pour que le dashboard résolve ce jour comme « aujourd'hui ».
//
// IMPORTANT (comme les autres specs stack) : la BDD est seedée une fois pour toute
// la suite et la spec des coûts annuels assert des montants précis (Zoé 412,20 € +
// Mia 438,96 € = 851,16 €). Ce test REMET l'état nominal en fin de parcours :
// il supprime l'absence via le planning → la rangée du lundi 1er juin redevient
// « Gardé », sans contaminer les autres specs.

const MOIS = '2026-06';
const LUNDI = '2026-06-01'; // LUNDI gardé de Zoé, dans la période du contrat

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
 * Ouvre la page Planning sur le mois donné, force l'onglet « Crèche » de Zoé et
 * attend que la grille soit prête (reprend `planning-saisie-complete`).
 */
async function ouvrirPlanningCreche(page: Page, foyerId: string, mois: string) {
  await page.goto(`${urlPlanning(foyerId)}?mois=${mois}&enfant=Zoé`);
  await expect(
    page.getByRole('heading', { name: 'Planning mensuel' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Crèche' }).click();
}

test.describe('stack réelle : signaler une absence en 2 taps (Zoé)', () => {
  test('le dashboard signale l’absence, la rangée passe « Absent » et persiste', async ({
    page,
  }) => {
    const { foyerId } = lireEtatSeed();

    // Horloge navigateur figée au lundi 1er juin 2026 (jour de garde) : Date/now
    // renvoient ce jour, les timers (débounce/réseau) continuent de tourner.
    await page.clock.setFixedTime(new Date('2026-06-01T09:00:00Z'));

    await page.goto(`/foyers/${foyerId}/dashboard`);
    await expect(
      page.getByRole('heading', { level: 1, name: /Aujourd/ }),
    ).toBeVisible();

    // 1er tap : ouvrir la modale de confirmation depuis la rangée de garde de Zoé.
    const signaler = page
      .getByRole('button', { name: /Signaler une absence de Zoé/ })
      .first();
    await expect(signaler).toBeVisible();
    await signaler.click();

    const dialog = page.getByRole('dialog', { name: 'Signaler une absence' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('toute la journée');
    // Les horaires prévus (semaine-type) sont rappelés avant confirmation.
    await expect(dialog).toContainText('08:30–17:00');

    // 2e tap : confirmer → écriture du planning (PUT de succès 204/200).
    const ecriture = page.waitForResponse(
      (r) =>
        /\/plannings\//.test(r.url()) &&
        r.request().method() === 'PUT' &&
        (r.status() === 204 || r.status() === 200),
    );
    await dialog.getByRole('button', { name: "Confirmer l'absence" }).click();
    await ecriture;

    // Accusé de succès role="status" (posé avant le reload interne de la journée).
    await expect(page.getByText(/Absence enregistrée pour Zoé/)).toBeVisible();

    // PERSISTANCE : recharger le dashboard → l'absence est restituée depuis le
    // serveur ; la rangée de Zoé est « Absent » et n'offre plus le geste rapide.
    await page.goto(`/foyers/${foyerId}/dashboard`);
    await expect(page.getByText('Absent').first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Signaler une absence de Zoé/ }),
    ).toHaveCount(0);

    // NETTOYAGE : retirer l'absence via le planning (retour à l'état nominal seedé
    // — sinon la mensualité de juin de Zoé, donc le coût annuel asserté, dérive).
    await ouvrirPlanningCreche(page, foyerId, MOIS);
    await expect(cellule(page, LUNDI).locator('.fc-event-title')).toHaveText(
      'Absent',
    );
    const ligne = page
      .getByRole('group', { name: /Saisir une absence/i })
      .getByRole('listitem')
      .filter({ hasText: libelleFr(LUNDI) });
    await ligne.getByRole('button', { name: /Saisir|Modifier/ }).click();
    const modalePlanning = page.getByRole('dialog');
    await expect(modalePlanning).toBeVisible();
    await attendreEnregistrement(page, () =>
      modalePlanning.getByRole('button', { name: 'Supprimer' }).click(),
    );
    await expect(cellule(page, LUNDI).locator('.fc-event-title')).toHaveText(
      'Gardé',
    );
  });
});
