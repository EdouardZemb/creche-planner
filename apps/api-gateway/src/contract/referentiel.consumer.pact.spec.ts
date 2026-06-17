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

// nx lance vitest avec cwd = racine du projet (apps/api-gateway) → racine du dépôt à ../../.
const PACTS_DIR = resolve(process.cwd(), '../../pacts');

const { integer } = MatchersV3;

const provider = new PactV3({
  consumer: 'api-gateway',
  provider: 'svc-referentiel',
  dir: PACTS_DIR,
});

describe('Pact consumer · api-gateway → svc-referentiel', () => {
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
});
