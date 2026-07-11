import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MatchersV3, PactV3 } from '@pact-foundation/pact';

/**
 * Contrat **consommateur** : ce que l'`api-gateway` (BFF, consommateur réel en
 * Phase 7) attend du provider `svc-foyer`. Le test tourne contre un mock server
 * Pact (aucune base requise) et génère le pact file dans `<racine>/pacts/`, que la
 * vérification provider (`apps/svc-foyer`) rejoue ensuite — bloquant en CI.
 *
 * Identité du foyer de référence : doit rester **alignée** avec le `stateHandler`
 * de la vérification provider (`foyer.provider.pact.spec.ts`).
 */
const FOYER_REFERENCE_ID = '11111111-1111-4111-8111-111111111111';
const ETAT_FOYER_T3 = 'un foyer de référence T3 existe';

// Parents (PR2) : un foyer « sans parent » (cible d'un ajout) et un foyer
// « avec un parent » (cible des lecture/édition/retrait). Les e-mails diffèrent
// pour ne pas heurter l'unicité **globale** `lower(email)` entre interactions.
const PARENT_REFERENCE_ID = '33333333-3333-4333-8333-333333333333';
const EMAIL_PARENT_NOUVEAU = 'camille.martin@example.test';
const EMAIL_PARENT_EXISTANT = 'alex.dupont@example.test';
const ETAT_FOYER_SANS_PARENT = 'un foyer de référence T3 sans parent';
const ETAT_FOYER_AVEC_PARENT = 'un foyer de référence T3 avec un parent';

// Retrait de parent (Lot 1 « gestes destructifs ») : état DÉDIÉ à DEUX parents
// actifs — la garde « dernier parent actif » de svc-foyer refuse (409) le retrait
// du dernier parent, donc le 204 nominal exige un second parent « lest ». Les
// autres interactions (liste, édition) gardent l'état « avec un parent » (leurs
// corps de réponse attendent un seul parent).
const PARENT_LEST_ID = '44444444-4444-4444-8444-444444444444';
const EMAIL_PARENT_LEST = 'dominique.bernard@example.test';
const ETAT_FOYER_AVEC_DEUX_PARENTS =
  'un foyer de référence T3 avec deux parents';

// Enfant (P4) : un foyer « avec un enfant » d'id connu, cible de l'édition et du
// retrait (le foyer est seedé puis l'enfant inséré par le stateHandler provider).
const ENFANT_REFERENCE_ID = '22222222-2222-4222-8222-222222222222';
const ETAT_FOYER_AVEC_ENFANT = 'un foyer de référence T3 avec un enfant';

// Préférences (PR2) : un foyer « avec un parent et ses préférences » — le
// stateHandler provider (PR1) seede le parent + une préférence EMAIL coupée pour
// exercer lecture/écriture. E-mail dédié (unicité globale `lower(email)`).
const EMAIL_PARENT_PREFERENCES = 'sacha.leroy@example.test';
const ETAT_FOYER_AVEC_PREFERENCES =
  'un foyer de référence T3 avec un parent et ses préférences';

// nx lance vitest avec cwd = racine du projet (apps/api-gateway) → racine du dépôt à ../../.
const PACTS_DIR = resolve(process.cwd(), '../../pacts');

const { uuid, integer, decimal, string, boolean, eachLike } = MatchersV3;

const provider = new PactV3({
  consumer: 'api-gateway',
  provider: 'svc-foyer',
  dir: PACTS_DIR,
});

describe('Pact consumer · api-gateway → svc-foyer', () => {
  it('lit le foyer de référence et reçoit sa tranche T3 déduite du RFR', async () => {
    provider
      .given(ETAT_FOYER_T3, { id: FOYER_REFERENCE_ID })
      .uponReceiving('une lecture du foyer de référence')
      .withRequest({
        method: 'GET',
        path: `/api/foyers/${FOYER_REFERENCE_ID}`,
      })
      .willRespondWith({
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: {
          id: uuid(FOYER_REFERENCE_ID),
          ressourcesMensuellesCentimes: integer(671692),
          ressourcesMensuellesEuros: decimal(6716.92),
          rfrCentimes: integer(7270500),
          // RFR et nombre de parts du foyer de référence sont des ENTIERS (72705 €,
          // 3 parts). pact-core 15.2.1 distingue strictement integer/decimal : un
          // matcher `decimal()` rejette une valeur entière (« Expected 72705 (Integer)
          // to be a decimal number »). On matche donc en `integer()`.
          rfrEuros: integer(72705),
          nbEnfantsACharge: integer(2),
          nbParts: integer(3),
          // Valeur exacte (pas un matcher de type) : le contrat fige T3 pour ce foyer.
          tranche: 3,
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/foyers/${FOYER_REFERENCE_ID}`,
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { tranche: number; id: string };
      expect(corps.tranche).toBe(3);
      expect(corps.id).toBe(FOYER_REFERENCE_ID);
    });
  });

  it('liste les foyers existants et y trouve au moins le foyer de référence', async () => {
    provider
      .given(ETAT_FOYER_T3, { id: FOYER_REFERENCE_ID })
      .uponReceiving('une liste des foyers existants')
      .withRequest({
        method: 'GET',
        path: '/api/foyers',
      })
      .willRespondWith({
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        // eachLike : au moins un élément, chacun à la forme d'un FoyerVue. La
        // tranche est matchée en type (integer) et non en valeur exacte : la
        // liste peut contenir d'autres foyers que celui de référence (ex. le
        // foyer créé par l'interaction POST lors de la vérification provider).
        body: eachLike({
          id: uuid(FOYER_REFERENCE_ID),
          ressourcesMensuellesCentimes: integer(671692),
          ressourcesMensuellesEuros: decimal(6716.92),
          rfrCentimes: integer(7270500),
          // Entiers (cf. lecture ci-dessus) → `integer()` et non `decimal()`.
          rfrEuros: integer(72705),
          nbEnfantsACharge: integer(2),
          nbParts: integer(3),
          tranche: integer(3),
        }),
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(`${mockServer.url}/api/foyers`);
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { id: string }[];
      expect(Array.isArray(corps)).toBe(true);
      expect(corps.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('crée le foyer de référence et reçoit sa tranche T3 figée', async () => {
    provider
      .uponReceiving('une création de foyer de référence')
      .withRequest({
        method: 'POST',
        path: '/api/foyers',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        // Foyer de référence (doc 02 §0), montants saisis en euros.
        body: {
          ressourcesMensuelles: 6716.92,
          rfr: 72705,
          nbEnfantsACharge: 2,
          nbParts: 3,
        },
      })
      .willRespondWith({
        status: 201,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: {
          id: uuid(FOYER_REFERENCE_ID),
          ressourcesMensuellesCentimes: integer(671692),
          ressourcesMensuellesEuros: decimal(6716.92),
          rfrCentimes: integer(7270500),
          // Entiers (cf. lecture ci-dessus) → `integer()` et non `decimal()`.
          rfrEuros: integer(72705),
          nbEnfantsACharge: integer(2),
          nbParts: integer(3),
          // Valeur exacte (pas un matcher de type) : le contrat fige T3 pour ce foyer.
          tranche: 3,
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(`${mockServer.url}/api/foyers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          ressourcesMensuelles: 6716.92,
          rfr: 72705,
          nbEnfantsACharge: 2,
          nbParts: 3,
        }),
      });
      expect(reponse.status).toBe(201);
      const corps = (await reponse.json()) as { tranche: number };
      expect(corps.tranche).toBe(3);
    });
  });

  it('édite les scalaires du foyer de référence', async () => {
    provider
      .given(ETAT_FOYER_T3, { id: FOYER_REFERENCE_ID })
      .uponReceiving('une édition des scalaires du foyer de référence')
      .withRequest({
        method: 'PUT',
        path: `/api/foyers/${FOYER_REFERENCE_ID}`,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        // Montants saisis en euros (cf. création), valeurs du foyer de référence.
        body: {
          ressourcesMensuelles: 6716.92,
          rfr: 72705,
          nbEnfantsACharge: 2,
          nbParts: 3,
        },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          id: uuid(FOYER_REFERENCE_ID),
          ressourcesMensuellesCentimes: integer(671692),
          ressourcesMensuellesEuros: decimal(6716.92),
          rfrCentimes: integer(7270500),
          // Entiers (cf. lecture ci-dessus) → `integer()` et non `decimal()`.
          rfrEuros: integer(72705),
          nbEnfantsACharge: integer(2),
          nbParts: integer(3),
          // Valeur exacte : le contrat fige T3 pour ce foyer.
          tranche: 3,
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/foyers/${FOYER_REFERENCE_ID}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            ressourcesMensuelles: 6716.92,
            rfr: 72705,
            nbEnfantsACharge: 2,
            nbParts: 3,
          }),
        },
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { tranche: number; id: string };
      expect(corps.tranche).toBe(3);
      expect(corps.id).toBe(FOYER_REFERENCE_ID);
    });
  });

  it('rattache un enfant au foyer de référence existant', async () => {
    provider
      .given(ETAT_FOYER_T3, { id: FOYER_REFERENCE_ID })
      .uponReceiving("un rattachement d'enfant au foyer de référence")
      .withRequest({
        method: 'POST',
        path: `/api/foyers/${FOYER_REFERENCE_ID}/enfants`,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          prenom: 'Mia',
          dateNaissance: '2024-12-08',
        },
      })
      .willRespondWith({
        status: 201,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: {
          id: uuid('22222222-2222-4222-8222-222222222222'),
          foyerId: uuid(FOYER_REFERENCE_ID),
          prenom: string('Mia'),
          dateNaissance: string('2024-12-08'),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/foyers/${FOYER_REFERENCE_ID}/enfants`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            prenom: 'Mia',
            dateNaissance: '2024-12-08',
          }),
        },
      );
      expect(reponse.status).toBe(201);
      const corps = (await reponse.json()) as { foyerId: string };
      expect(corps.foyerId).toBe(FOYER_REFERENCE_ID);
    });
  });

  it('édite un enfant du foyer de référence', async () => {
    provider
      .given(ETAT_FOYER_AVEC_ENFANT, {
        foyerId: FOYER_REFERENCE_ID,
        enfantId: ENFANT_REFERENCE_ID,
      })
      .uponReceiving("une édition d'enfant du foyer de référence")
      .withRequest({
        method: 'PUT',
        path: `/api/foyers/${FOYER_REFERENCE_ID}/enfants/${ENFANT_REFERENCE_ID}`,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: { prenom: 'Mia-Rose', dateNaissance: '2024-12-08' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          id: uuid(ENFANT_REFERENCE_ID),
          foyerId: uuid(FOYER_REFERENCE_ID),
          prenom: string('Mia-Rose'),
          dateNaissance: string('2024-12-08'),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/foyers/${FOYER_REFERENCE_ID}/enfants/${ENFANT_REFERENCE_ID}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            prenom: 'Mia-Rose',
            dateNaissance: '2024-12-08',
          }),
        },
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { prenom: string };
      expect(corps.prenom).toBe('Mia-Rose');
    });
  });

  it('retire un enfant du foyer de référence (204)', async () => {
    provider
      .given(ETAT_FOYER_AVEC_ENFANT, {
        foyerId: FOYER_REFERENCE_ID,
        enfantId: ENFANT_REFERENCE_ID,
      })
      .uponReceiving("un retrait d'enfant du foyer de référence")
      .withRequest({
        method: 'DELETE',
        path: `/api/foyers/${FOYER_REFERENCE_ID}/enfants/${ENFANT_REFERENCE_ID}`,
      })
      .willRespondWith({ status: 204 });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/foyers/${FOYER_REFERENCE_ID}/enfants/${ENFANT_REFERENCE_ID}`,
        { method: 'DELETE' },
      );
      expect(reponse.status).toBe(204);
    });
  });

  it('rattache un parent au foyer de référence', async () => {
    provider
      .given(ETAT_FOYER_SANS_PARENT, {
        foyerId: FOYER_REFERENCE_ID,
        email: EMAIL_PARENT_NOUVEAU,
      })
      .uponReceiving('un rattachement de parent au foyer de référence')
      .withRequest({
        method: 'POST',
        path: `/api/foyers/${FOYER_REFERENCE_ID}/parents`,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          email: EMAIL_PARENT_NOUVEAU,
          prenom: 'Camille',
          nom: 'Martin',
          principal: true,
          ordre: 0,
        },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          id: uuid(PARENT_REFERENCE_ID),
          foyerId: uuid(FOYER_REFERENCE_ID),
          prenom: string('Camille'),
          nom: string('Martin'),
          email: string(EMAIL_PARENT_NOUVEAU),
          principal: boolean(true),
          ordre: integer(0),
          actif: boolean(true),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/foyers/${FOYER_REFERENCE_ID}/parents`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            email: EMAIL_PARENT_NOUVEAU,
            prenom: 'Camille',
            nom: 'Martin',
            principal: true,
            ordre: 0,
          }),
        },
      );
      expect(reponse.status).toBe(201);
      const corps = (await reponse.json()) as { foyerId: string };
      expect(corps.foyerId).toBe(FOYER_REFERENCE_ID);
    });
  });

  it('liste les parents actifs du foyer de référence', async () => {
    provider
      .given(ETAT_FOYER_AVEC_PARENT, {
        foyerId: FOYER_REFERENCE_ID,
        parentId: PARENT_REFERENCE_ID,
        email: EMAIL_PARENT_EXISTANT,
      })
      .uponReceiving('une liste des parents du foyer de référence')
      .withRequest({
        method: 'GET',
        path: `/api/foyers/${FOYER_REFERENCE_ID}/parents`,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: eachLike({
          id: uuid(PARENT_REFERENCE_ID),
          foyerId: uuid(FOYER_REFERENCE_ID),
          prenom: string('Alex'),
          nom: string('Dupont'),
          email: string(EMAIL_PARENT_EXISTANT),
          principal: boolean(false),
          ordre: integer(0),
          actif: boolean(true),
        }),
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/foyers/${FOYER_REFERENCE_ID}/parents`,
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { foyerId: string }[];
      expect(Array.isArray(corps)).toBe(true);
      expect(corps.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('édite un parent du foyer de référence', async () => {
    provider
      .given(ETAT_FOYER_AVEC_PARENT, {
        foyerId: FOYER_REFERENCE_ID,
        parentId: PARENT_REFERENCE_ID,
        email: EMAIL_PARENT_EXISTANT,
      })
      .uponReceiving('une édition de parent du foyer de référence')
      .withRequest({
        method: 'PUT',
        path: `/api/foyers/${FOYER_REFERENCE_ID}/parents/${PARENT_REFERENCE_ID}`,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: { prenom: 'Alexandra', principal: true },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          id: uuid(PARENT_REFERENCE_ID),
          foyerId: uuid(FOYER_REFERENCE_ID),
          prenom: string('Alexandra'),
          nom: string('Dupont'),
          email: string(EMAIL_PARENT_EXISTANT),
          principal: boolean(true),
          ordre: integer(0),
          actif: boolean(true),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/foyers/${FOYER_REFERENCE_ID}/parents/${PARENT_REFERENCE_ID}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ prenom: 'Alexandra', principal: true }),
        },
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { prenom: string };
      expect(corps.prenom).toBe('Alexandra');
    });
  });

  it('retire un parent du foyer de référence (204)', async () => {
    provider
      // État à DEUX parents actifs : la garde « dernier parent actif » (Lot 1)
      // refuserait (409) le retrait de l'unique parent — le 204 nominal exige un
      // second parent « lest » qui reste dans le foyer.
      .given(ETAT_FOYER_AVEC_DEUX_PARENTS, {
        foyerId: FOYER_REFERENCE_ID,
        parentId: PARENT_REFERENCE_ID,
        email: EMAIL_PARENT_EXISTANT,
        parentLestId: PARENT_LEST_ID,
        emailLest: EMAIL_PARENT_LEST,
      })
      .uponReceiving('un retrait de parent du foyer de référence')
      .withRequest({
        method: 'DELETE',
        path: `/api/foyers/${FOYER_REFERENCE_ID}/parents/${PARENT_REFERENCE_ID}`,
      })
      .willRespondWith({ status: 204 });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/foyers/${FOYER_REFERENCE_ID}/parents/${PARENT_REFERENCE_ID}`,
        { method: 'DELETE' },
      );
      expect(reponse.status).toBe(204);
    });
  });

  it('lit les préférences de notification du parent de référence', async () => {
    provider
      .given(ETAT_FOYER_AVEC_PREFERENCES, {
        foyerId: FOYER_REFERENCE_ID,
        parentId: PARENT_REFERENCE_ID,
        email: EMAIL_PARENT_PREFERENCES,
      })
      .uponReceiving('une lecture des préférences du parent de référence')
      .withRequest({
        method: 'GET',
        path: `/api/foyers/${FOYER_REFERENCE_ID}/parents/${PARENT_REFERENCE_ID}/preferences`,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        // État effectif seedé : e-mail coupé (choix stocké), in-app au défaut.
        // Ordre déterministe (défauts §5.1 d'abord). `consentementAt`/`desabonneAt`
        // null tant qu'aucune trace n'est posée.
        body: [
          {
            typeNotification: string('VALIDATION_HEBDO'),
            canal: string('EMAIL'),
            actif: boolean(false),
            consentementAt: null,
            desabonneAt: null,
          },
          {
            typeNotification: string('VALIDATION_HEBDO'),
            canal: string('IN_APP'),
            actif: boolean(true),
            consentementAt: null,
            desabonneAt: null,
          },
        ],
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/foyers/${FOYER_REFERENCE_ID}/parents/${PARENT_REFERENCE_ID}/preferences`,
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { canal: string }[];
      expect(corps.length).toBe(2);
    });
  });

  it('met à jour les préférences du parent de référence (réactive l’e-mail)', async () => {
    provider
      .given(ETAT_FOYER_AVEC_PREFERENCES, {
        foyerId: FOYER_REFERENCE_ID,
        parentId: PARENT_REFERENCE_ID,
        email: EMAIL_PARENT_PREFERENCES,
      })
      .uponReceiving('une mise à jour des préférences du parent de référence')
      .withRequest({
        method: 'PUT',
        path: `/api/foyers/${FOYER_REFERENCE_ID}/parents/${PARENT_REFERENCE_ID}/preferences`,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          preferences: [
            {
              typeNotification: 'VALIDATION_HEBDO',
              canal: 'EMAIL',
              actif: true,
            },
          ],
        },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        // Après réactivation : e-mail actif + trace de consentement posée ; in-app
        // reste au défaut (aucune trace). `consentementAt` = ISO (matché en type).
        body: [
          {
            typeNotification: string('VALIDATION_HEBDO'),
            canal: string('EMAIL'),
            actif: boolean(true),
            consentementAt: string('2026-07-01T00:00:00.000Z'),
            desabonneAt: null,
          },
          {
            typeNotification: string('VALIDATION_HEBDO'),
            canal: string('IN_APP'),
            actif: boolean(true),
            consentementAt: null,
            desabonneAt: null,
          },
        ],
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/foyers/${FOYER_REFERENCE_ID}/parents/${PARENT_REFERENCE_ID}/preferences`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            preferences: [
              {
                typeNotification: 'VALIDATION_HEBDO',
                canal: 'EMAIL',
                actif: true,
              },
            ],
          }),
        },
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { actif: boolean }[];
      expect(corps.length).toBe(2);
    });
  });
});
