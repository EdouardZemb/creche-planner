import { test, expect, type APIRequestContext } from '@playwright/test';

// Parcours « effacement du foyer » (lot 2 du plan standards, `AM-34`) contre la
// pile réelle : la suppression est-elle **réellement** propagée aux services
// aval, et pas seulement à la source ?
//
// ⚠️ NON-CONTAMINATION. Ce test crée SON PROPRE foyer, avec un e-mail unique par
// exécution, et n'approche jamais le foyer seedé (`lireEtatSeed().foyerId`) dont
// dépendent `couts`, `planning` et `foyer-contrats`. Il est le seul du dépôt à
// détruire un foyer : viser celui du seed casserait toute la suite. La création
// étant unique à chaque tentative, le test est rejouable tel quel au `retries: 1`
// de la CI.
//
// ORACLE. Aucun test E2E de ce dépôt n'ouvre de connexion Postgres : la preuve
// « il ne reste rien » se construit ici avec les **endpoints réels**, un par
// service traversé — 404 sur le foyer (svc-foyer) et liste vide de contrats
// (svc-planification, qui n'apprend l'effacement que par l'événement). La preuve
// table par table, elle, vit à l'étage `projection.integration.spec.ts` de chaque
// service.

const EMAIL = `effacement-${Date.now()}@example.test`;

interface DossierCree {
  foyer: { id: string };
  enfants: { id: string }[];
}

/** Crée un foyer complet (1 enfant, 1 parent) et renvoie ses identités. */
async function creerFoyerJetable(
  request: APIRequestContext,
): Promise<{ foyerId: string; enfantId: string }> {
  const reponse = await request.post('/api/v1/foyers', {
    data: {
      ressourcesMensuelles: 3000,
      rfr: 30000,
      nbEnfantsACharge: 1,
      nbParts: 2,
      enfants: [{ prenom: 'Effaçable', dateNaissance: '2023-05-04' }],
      parents: [{ email: EMAIL }],
    },
  });
  expect(reponse.status()).toBe(201);
  const dossier = (await reponse.json()) as DossierCree;
  const enfant = dossier.enfants[0];
  expect(enfant).toBeDefined();
  return { foyerId: dossier.foyer.id, enfantId: enfant?.id ?? '' };
}

/** Plage horaire d'une semaine type, telle que l'attend `svc-planification`. */
interface Plage {
  debutHeures: number;
  debutMinutes: number;
  finHeures: number;
  finMinutes: number;
}

const JOURS = [
  'LUNDI',
  'MARDI',
  'MERCREDI',
  'JEUDI',
  'VENDREDI',
  'SAMEDI',
  'DIMANCHE',
] as const;

/**
 * Complète une semaine partielle sur les **sept** jours : `svc-planification`
 * valide la semaine type comme un objet dont chaque jour est requis, un jour
 * manquant vaut 400 (et non « pas de garde ce jour-là »). Même contrainte que
 * `completerSemaine` dans `scripts/seed-demo.mjs`.
 */
function semaineComplete(
  partielle: Partial<Record<(typeof JOURS)[number], Plage[]>>,
): Record<string, Plage[]> {
  return Object.fromEntries(JOURS.map((j) => [j, partielle[j] ?? []]));
}

/**
 * Attend qu'une condition asynchrone devienne vraie, en bornant l'attente : la
 * propagation passe par l'outbox (relais ~2 s) puis JetStream, elle n'est jamais
 * immédiate. Jamais d'attente fixe — on interroge jusqu'à obtenir la réponse.
 */
async function attendre(
  libelle: string,
  condition: () => Promise<boolean>,
  timeoutMs = 60_000,
): Promise<void> {
  const echeance = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) {
      return;
    }
    if (Date.now() > echeance) {
      throw new Error(
        `${libelle} : toujours pas vrai après ${String(timeoutMs)} ms`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

test.describe('stack réelle : effacement du foyer et de ses copies aval', () => {
  test.use({ extraHTTPHeaders: { 'x-dev-user-email': EMAIL } });

  test('supprime le foyer, ses contrats et ne laisse rien de lisible', async ({
    request,
  }) => {
    // La propagation traverse trois services : laisser à la pile le temps réel
    // qu'elle prend, plutôt que d'assouplir l'oracle.
    test.setTimeout(180_000);

    const { foyerId, enfantId } = await creerFoyerJetable(request);

    // Un contrat, pour que svc-planification ait bien quelque chose à effacer —
    // sans lui, la liste serait vide avant même la suppression et l'oracle
    // aval ne prouverait rien. Le corps suit celui du seed (`scripts/seed-demo.mjs`) :
    // `svc-planification` valide en profondeur un CRECHE_PSU (heures annuelles,
    // mensualités, semaine type sur les **sept** jours) et l'établissement est
    // obligatoire depuis P5.
    const etablissement = await request.post(
      `/api/v1/foyers/${foyerId}/etablissements`,
      { data: { nom: 'Crèche jetable' } },
    );
    expect(etablissement.status()).toBe(201);
    const { id: etablissementId } = (await etablissement.json()) as {
      id: string;
    };

    const contrat = await request.post('/api/v1/contrats', {
      data: {
        mode: 'CRECHE_PSU',
        foyerId,
        enfant: 'Effaçable',
        enfantId,
        etablissementId,
        valideDu: '2026-01-01',
        valideAu: '2026-07-31',
        heuresAnnuellesContractualisees: 831.5,
        nbMensualites: 7,
        semaineType: semaineComplete({
          LUNDI: [
            { debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 },
          ],
        }),
      },
    });
    expect(contrat.status()).toBe(201);

    // Constat AVANT : sans lui, un oracle « liste vide » serait vert même si le
    // contrat n'avait jamais été créé.
    const avant = await request.get(`/api/v1/contrats?foyer=${foyerId}`);
    expect(((await avant.json()) as unknown[]).length).toBe(1);

    // --- l'effacement lui-même -------------------------------------------
    const suppression = await request.delete(`/api/v1/foyers/${foyerId}`);
    expect(suppression.status()).toBe(204);

    // Source : effacée immédiatement (cascade SQL, synchrone).
    expect((await request.get(`/api/v1/foyers/${foyerId}`)).status()).toBe(404);

    // Le geste n'est pas rejouable : un second appel ne peut pas répondre 204.
    expect((await request.delete(`/api/v1/foyers/${foyerId}`)).status()).toBe(
      404,
    );

    // Aval : svc-planification n'apprend l'effacement que par l'événement
    // d'intégration — c'est CE point qui distingue un vrai effacement d'un
    // `DELETE` local, et il arrive avec un délai.
    await attendre('les contrats du foyer effacé ont disparu', async () => {
      const liste = await request.get(`/api/v1/contrats?foyer=${foyerId}`);
      return liste.ok() && ((await liste.json()) as unknown[]).length === 0;
    });
  });
});
