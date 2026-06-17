import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MatchersV3, PactV3 } from '@pact-foundation/pact';

/**
 * Contrat **consommateur** : ce que l'`api-gateway` (BFF, consommateur réel en
 * Phase 7) attend du provider `svc-tarification` pour « le coût du mois » consolidé
 * d'un foyer. Tourne contre un mock server Pact (aucune base) et génère le pact
 * file dans `<racine>/pacts/`, rejoué ensuite par la vérification provider
 * (`apps/svc-tarification`) — bloquant en CI.
 *
 * L'état attendu doit rester **aligné** avec le `stateHandler` de la vérification
 * provider (`tarification.provider.pact.spec.ts`) : un foyer T3 dont la cantine de
 * octobre 2026 (16 jours réservés) vaut 202,88 € (20288 c., CT-10).
 */
const ETAT_FOYER_COUT =
  'un foyer avec des prestations cantine en octobre 2026 existe';

/** Identifiant figé du foyer (seedé par le stateHandler provider). */
const FOYER_ID = '22222222-2222-2222-2222-222222222222';

// nx lance vitest avec cwd = racine du projet (apps/api-gateway) → racine du dépôt à ../../.
const PACTS_DIR = resolve(process.cwd(), '../../pacts');

const { integer, string } = MatchersV3;

const provider = new PactV3({
  consumer: 'api-gateway',
  provider: 'svc-tarification',
  dir: PACTS_DIR,
});

describe('Pact consumer · api-gateway → svc-tarification', () => {
  it('lit le coût consolidé du mois de octobre 2026 (planning réel)', async () => {
    provider
      .given(ETAT_FOYER_COUT)
      .uponReceiving('une lecture du coût consolidé du mois (réel)')
      .withRequest({
        method: 'GET',
        path: '/api/couts',
        query: { foyer: FOYER_ID, mois: '2026-10', simule: 'false' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          foyerId: FOYER_ID,
          mois: '2026-10',
          simule: false,
          // Cantine seule : 16 × 12,68 € = 202,88 € (20288 c., CT-10).
          totalCentimes: integer(20288),
          prestations: MatchersV3.eachLike({
            enfant: string('Zoé'),
            mode: string('CANTINE'),
            totalCentimes: integer(20288),
            lignes: MatchersV3.eachLike({
              libelle: string('Cantine'),
              sens: string('debit'),
              montantCentimes: integer(20288),
            }),
          }),
          lignes: MatchersV3.eachLike({
            libelle: string('Cantine'),
            sens: string('debit'),
            montantCentimes: integer(20288),
          }),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/couts?foyer=${FOYER_ID}&mois=2026-10&simule=false`,
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as {
        foyerId: string;
        mois: string;
        totalCentimes: number;
        prestations: { mode: string }[];
      };
      expect(corps.foyerId).toBe(FOYER_ID);
      expect(corps.mois).toBe('2026-10');
      expect(corps.totalCentimes).toBe(20288);
      expect(corps.prestations[0]?.mode).toBe('CANTINE');
    });
  });
});
