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

/**
 * SFD 40 — état du suivi des unités associatives. Le seed provider ne pose que des
 * sessions **RÉALISÉES**, à dessein : « réservé » et « à confirmer » se trient par
 * rapport au jour COURANT, et un contrat qui les figerait virerait au rouge tout
 * seul le jour où la date de seed passe (le piège déjà rencontré sur `foyer_version`,
 * dont l'interaction d'octobre 2026 serait devenue fausse un 1er novembre). Ce que
 * ce contrat fige est donc ce qui ne dépend pas du calendrier : le quota, le
 * réalisé, le restant et le coût qui en découle.
 */
const ETAT_FOYER_UA =
  'un foyer avec un engagement d’unités associatives 2026/27 existe';

/** Identifiants figés du seed provider (`tarification.provider.pact.spec.ts`). */
const ENGAGEMENT_UA_ID = '99999999-9999-4999-8999-999999999999';
const SESSION_UA_1 = '88888888-8888-4888-8888-888888888888';

/** Identifiant figé du foyer (seedé par le stateHandler provider). */
const FOYER_ID = '22222222-2222-2222-2222-222222222222';

// nx lance vitest avec cwd = racine du projet (apps/api-gateway) → racine du dépôt à ../../.
const PACTS_DIR = resolve(process.cwd(), '../../pacts');

const { boolean, integer, number, string } = MatchersV3;

const provider = new PactV3({
  consumer: 'api-gateway',
  provider: 'svc-tarification',
  dir: PACTS_DIR,
});

// `retry: 1` : parade à la course pact-core sous charge CPU en CI (match
// enregistré côté mock server mais « expected but not received » à la
// vérification) — détail dans vitest.config.mts. Rejeu sûr (interaction
// ré-enregistrée dans le corps du `it`).
describe('Pact consumer · api-gateway → svc-tarification', { retry: 1 }, () => {
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

  it('lit le suivi des unités associatives (SFD 40, US-40-04)', async () => {
    provider
      .given(ETAT_FOYER_UA)
      .uponReceiving('une lecture du suivi des unités associatives')
      .withRequest({
        method: 'GET',
        path: '/api/unites-associatives',
        query: { foyer: FOYER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          foyerId: FOYER_ID,
          // Dérivé de l'horloge du provider : la FORME est contractuelle, la
          // valeur ne peut pas l'être.
          aujourdhui: string('2026-10-01'),
          // VALEURS LITTÉRALES là où elles ne dépendent pas du calendrier : un
          // matcher de type ne vérifierait que la forme, et c'est justement le
          // NOMBRE qui est le sujet de cette SFD. Les seuls matchers ci-dessous
          // sont posés sur ce que l'horloge fait bouger.
          engagement: {
            id: ENGAGEMENT_UA_ID,
            foyerId: FOYER_ID,
            debut: '2026-06-01',
            fin: '2027-05-31',
            quotaHeures: 20,
            valeurUaCentimes: 3125,
            cautionCentimes: 62500,
          },
          compteurs: {
            quotaHeures: 20,
            // 6 h réalisées (4 + 2), aucune session prévue : ces quatre-là ne
            // dépendent pas du jour où la CI tourne — d'où des valeurs exactes.
            heuresRealisees: 6,
            heuresReservees: 0,
            heuresAConfirmer: 0,
            heuresRestantes: 14,
            quotaAtteint: false,
            // Compte à rebours : bouge chaque jour, donc TYPE seulement.
            joursAvantEcheance: integer(242),
            // (20 − 6) × 31,25 € = 437,50 € — le calcul du domaine (doc 02 §4.5)
            // branché sur des heures RÉELLEMENT saisies, ce que la SFD 40 apporte.
            coutSiArret: {
              montantCentimes: 43750,
              hypothese: 'SI_TU_TARRETES_LA',
            },
            coutSiReservationsRealisees: {
              montantCentimes: 43750,
              hypothese: 'SI_TU_REALISES_TES_RESERVATIONS',
            },
            // Bascule à vrai quand l'échéance passe sous 8 semaines : TYPE.
            alerteEcheance: boolean(false),
          },
          sessions: MatchersV3.eachLike({
            id: string(SESSION_UA_1),
            engagementId: string(ENGAGEMENT_UA_ID),
            date: string('2026-09-12'),
            dureeHeures: number(4),
            type: string('MENAGE'),
            realisePar: string('Camille'),
            etablissementId: null,
            etat: string('REALISEE'),
            aConfirmer: boolean(false),
          }),
          seuilAlerteJours: 56,
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/unites-associatives?foyer=${FOYER_ID}`,
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as {
        foyerId: string;
        engagement: { quotaHeures: number };
        compteurs: {
          heuresRealisees: number;
          heuresRestantes: number;
          coutSiArret: { montantCentimes: number; hypothese: string };
        };
      };
      expect(corps.foyerId).toBe(FOYER_ID);
      expect(corps.engagement.quotaHeures).toBe(20);
      expect(corps.compteurs.heuresRealisees).toBe(6);
      expect(corps.compteurs.heuresRestantes).toBe(14);
      expect(corps.compteurs.coutSiArret.montantCentimes).toBe(43750);
      // Le coût ne voyage jamais sans son hypothèse (RM-40-05).
      expect(corps.compteurs.coutSiArret.hypothese).toBe('SI_TU_TARRETES_LA');
    });
  });
});
