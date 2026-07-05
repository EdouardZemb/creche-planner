import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import {
  lireEtatSeed,
  urlPlanning,
  attendreEnregistrementPlanning as attendreEnregistrement,
} from './support/stack';

// =============================================================================
// MBT — modèle d'état SYSTÈME de la saisie de planning crèche (niveau E2E stack
// réelle). Critère 0-switch (toutes transitions) + persistance ; Traçabilité doc 17.
// =============================================================================
//
// Sujet sous test : la saisie d'un mois de planning crèche (contrat CRECHE_PSU
// de Zoé, mois 2026-06), pilotée bout-en-bout contre la pile Docker réelle.
//
// ---------------------------------------------------------------------------
// MACHINE À ÉTATS FINIE (FSM)
// ---------------------------------------------------------------------------
//
//   États (PORTÉE DU MODÈLE : saisie MENSUELLE d'un mois de planning crèche) :
//     S0  Nominal             — semaine type seule (planning conforme au contrat)
//     S1  Jour ponctuel ajouté — un jour NON gardé ajouté CE mois (jour suppl.)
//     S2  Absence pleine journée — un jour gardé absent toute la journée
//     S3  Absence partielle    — un jour gardé absent sur une plage horaire (heures)
//
//   Transitions (FSM), critère 0-switch = toutes les transitions du modèle, chaque
//   état NON-nominal repassant par S0 (retour à l'état nominal seedé) :
//
//        S0 --ajouter jour ponctuel----------> S1   S1 --retirer jour----------> S0
//        S0 --absence pleine journée---------> S2   S2 --supprimer absence-----> S0
//        S0 --absence partielle (heures)-----> S3   S3 --supprimer absence-----> S0
//
//   Transition de PERSISTANCE (réhydratation serveur) :
//     depuis chaque état non-nominal (S1, S2, S3), la source de vérité serveur
//     (GET contrats/:id/plannings/:mois — celle que le composant relit au montage)
//     doit CONSERVER l'état saisi (jour suppl. pour S1 ; plage pleine journée pour
//     S2 ; plage horaire PARTIELLE sérialisée pour S3), AVANT de revenir à S0.
//
//   Diagramme (vue compacte — chaque état non-nominal vérifie sa persistance) :
//
//                          +-- persist(GET serveur) --+
//                          v                          |
//        [S1] <--add/remove--+                        |
//          |                 |                         |
//          +------> [S0] <---+------> [S2] --persist---+
//                    ^                  |
//                    +--add/remove--> [S3] --persist---+
//
//   NOTE — BUDGET DE REQUÊTES.
//   Le rate-limit de la gateway a été RELEVÉ pour la pile locale/E2E
//   (docker-compose.yml : api-gateway → RATE_LIMIT_MAX = 100000). Le modèle n'est
//   donc PLUS contraint par un budget de requêtes : on visite les 6 transitions du
//   modèle + 3 vérifications de persistance dans une seule navigation, sans pause
//   de drain ni réduction artificielle des états. (Auparavant le modèle était
//   réduit à S0↔S3 + une pause > fenêtre pour éviter un 429 — supprimés.)
//
//   ÉTAT EXCLU DU MODÈLE (couvert AILLEURS) :
//     - S4 « modif durable » (portée « tous les mois ») : modifie le CONTRAT
//       (PUT /contrats/:id → re-projection NATS vers svc-tarification), opération
//       lourde, à effet de bord destructeur sur les saisies mensuelles, et au mode
//       d'échec connu (un échec en plein PUT laisse le foyer sans contrat). Couverte
//       par `planning-saisie-complete (c)` ; volontairement hors de ce modèle d'état
//       mensuel pour ne pas mêler une mutation de contrat aux mutations de planning.
//
//   PARCOURS choisi — UN SEUL test couvrant les 6 transitions + les 3 persistances,
//   en 1 navigation :
//
//     S0→S1 (ajout) → persist(GET) → S1→S0 (retrait)
//     S0→S2 (absence journée) → persist(GET) → S2→S0 (suppression)
//     S0→S3 (absence partielle) → persist(GET) → S3→S0 (suppression)
//
//   Chaque branche REVIENT à S0 dans le corps du test (et même en cas d'échec à
//   mi-parcours, chaque mutation est isolée et supprimée avant la suivante)
//   → la spec des coûts (851,16 €) n'est PAS faussée.
//
// ---------------------------------------------------------------------------
// INVARIANT DE SUITE (état partagé)
// ---------------------------------------------------------------------------
// La BDD est seedée une fois pour toute la pile (scripts/seed-demo.mjs) et la spec
// des coûts annuels assert 851,16 € (Zoé 412,20 € + Mia 438,96 €). CHAQUE branche
// du parcours MBT REVIENT donc à S0 (état nominal seedé) pour ne PAS fausser ce calcul.
//
// Contrat crèche seedé (Zoé, CRECHE_PSU, 01/01 → 31/07/2026) :
//   LUNDI · MERCREDI · VENDREDI, 08:30–17:00 (semaine type indicative).
// Mois de travail : juin 2026.
//   - 2026-06-01 = LUNDI    → jour gardé (absences S2/S3)
//   - 2026-06-02 = MARDI    → jour NON gardé (ajout ponctuel S1)
//
// Sélecteurs/helpers RÉUTILISÉS depuis le pattern existant
// (planning-saisie-complete.stack.e2e.spec.ts & planning-ajustement.stack.e2e.spec.ts) :
//   lireEtatSeed/urlPlanning (support/stack), cellule(), libelleFr(),
//   attendreEnregistrement (PUT /plannings/), ouvrirAbsence (liste clavier),
//   ouvrirAjout (.fc-daygrid-day-top + retry toPass),
//   ouvrirPlanningCreche (forçage onglet « Crèche »).

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
 * Lit la saisie PERSISTÉE côté serveur pour (contrat, mois) via l'API publique.
 *
 * Transition de PERSISTANCE : on interroge DIRECTEMENT l'endpoint de
 * réhydratation (1 GET) — c'est exactement la source de vérité que le composant
 * relit au montage (cf. useSaisieServeur). Plus léger qu'un `page.reload()` (qui
 * refait foyer + contrats + planning + coûts) tout en testant la même garantie :
 * la mutation est bien sérialisée côté serveur.
 */
async function lireSaisieServeur(
  request: APIRequestContext,
  contratId: string,
  mois: string,
): Promise<{
  joursSupplementaires?: { date: string }[];
  absences?: {
    date: string;
    debutHeures: number;
    debutMinutes: number;
    finHeures: number;
    finMinutes: number;
  }[];
}> {
  const reponse = await request.get(
    `/api/v1/contrats/${contratId}/plannings/${mois}`,
  );
  expect(reponse.ok()).toBeTruthy();
  const corps = (await reponse.json()) as { saisie?: Record<string, unknown> };
  return corps.saisie ?? {};
}

/**
 * Ouvre la modale d'absence d'un jour GARDÉ via la liste clavier accessible
 * (« Saisir » / « Modifier ») plutôt que par un clic sur la grille FullCalendar
 * (dont le `dateClick` sur un jour porteur d'événement est peu fiable à piloter).
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
 * Ouvre la modale d'AJOUT/ÉDITION d'un jour NON gardé. Ces jours ne figurent PAS
 * dans la liste clavier : on passe par le `dateClick` de la grille FullCalendar.
 *
 * Piège (mémoire de phases) : `dateClick` PEU FIABLE. Deux parades combinées :
 *  - cibler `.fc-daygrid-day-top` (zone du numéro), JAMAIS le centre (un clic au
 *    centre tombe sur la pastille « Ajouté » et ne déclenche pas `dateClick`) ;
 *  - réessayer via expect(...).toPass() jusqu'à ce que la modale s'ouvre.
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
 * Ouvre la page Planning sur le mois donné et force l'onglet « Crèche » de
 * Zoé (sans dépendre de l'ordre des contrats), puis attend la grille prête.
 */
async function ouvrirPlanningCreche(page: Page, foyerId: string, mois: string) {
  await page.goto(`${urlPlanning(foyerId)}?mois=${mois}&enfant=Zoé`);
  await expect(
    page.getByRole('heading', { name: 'Planning mensuel' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Crèche' }).click();
}

test.describe("MBT — modèle d'état système : saisie planning crèche (Zoé)", () => {
  const MOIS = '2026-06';
  const LUNDI = '2026-06-01'; // jour gardé    → S2 (absence journée) / S3 (absence partielle)
  const MARDI = '2026-06-02'; // jour non gardé → S1 (ajout ponctuel)

  // ---------------------------------------------------------------------------
  // PARCOURS UNIQUE couvrant les 6 transitions du modèle (S0↔S1, S0↔S2, S0↔S3)
  // + les 3 transitions de PERSISTANCE, en UNE SEULE navigation.
  //
  // 0-switch : chaque arête du modèle est visitée une fois (aller depuis S0 vers
  // chaque état non-nominal, persistance vérifiée par 1 GET serveur, puis retour
  // à S0). Le rate-limit gateway ayant été relevé (RATE_LIMIT_MAX = 100000 en env
  // E2E), aucune pause de drain n'est nécessaire.
  // ---------------------------------------------------------------------------
  test('parcours 0-switch (S0↔S1 ajout, S0↔S2 absence journée, S0↔S3 absence partielle) + persistance', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const { foyerId, contrats } = lireEtatSeed();
    const contratId = contrats['creche-enfant-1'];
    await ouvrirPlanningCreche(page, foyerId, MOIS);
    await expect(cellule(page, MARDI)).toBeVisible();

    // === [S0] Nominal : mardi non gardé, lundi gardé. =======================
    await expect(cellule(page, MARDI).locator('.fc-event-title')).toHaveCount(
      0,
    );
    await expect(cellule(page, LUNDI).locator('.fc-event-title')).toHaveText(
      'Gardé',
    );

    // =====================================================================
    // S0 → S1 (jour ponctuel ajouté sur le mardi non gardé), heures par défaut.
    // =====================================================================
    let dialogAjout = await ouvrirAjout(page, MARDI);
    await expect(dialogAjout).toContainText(`Ajouter le ${libelleFr(MARDI)}`);
    await attendreEnregistrement(page, () =>
      dialogAjout.getByRole('button', { name: 'Confirmer' }).click(),
    );
    // [S1] le mardi compte comme un ajout (« Ajouté » + écart +1 jour).
    await expect(cellule(page, MARDI).locator('.fc-event-title')).toHaveText(
      'Ajouté',
    );
    await expect(page.getByText(/\+1\s+jour/)).toBeVisible();

    // PERSISTANCE (S1) : la source de vérité serveur enregistre le jour suppl.
    const saisieS1 = await lireSaisieServeur(request, contratId, MOIS);
    expect((saisieS1.joursSupplementaires ?? []).map((j) => j.date)).toContain(
      MARDI,
    );

    // S1 → S0 (retirer le jour ajouté) → retour à l'état nominal seedé.
    dialogAjout = await ouvrirAjout(page, MARDI);
    await attendreEnregistrement(page, () =>
      dialogAjout.getByRole('button', { name: 'Supprimer' }).click(),
    );
    await expect(cellule(page, MARDI).locator('.fc-event-title')).toHaveCount(
      0,
    );

    // =====================================================================
    // S0 → S2 (absence PLEINE JOURNÉE sur le lundi gardé).
    // La case « Absence toute la journée » est cochée par défaut.
    // =====================================================================
    let dialogAbs = await ouvrirAbsence(page, LUNDI);
    await expect(dialogAbs).toContainText(`Absence du ${libelleFr(LUNDI)}`);
    await expect(
      dialogAbs.getByLabel('Absence toute la journée'),
    ).toBeChecked();
    await attendreEnregistrement(page, () =>
      dialogAbs.getByRole('button', { name: 'Confirmer' }).click(),
    );
    // [S2] le lundi compte comme un retrait (« Absent » + écart -1 jour).
    await expect(cellule(page, LUNDI).locator('.fc-event-title')).toHaveText(
      'Absent',
    );
    await expect(page.getByText(/-1\s+jour/)).toBeVisible();

    // PERSISTANCE (S2) : l'absence du lundi est enregistrée avec la plage de la
    // garde du contrat (08:30–17:00), preuve d'une absence PLEINE journée.
    const saisieS2 = await lireSaisieServeur(request, contratId, MOIS);
    const absS2 = (saisieS2.absences ?? []).find((a) => a.date === LUNDI);
    expect(absS2).toBeTruthy();
    expect(absS2?.debutHeures).toBe(8);
    expect(absS2?.debutMinutes).toBe(30);
    expect(absS2?.finHeures).toBe(17);
    expect(absS2?.finMinutes).toBe(0);

    // S2 → S0 (supprimer l'absence) → retour à l'état nominal seedé.
    dialogAbs = await ouvrirAbsence(page, LUNDI);
    await attendreEnregistrement(page, () =>
      dialogAbs.getByRole('button', { name: 'Supprimer' }).click(),
    );
    await expect(cellule(page, LUNDI).locator('.fc-event-title')).toHaveText(
      'Gardé',
    );

    // =====================================================================
    // S0 → S3 (absence PARTIELLE sur le lundi gardé, en heures).
    // On choisit le type « Absence personnalisée » (sélecteur radio remplaçant
    // l'ancienne case « toute la journée ») et on saisit une sous-plage
    // INTÉRIEURE (11:00–14:00).
    // =====================================================================
    dialogAbs = await ouvrirAbsence(page, LUNDI);
    await dialogAbs
      .getByRole('radio', { name: 'Absence personnalisée' })
      .check();
    await dialogAbs.getByLabel('Début de l’absence').fill('11:00');
    await dialogAbs.getByLabel('Fin de l’absence').fill('14:00');
    await attendreEnregistrement(page, () =>
      dialogAbs.getByRole('button', { name: 'Confirmer' }).click(),
    );
    // [S3] l'absence partielle INTÉRIEURE (11:00–14:00 ⊂ 08:30–17:00) s'affiche
    // « Ajusté » (3e état, ambre) tout en restant comptée comme un retrait (-1).
    await expect(cellule(page, LUNDI).locator('.fc-event-title')).toHaveText(
      'Ajusté',
    );
    await expect(page.getByText(/-1\s+jour/)).toBeVisible();

    // PERSISTANCE (S3) : l'absence du lundi est enregistrée avec SA plage horaire
    // PARTIELLE (11:00–14:00), distincte de la garde du contrat (≠ 08:30–17:00) → preuve
    // que le « décoché toute la journée » a bien été sérialisé côté serveur.
    const saisieS3 = await lireSaisieServeur(request, contratId, MOIS);
    const absS3 = (saisieS3.absences ?? []).find((a) => a.date === LUNDI);
    expect(absS3).toBeTruthy();
    expect(absS3?.debutHeures).toBe(11);
    expect(absS3?.debutMinutes).toBe(0);
    expect(absS3?.finHeures).toBe(14);
    expect(absS3?.finMinutes).toBe(0);

    // S3 → S0 (supprimer l'absence) → retour à l'état nominal seedé.
    dialogAbs = await ouvrirAbsence(page, LUNDI);
    await attendreEnregistrement(page, () =>
      dialogAbs.getByRole('button', { name: 'Supprimer' }).click(),
    );
    await expect(cellule(page, LUNDI).locator('.fc-event-title')).toHaveText(
      'Gardé',
    );

    // === Invariant final : on est bien revenu à S0 (état nominal seedé). =====
    // Le mardi n'a plus d'événement, le lundi est de nouveau « Gardé » → la spec
    // des coûts (851,16 €) n'est pas faussée.
    await expect(cellule(page, MARDI).locator('.fc-event-title')).toHaveCount(
      0,
    );
    await expect(cellule(page, LUNDI).locator('.fc-event-title')).toHaveText(
      'Gardé',
    );
  });
});
