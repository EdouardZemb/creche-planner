import { test, expect, type APIRequestContext } from '@playwright/test';
import { lireEtatSeed, urlPlanning } from './support/stack';

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

    // Modale d'édition : « Jour ajouté » (crèche), heures par défaut, puis Confirmer.
    // L'écriture est enregistrée en debounce → on attend le PUT semaine réel.
    const modale = page.getByRole('dialog');
    await expect(modale).toBeVisible();
    await modale.getByRole('radio', { name: 'Jour ajouté' }).check();
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
