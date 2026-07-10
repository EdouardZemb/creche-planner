import { test, expect } from '@playwright/test';
import { lireEtatSeed, urlCouts, urlPlanning } from './support/stack';

// Parcours Phase 15 (Lot 2) — COÛT CONSOLIDÉ réel via l'UI.
// Régression doc 14 : les coûts affichés doivent reproduire les VRAIS montants
// (crèche ≈ 851,16 €/mois de janvier à juillet 2026, 0 € en août). Ces montants
// proviennent de la projection tarification alimentée par NATS : la cohérence est
// ÉVENTUELLE (asynchrone). On utilise donc `expect.poll` avec un timeout (~15 s)
// et un rechargement de page entre deux tentatives — JAMAIS d'attente fixe.
//
// Montant attendu : Zoé 412,20 € + Mia 438,96 € = 851,16 € (mois jan→juil).
//
// NB format : `centimesEnEuros` formate via toLocaleString('fr-FR', currency),
// ce qui insère une espace insécable (NBSP/narrow NBSP) avant « € ». On assert
// donc sur la partie numérique « 851,16 » (et « 0,00 ») pour rester robuste au
// type d'espace, tout en étant assertif sur la VALEUR.

const TIMEOUT_PROJECTION = 30_000;

/**
 * Lit le total (texte) d'une ligne mensuelle du tableau des coûts annuels.
 * La ligne est repérée par son en-tête « <mois> 2026 » (th scope="row") ; le
 * total est dans la cellule suivante.
 *
 * IMPORTANT : on NE recharge PAS la page entre deux essais. L'agrégation annuelle
 * (`GET /api/v1/couts/annuel`, 12 mois) est lente sur un calcul à froid (~1–4 s) et
 * frôle le délai de repli 502 de la gateway. Un `page.reload()` à chaque itération
 * AVORTE la requête en vol avant qu'elle n'aboutisse → échec en boucle. À la place,
 * si la page est en erreur (« Service indisponible »), on clique son bouton
 * « Réessayer » pour relancer le fetch, puis on laisse la requête se terminer.
 */
async function lireTotalMois(
  page: import('@playwright/test').Page,
  libelleMois: RegExp,
): Promise<string> {
  const reessayer = page.getByRole('button', { name: 'Réessayer' });
  if (await reessayer.isVisible().catch(() => false)) {
    await reessayer.click();
  }
  const ligne = page
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: libelleMois }) });
  // Laisser la requête annuelle lente aboutir avant de lire (pas de reload).
  await ligne
    .waitFor({ state: 'visible', timeout: 8000 })
    .catch(() => undefined);
  // Premier td de la ligne = colonne « Total » (vue non simulée).
  const cellule = ligne.getByRole('cell').first();
  return (await cellule.textContent().catch(() => '')) ?? '';
}

test('stack réelle : coût crèche mensuel ≈ 851,16 € (jan→juil) et 0 € en août', async ({
  page,
}) => {
  const { foyerId } = lireEtatSeed();

  // L'année vit dans l'URL (?annee=, lot 1 Coûts) : on force 2026 par
  // navigation directe — robuste et indépendant de l'horloge du runner.
  await page.goto(`${urlCouts(foyerId)}?annee=2026`);
  await expect(
    page.getByRole('heading', { name: /Coûts annuels/ }),
  ).toBeVisible();

  // Projection asynchrone : on poll le total de mars 2026 jusqu'à atteindre la
  // valeur réelle (851,16 €) ; en cas d'erreur transitoire, le helper relance via
  // le bouton « Réessayer » de la page (sans recharger, cf. lireTotalMois).
  await expect
    .poll(() => lireTotalMois(page, /^mars 2026$/), {
      timeout: TIMEOUT_PROJECTION,
      message: 'Le coût crèche de mars 2026 doit converger vers 851,16 €',
    })
    .toContain('851,16');

  // Transition de fin de période : août 2026 hors contrat crèche → 0 €.
  await expect
    .poll(() => lireTotalMois(page, /^août 2026$/), {
      timeout: TIMEOUT_PROJECTION,
      message: 'Le coût d’août 2026 doit être nul (hors période crèche)',
    })
    .toContain('0,00');
});

test('stack réelle : le panneau coût du mois (planning) affiche 851,16 € en mars 2026', async ({
  page,
}) => {
  const { foyerId } = lireEtatSeed();

  // Le panneau « Coût du mois » de la page Planning lit GET /api/v1/couts pour le
  // mois affiché. Même projection asynchrone → on poll le total rendu dans le
  // panneau (#recap-cout-mois) en rechargeant la page.
  await page.goto(`${urlPlanning(foyerId)}?mois=2026-03`);
  await expect(
    page.getByRole('heading', { name: 'Planning mensuel' }),
  ).toBeVisible();

  await expect
    .poll(
      async () => {
        await page.reload();
        const panneau = page.locator('#recap-cout-mois');
        // Attendre la fin du chargement du panneau avant de lire son contenu.
        await panneau
          .waitFor({ state: 'visible', timeout: 5000 })
          .catch(() => undefined);
        return (await panneau.textContent().catch(() => '')) ?? '';
      },
      {
        timeout: TIMEOUT_PROJECTION,
        message:
          'Le panneau coût du mois doit afficher le total crèche 851,16 €',
      },
    )
    .toContain('851,16');
});
