import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MatchersV3, PactV3 } from '@pact-foundation/pact';

/**
 * Contrat **consommateur** : ce que l'`api-gateway` (BFF, consommateur réel en
 * Phase 7) attend du provider `svc-referentiel` pour « la grille applicable à
 * (date, tranche, mode) ». Tourne contre un mock server Pact (aucune base) et
 * génère le pact file dans `<racine>/pacts/`, rejoué ensuite par la vérification
 * provider (`apps/svc-referentiel`) — bloquant en CI.
 *
 * L'état attendu doit rester **aligné** avec le `stateHandler` de la vérification
 * provider (`referentiel.provider.pact.spec.ts`).
 */
const ETAT_GRILLE_T3 = 'une grille ABCM T3 applicable en 2026 existe';
/** État de publication : le créneau historique 2019-2020 est libre (idempotence). */
const ETAT_CRENEAU_2019_LIBRE = 'le créneau de grille 2019 est libre';

// nx lance vitest avec cwd = racine du projet (apps/api-gateway) → racine du dépôt à ../../.
const PACTS_DIR = resolve(process.cwd(), '../../pacts');

const { integer, string, eachLike } = MatchersV3;

const provider = new PactV3({
  consumer: 'api-gateway',
  provider: 'svc-referentiel',
  dir: PACTS_DIR,
});

// `retry: 1` : parade à la course pact-core sous charge CPU en CI (match
// enregistré côté mock server mais « expected but not received » à la
// vérification) — détail dans vitest.config.mts. Rejeu sûr (interaction
// ré-enregistrée dans le corps du `it`).
describe('Pact consumer · api-gateway → svc-referentiel', { retry: 1 }, () => {
  it('lit la grille cantine T3 applicable au 15/09/2026', async () => {
    provider
      .given(ETAT_GRILLE_T3)
      .uponReceiving('une lecture de la grille cantine applicable (T3, 2026)')
      .withRequest({
        method: 'GET',
        path: '/api/grilles/applicable',
        query: { date: '2026-09-15', tranche: '3', mode: 'CANTINE' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          // Valeurs exactes : le contrat fige la cantine T3 2026 (doc 02 §4.1).
          mode: 'CANTINE',
          tranche: 3,
          valideDu: '2026-01-01',
          valideAu: null,
          totalCentimes: integer(1268),
          partGardeCentimes: integer(801),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/grilles/applicable?date=2026-09-15&tranche=3&mode=CANTINE`,
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as {
        mode: string;
        tranche: number;
        totalCentimes: number;
      };
      expect(corps.mode).toBe('CANTINE');
      expect(corps.tranche).toBe(3);
      expect(corps.totalCentimes).toBe(1268);
    });
  });

  it('publie une grille complète (créneau libre → 201)', async () => {
    provider
      .given(ETAT_CRENEAU_2019_LIBRE)
      .uponReceiving('une publication de grille sur un créneau libre')
      .withRequest({
        method: 'POST',
        path: '/api/grilles/abcm',
        headers: { 'Content-Type': 'application/json' },
        body: {
          valideDu: '2019-09-01',
          valideAu: '2020-08-31',
          tranches: [
            {
              tranche: 1,
              cantineTotal: 10.5,
              periMatin: 2.31,
              periSoir: 5.01,
              alshJourneeComplete: 23.5,
              alshDemiJournee: 8.5,
              alshRepas: 6.5,
            },
          ],
        },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: eachLike({
          id: string('44444444-0000-4000-8000-000000000000'),
          tranche: integer(1),
          valideDu: '2019-09-01',
          valideAu: '2020-08-31',
          cantineTotalCentimes: integer(1050),
          cantinePartGardeCentimes: null,
          periMatinCentimes: integer(231),
          periSoirCentimes: integer(501),
          alshJourneeCompleteCentimes: integer(2350),
          alshDemiJourneeCentimes: integer(850),
          alshRepasCentimes: integer(650),
        }),
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(`${mockServer.url}/api/grilles/abcm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          valideDu: '2019-09-01',
          valideAu: '2020-08-31',
          tranches: [
            {
              tranche: 1,
              cantineTotal: 10.5,
              periMatin: 2.31,
              periSoir: 5.01,
              alshJourneeComplete: 23.5,
              alshDemiJournee: 8.5,
              alshRepas: 6.5,
            },
          ],
        }),
      });
      expect(reponse.status).toBe(201);
      const corps = (await reponse.json()) as { tranche: number }[];
      expect(corps[0]?.tranche).toBe(1);
    });
  });

  it('refuse une grille chevauchant la grille 2026 ouverte (409 structuré)', async () => {
    provider
      .given(ETAT_GRILLE_T3)
      .uponReceiving('une publication de grille chevauchant la grille 2026')
      .withRequest({
        method: 'POST',
        path: '/api/grilles/abcm',
        headers: { 'Content-Type': 'application/json' },
        body: {
          valideDu: '2026-09-01',
          valideAu: null,
          tranches: [
            {
              tranche: 3,
              cantineTotal: 12.68,
              cantinePartGarde: 8.01,
              periMatin: 3.33,
              periSoir: 7.05,
              alshJourneeComplete: 26.5,
              alshDemiJournee: 9.5,
              alshRepas: 7.5,
            },
          ],
        },
      })
      .willRespondWith({
        status: 409,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          statusCode: 409,
          code: 'PERIODE_CHEVAUCHANTE',
          message: string('chevauchement de périodes de validité'),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(`${mockServer.url}/api/grilles/abcm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          valideDu: '2026-09-01',
          valideAu: null,
          tranches: [
            {
              tranche: 3,
              cantineTotal: 12.68,
              cantinePartGarde: 8.01,
              periMatin: 3.33,
              periSoir: 7.05,
              alshJourneeComplete: 26.5,
              alshDemiJournee: 9.5,
              alshRepas: 7.5,
            },
          ],
        }),
      });
      expect(reponse.status).toBe(409);
      const corps = (await reponse.json()) as { code: string };
      expect(corps.code).toBe('PERIODE_CHEVAUCHANTE');
    });
  });

  it('liste les grilles publiées (au moins la grille 2026)', async () => {
    provider
      .given(ETAT_GRILLE_T3)
      .uponReceiving('une lecture de la liste des grilles publiées')
      .withRequest({ method: 'GET', path: '/api/grilles' })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        // Template appliqué à CHAQUE ligne : on n'y met que des champs présents et
        // homogènes sur toutes les tranches (T1/T2 ont `cantinePartGardeCentimes`
        // null, T3 non — champ volontairement omis, les clés en trop sont tolérées).
        body: eachLike({
          id: string('44444444-0000-4000-8000-000000000000'),
          tranche: integer(3),
          valideDu: string('2026-01-01'),
          cantineTotalCentimes: integer(1268),
          periMatinCentimes: integer(333),
          periSoirCentimes: integer(705),
          alshJourneeCompleteCentimes: integer(2650),
          alshDemiJourneeCentimes: integer(950),
          alshRepasCentimes: integer(750),
        }),
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(`${mockServer.url}/api/grilles`);
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { tranche: number }[];
      expect(corps.length).toBeGreaterThan(0);
    });
  });
});
