import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  lireEtatSeed,
  urlPlanning,
  attendreEnregistrementPlanning,
  rechargerEtRelirePlanning,
} from './support/stack';

// Parcours PARENT critique du mardi, contre la pile réelle (comble le trou d'audit) :
//   « une semaine N+1 est à valider → le parent édite les besoins → il valide →
//     il revalide » — de bout en bout à travers les vrais services (BFF →
//     svc-planification pour l'édition/fusion mensuelle, BFF → svc-notifications
//     pour la validation et son idempotence).
//
// Couverture existante (rappel) : unitaires (`validation.service.spec.ts`), Pacts
// (édition semaine, validation). MANQUAIT : un e2e stack exerçant la CHAÎNE COMPLÈTE
// édition → validation → REVALIDATION idempotente. C'est cette dernière assertion
// (état figé, réponse identique, aucun 409, aucun recalcul) qui manquait bout-en-bout.
//
// ── Provocation de la notification ────────────────────────────────────────────
// Le seul créateur d'une ligne `notification_hebdo` est le scheduler du mardi
// (`SchedulerHebdo`). Pour rendre ce parcours exerçable de façon DÉTERMINISTE en
// pile locale/CI, l'override compose pose `NOTIF_SCHEDULER_FORCER=1` (affordance
// de test : fenêtre du mardi ignorée, tick au boot — jamais posée en prod). La
// spec ATTEND donc, borné, qu'une semaine `A_VALIDER` apparaisse via l'endpoint
// réel `GET /notifications/a-valider?foyer=` (jamais un accès base), puis joue le
// parcours. Elle ne SKIP plus que dans deux cas résiduels : pile sans l'affordance
// (image antérieure), ou semaine déjà consommée par une exécution précédente sur
// pile persistante (la validation est terminale et idempotente).
//
// ── Non-contamination ─────────────────────────────────────────────────────────
// L'édition ajoute un jour de garde ponctuel sur la semaine notifiée (juillet 2026).
// Les specs de coûts n'assertent que MARS et AOÛT 2026 (et l'oracle mars/octobre) :
// une édition de juillet ne les touche pas. On REVERT tout de même le planning après
// coup (retour nominal) ; la validation, elle, est terminale — une revalidation
// renvoie l'état figé sans relire le planning, donc le revert ne l'affecte pas.

/** Résultat renvoyé par `POST /notifications/validations/:contratId/:semaineIso`. */
interface ValidationResultat {
  readonly contratId: string;
  readonly semaineIso: string;
  readonly statut: 'A_VALIDER' | 'VALIDEE' | 'VALIDEE_AVEC_MODIFS';
  readonly deltaModifs: {
    readonly jours: readonly {
      readonly date: string;
      readonly avant: unknown;
      readonly apres: unknown;
    }[];
  } | null;
}

/** Une ligne « à valider » enrichie renvoyée par `GET /notifications/a-valider`. */
interface NotificationAValider {
  readonly contratId: string;
  readonly foyerId: string;
  readonly semaineIso: string;
  readonly statut: string;
  readonly enfant?: string;
  /** Mode enrichi par le BFF (`CRECHE_PSU`, `CANTINE`…) — cible le contrat crèche. */
  readonly mode?: string;
}

/** Jour ISO `YYYY-MM-DD` → libellé français `JJ/MM/AAAA` (comme les aria-labels de l'UI). */
function libelleFr(iso: string): string {
  const [a, m, j] = iso.split('-');
  return `${j}/${m}/${a}`;
}

/**
 * Lundi (`YYYY-MM-DD`) d'une semaine ISO `YYYY-Www`, calculé sans dépendre d'une lib
 * (le dossier e2e/ n'est dans aucun tsconfig). Sert à cibler un jour éditable de la
 * semaine notifiée. Algorithme ISO 8601 : le lundi de la semaine 1 est celui de la
 * semaine contenant le 4 janvier.
 */
function lundiDeSemaineIso(semaineIso: string): string {
  const [anneeStr, semaineStr] = semaineIso.split('-W');
  const annee = Number(anneeStr);
  const semaine = Number(semaineStr);
  const quatreJanvier = new Date(Date.UTC(annee, 0, 4));
  const jourSemaine = quatreJanvier.getUTCDay() || 7; // dimanche (0) → 7
  const lundiSemaine1 = new Date(quatreJanvier);
  lundiSemaine1.setUTCDate(quatreJanvier.getUTCDate() - (jourSemaine - 1));
  const lundi = new Date(lundiSemaine1);
  lundi.setUTCDate(lundiSemaine1.getUTCDate() + (semaine - 1) * 7);
  return lundi.toISOString().slice(0, 10);
}

/** Ajoute `n` jours à une date `YYYY-MM-DD` (UTC) et renvoie le `YYYY-MM-DD` résultant. */
function ajouterJours(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Cellule FullCalendar (v6) d'une date ISO, pour relire l'état affiché d'un jour
 * crèche après rechargement (persistance de la saisie). Helper local trivial (comme
 * `libelleFr`) plutôt qu'un helper partagé : il ne sert qu'ici, dans ce fichier.
 */
function celluleCalendrier(page: Page, iso: string) {
  return page.locator(`td.fc-daygrid-day[data-date="${iso}"]`);
}

/**
 * Récupère, via l'endpoint réel `GET /notifications/a-valider`, une semaine encore
 * `A_VALIDER` pour le foyer, ou `null`. C'est la source de vérité de la pré-condition
 * (le scheduler a-t-il figé une semaine ?) — jamais un accès base.
 */
async function lignesAValider(
  request: APIRequestContext,
  foyerId: string,
): Promise<NotificationAValider[]> {
  const reponse = await request.get(
    `/api/v1/notifications/a-valider?foyer=${foyerId}`,
  );
  expect(reponse.ok()).toBeTruthy();
  const lignes = (await reponse.json()) as NotificationAValider[];
  return lignes.filter((l) => l.statut === 'A_VALIDER');
}

/**
 * Attend (borné) qu'au moins une semaine `A_VALIDER` existe : avec
 * `NOTIF_SCHEDULER_FORCER=1` (override compose), le scheduler la fige dès le boot de
 * la pile — le poll absorbe seulement la course boot/projections. Liste vide après
 * échéance = pile sans l'affordance ou notifications déjà consommées (→ skip).
 */
async function attendreAValider(
  request: APIRequestContext,
  foyerId: string,
  echeanceMs = 90_000,
): Promise<NotificationAValider[]> {
  const fin = Date.now() + echeanceMs;
  for (;;) {
    const lignes = await lignesAValider(request, foyerId);
    if (lignes.length > 0 || Date.now() > fin) {
      return lignes;
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

test.describe('stack réelle : valider la semaine notifiée (édition → validation → revalidation)', () => {
  test('édite les besoins, valide avec modifications, puis revalide à l’identique (idempotent)', async ({
    page,
    request,
  }) => {
    // L'attente bornée de la notification (jusqu'à 90 s) + le parcours UI dépassent
    // le timeout Playwright par défaut (30 s).
    test.setTimeout(180_000);
    const { foyerId } = lireEtatSeed();

    // Pré-condition : une semaine A_VALIDER (figée par le scheduler — forcé au boot
    // en pile locale/CI via NOTIF_SCHEDULER_FORCER). Attente bornée, puis skip
    // explicite dans les seuls cas résiduels.
    const aValider = await attendreAValider(request, foyerId);
    test.skip(
      aValider.length === 0,
      'Aucune semaine « à valider » (pile sans NOTIF_SCHEDULER_FORCER, ou notifications ' +
        'déjà consommées par une exécution antérieure sur pile persistante).',
    );
    const premiereLigne = aValider[0];
    if (premiereLigne === undefined) return;

    // Toutes les lignes portent la même semaine (le scheduler fige N+1). PLUSIEURS
    // contrats peuvent être à valider (Mia + Zoé crèche) et l'éditeur de semaine
    // liste chaque contrat avec ses propres boutons : l'ORACLE du contrat validé est
    // donc la réponse réseau réelle du POST déclenché par l'UI (étape 3), dont on
    // vérifie l'appartenance à la liste `A_VALIDER` — pas un choix a priori fragile.
    const semaineIso = premiereLigne.semaineIso;

    // Jour éditable de la semaine notifiée : le MARDI (lundi + 1). Sur le contrat
    // crèche seedé (jours gardés LUN/MER/VEN), le mardi n'est PAS gardé → l'y ajouter
    // est une modification franche vs le snapshot figé à la notification.
    const jourEdite = ajouterJours(lundiDeSemaineIso(semaineIso), 1);

    // ── 1) Le parent ouvre son planning : l'encart de validation liste la semaine ──
    await page.goto(urlPlanning(foyerId));
    await expect(
      page.getByRole('heading', { name: 'Planning mensuel' }),
    ).toBeVisible();
    const encart = page.getByRole('region', {
      name: 'Semaines de planning à valider',
    });
    await expect(encart).toBeVisible();

    // ── 2) Il ouvre l'éditeur de la semaine et ajoute un jour de garde ponctuel ────
    // Le bouton porte un aria-label enrichi (« Éditer la semaine du 6 au 12 juillet —
    // Mia, Crèche ») qui prime sur son texte visible. Le `.first()` est cohérent de
    // bout en bout : jour édité et « Valider » ciblent le même premier contrat de
    // l'éditeur (ordre DOM stable), et l'oracle est la réponse réseau (étape 3).
    await encart
      .getByRole('button', { name: /^Éditer la semaine/ })
      .first()
      .click();
    const editeur = page.getByRole('region', {
      name: /^Éditer les besoins de la /,
    });
    await expect(editeur).toBeVisible();

    // Ligne du jour édité (aria-label daté « Saisir le <Jour> JJ/MM/AAAA »).
    const boutonJour = editeur
      .getByRole('button', {
        name: new RegExp(`(Saisir|Modifier) le .*${libelleFr(jourEdite)}`),
      })
      .first();
    await boutonJour.click();

    // Modale d'édition : le mardi n'est pas gardé (jours gardés LUN/MER/VEN) → la
    // modale ouvre directement la saisie d'un « jour ajouté » (heures par défaut),
    // sans radio. L'écriture est enregistrée en debounce → on attend le PUT réel.
    const modale = page.getByRole('dialog');
    await expect(modale).toBeVisible();
    const ecriture = page.waitForResponse(
      (r) =>
        /\/plannings\/semaine\//.test(r.url()) &&
        r.request().method() === 'PUT' &&
        r.status() === 204,
    );
    await modale.getByRole('button', { name: 'Confirmer' }).click();
    await ecriture;

    // ── 3) Il valide : première validation → VALIDEE_AVEC_MODIFS (delta non vide) ──
    // On capture la réponse RÉELLE du POST de validation déclenché par l'UI, pour en
    // asserter le statut ET s'en servir d'oracle d'idempotence à l'étape suivante.
    const reponseValidation = page.waitForResponse(
      (r) =>
        /\/notifications\/validations\//.test(r.url()) &&
        r.request().method() === 'POST',
    );
    // Le bouton « Valider » du contrat (nom accessible enrichi « Valider la semaine
    // … — Mia, Crèche », ou simplement « Valider » sans enrichissement) : dans
    // l'éditeur, les seuls autres boutons sont « Saisir/Modifier » (jours) et
    // « Fermer » — `^Valider` le désigne sans ambiguïté.
    await editeur
      .getByRole('button', { name: /^Valider/ })
      .first()
      .click();
    const premierResultat = (await (
      await reponseValidation
    ).json()) as ValidationResultat;

    // Le message de succès de l'UI confirme la validation AVEC modifications.
    await expect(
      editeur.getByText('Semaine validée (avec modifications).'),
    ).toBeVisible();

    // Assertions bout-en-bout sur la 1ʳᵉ validation : le contrat validé par l'UI
    // appartient bien à la liste « à valider », sur la semaine attendue.
    const contratId = premierResultat.contratId;
    expect(aValider.map((l) => l.contratId)).toContain(contratId);
    expect(premierResultat.semaineIso).toBe(semaineIso);
    expect(premierResultat.statut).toBe('VALIDEE_AVEC_MODIFS');
    expect(premierResultat.deltaModifs).not.toBeNull();
    expect(premierResultat.deltaModifs?.jours.length ?? 0).toBeGreaterThan(0);
    // Le jour édité figure dans le delta (le snapshot figé ne le comportait pas).
    expect(
      premierResultat.deltaModifs?.jours.some((j) => j.date === jourEdite),
    ).toBeTruthy();

    // ── 4) Il revalide : idempotence bout-en-bout (état figé, réponse identique) ───
    // C'est l'assertion qui manquait. On rejoue le MÊME POST via le contexte API :
    // pas de 409, succès, et corps STRICTEMENT identique à la 1ʳᵉ validation — le
    // service renvoie l'état déjà figé sans recalculer le diff. NB : à travers la
    // gateway, ce POST BFF répond 201 (Nest par défaut ; le service amont, lui,
    // répond 200) — on vérifie donc un statut de succès, pas un 409/erreur.
    const revalidation = await request.post(
      `/api/v1/notifications/validations/${contratId}/${semaineIso}`,
    );
    expect(revalidation.ok()).toBeTruthy();
    const secondResultat = (await revalidation.json()) as ValidationResultat;
    expect(secondResultat).toEqual(premierResultat);

    // Une 3ᵉ validation renvoie encore la même chose (idempotence stable, non « à
    // usage unique »).
    const troisiemeValidation = await request.post(
      `/api/v1/notifications/validations/${contratId}/${semaineIso}`,
    );
    expect(troisiemeValidation.ok()).toBeTruthy();
    expect((await troisiemeValidation.json()) as ValidationResultat).toEqual(
      premierResultat,
    );

    // Le contrat validé quitte la liste « à valider » (statut terminal) — les
    // autres contrats encore à valider, eux, peuvent légitimement y rester.
    const restantes = await lignesAValider(request, foyerId);
    expect(restantes.map((l) => l.contratId)).not.toContain(contratId);

    // ── Nettoyage : revert du planning édité (retour nominal de juillet) ──────────
    // La validation figée n'en dépend plus (revalider relit l'état déjà stocké).
    const revert = await request.put(
      `/api/v1/contrats/${contratId}/plannings/semaine/${semaineIso}`,
      { data: {} },
    );
    expect(revert.status()).toBe(204);
  });
});

// ── Lot 5 — Filet e2e du parcours n°1 « valider ma semaine » ──────────────────────
// Le premier test (ci-dessus) couvre l'idempotence de la validation. Celui-ci couvre
// le parcours PARENT nominal COMPLET introduit par les lots 1/2a/2b, maillon par
// maillon, pour qu'une régression casse le filet :
//   lien profond (?semaine) → éditeur auto-ouvert → saisie d'HEURES RÉELLES sur un
//   jour gardé → état déduit annoncé → validation « avec modifications » → relecture
//   → envoi au service en MODE TEST (dry-run) → persistance de la saisie ET du statut
//   validé après rechargement.
//
// Le fichier tourne en worker unique (playwright.stack.config : workers=1), donc CE
// test s'exécute APRÈS celui d'idempotence, qui a déjà validé UN contrat crèche de la
// semaine notifiée. On cible ici le contrat crèche ENCORE `A_VALIDER` (l'autre) : les
// deux tests ne se disputent jamais le même contrat sur la pile partagée.
test.describe('stack réelle : parcours complet « valider ma semaine » (lien profond → heures réelles → envoi test)', () => {
  test('lien profond ouvre l’éditeur, saisit des heures réelles, valide, envoie en mode test, et persiste au reload', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const { foyerId } = lireEtatSeed();

    // Pré-condition : au moins une semaine crèche `A_VALIDER` (figée par le scheduler,
    // forcé au boot via NOTIF_SCHEDULER_FORCER). Skip résiduel : pile sans l'affordance,
    // ou toutes les semaines déjà consommées sur une pile persistante.
    const aValider = await attendreAValider(request, foyerId);
    const creche = aValider.find((l) => l.mode === 'CRECHE_PSU' && l.enfant);
    test.skip(
      creche === undefined,
      'Aucune semaine crèche « à valider » (pile sans NOTIF_SCHEDULER_FORCER, ou ' +
        'notifications déjà consommées par une exécution antérieure sur pile persistante).',
    );
    if (creche === undefined || creche.enfant === undefined) return;
    const { contratId, semaineIso } = creche;
    const enfant = creche.enfant;

    // Jour GARDÉ de la semaine notifiée : le LUNDI (jours gardés seedés LUN/MER/VEN,
    // 08:30–17:00). C'est là que la modale crèche propose la saisie d'heures réelles.
    const jourGarde = lundiDeSemaineIso(semaineIso);
    const moisNotifie = jourGarde.slice(0, 7);

    // ── 1) Lien profond du mardi : /planning?semaine=… ouvre l'éditeur d'office ────
    await page.goto(`${urlPlanning(foyerId)}?semaine=${semaineIso}`);
    await expect(
      page.getByRole('heading', { name: 'Planning mensuel' }),
    ).toBeVisible();
    // L'éditeur de la semaine notifiée s'ouvre SANS aucun clic (auto-ouverture depuis
    // `?semaine`, entrée du parcours réparée au Lot 1) : sa seule visibilité l'atteste.
    const editeur = page.getByRole('region', {
      name: /^Éditer les besoins de la /,
    });
    await expect(editeur).toBeVisible();

    // Bloc du contrat crèche ciblé. L'éditeur liste TOUS les contrats actifs de la
    // semaine (dont l'autre crèche, déjà validé) : on remonte du `<h5>` « Enfant —
    // Crèche » jusqu'à la racine du bloc de contrat (le div qui porte AUSSI la liste
    // des jours) pour scoper jour édité, message et « Valider » au bon contrat.
    const bloc = editeur
      .getByRole('heading', {
        level: 5,
        name: new RegExp(`^${enfant} \\S+ Crèche$`),
      })
      .locator('xpath=ancestor::div[.//ul[contains(@class,"jours-liste")]]')
      .last();

    // ── 2) Heures réelles sur le jour gardé : arrivée en avance → EXTENSION ────────
    await bloc
      .getByRole('button', {
        name: new RegExp(`(Saisir|Modifier) le .*${libelleFr(jourGarde)}`),
      })
      .click();
    const modale = page.getByRole('dialog');
    await expect(modale).toBeVisible();

    // Heures préremplies avec la plage du contrat (08:30–17:00). On avance l'arrivée à
    // 08:00 : l'app doit annoncer une extension facturée en complément (aria-live).
    await modale.getByLabel('Heure d’arrivée').fill('08:00');
    await expect(
      modale.getByText(
        /de plus que les horaires habituels.*facturé en complément/,
      ),
    ).toBeVisible();

    // Confirmer → écriture debouncée : on attend le PUT de SUCCÈS (204) + le badge
    // « Enregistré à » (helper partagé, filtre méthode ET statut — piège #171).
    await attendreEnregistrementPlanning(page, () =>
      modale.getByRole('button', { name: 'Confirmer' }).click(),
    );

    // ── 3) Validation du contrat → « validée (avec modifications) » ────────────────
    const reponseValidation = page.waitForResponse(
      (r) =>
        /\/notifications\/validations\//.test(r.url()) &&
        r.request().method() === 'POST',
    );
    await bloc.getByRole('button', { name: /^Valider/ }).click();
    const resultat = (await (
      await reponseValidation
    ).json()) as ValidationResultat;
    await expect(
      bloc.getByText('Semaine validée (avec modifications).'),
    ).toBeVisible();
    expect(resultat.contratId).toBe(contratId);
    expect(resultat.statut).toBe('VALIDEE_AVEC_MODIFS');
    // L'ajustement d'heures réelles du jour gardé figure dans le delta figé : preuve
    // que la catégorie `ajustements` traverse la chaîne (BFF → svc-notifications).
    expect(
      resultat.deltaModifs?.jours.some((j) => j.date === jourGarde),
    ).toBeTruthy();

    // ── 4) Relecture + envoi au service en MODE TEST (dry-run) ─────────────────────
    const relecture = page.getByRole('region', {
      name: 'Dernière étape : prévenir les services',
    });
    await expect(relecture).toBeVisible();
    // Bandeau dry-run : la pile e2e garde le mailer en dry-run (aucun mail réel).
    await expect(relecture.getByText('Mode test')).toBeVisible();
    // Le jour ajusté est décrit en clair dans le récap établissement (ajustements → BFF).
    await expect(relecture.getByText(/horaires ajustés/)).toBeVisible();

    await relecture
      .getByRole('button', {
        name: /Envoyer le récapitulatif à Crèche Les Hirondelles/,
      })
      .click();
    const confirmationEnvoi = page.getByRole('dialog', {
      name: 'Envoyer le récapitulatif au service ?',
    });
    await expect(confirmationEnvoi).toBeVisible();
    await confirmationEnvoi
      .getByRole('button', { name: 'Envoyer (mode test)' })
      .click();
    // Oracle d'envoi dry-run réussi (aucun mail réellement parti).
    await expect(relecture.getByText(/Test réussi/)).toBeVisible();

    // ── 5) Rechargement : la saisie ET le statut validé persistent ─────────────────
    // (a) Saisie — le calendrier crèche du mois notifié restitue l'ajustement, et
    //     survit à un rechargement (garde de réhydratation `saisieServeurObsolete`,
    //     #172). Une régression de réhydratation « perdrait » l'ajustement ici.
    await page.goto(
      `${urlPlanning(foyerId)}?mois=${moisNotifie}&enfant=${enfant}`,
    );
    await expect(
      page.getByRole('heading', { name: 'Planning mensuel' }),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Crèche' }).click();
    await expect(
      celluleCalendrier(page, jourGarde).locator('.fc-event-title'),
    ).toContainText('Arrivée avancée');

    await rechargerEtRelirePlanning(page);
    await expect(
      celluleCalendrier(page, jourGarde).locator('.fc-event-title'),
    ).toContainText('Arrivée avancée');

    // (b) Statut validé — terminal et idempotent côté serveur : une revalidation
    //     renvoie l'état figé (succès, jamais 409) et le contrat ne réapparaît plus
    //     dans la liste « à valider ».
    const revalidation = await request.post(
      `/api/v1/notifications/validations/${contratId}/${semaineIso}`,
    );
    expect(revalidation.ok()).toBeTruthy();
    expect(((await revalidation.json()) as ValidationResultat).statut).toBe(
      'VALIDEE_AVEC_MODIFS',
    );
    const restantes = await lignesAValider(request, foyerId);
    expect(restantes.map((l) => l.contratId)).not.toContain(contratId);
  });
});
