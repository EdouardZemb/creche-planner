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

// nx lance vitest avec cwd = racine du projet (apps/api-gateway) → racine du dépôt à ../../.
const PACTS_DIR = resolve(process.cwd(), '../../pacts');

const { uuid, integer, decimal, string, eachLike } = MatchersV3;

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
      const corps = (await reponse.json()) as Array<{ id: string }>;
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
});
