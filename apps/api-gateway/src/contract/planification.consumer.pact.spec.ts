import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MatchersV3, PactV3 } from '@pact-foundation/pact';

/**
 * Contrat **consommateur** : ce que l'`api-gateway` (BFF, consommateur réel en
 * Phase 7) attend du provider `svc-planification` pour « les prestations du mois »
 * d'un contrat crèche. Tourne contre un mock server Pact (aucune base) et génère
 * le pact file dans `<racine>/pacts/`, rejoué ensuite par la vérification provider
 * (`apps/svc-planification`) — bloquant en CI.
 *
 * L'état attendu doit rester **aligné** avec le `stateHandler` de la vérification
 * provider (`planification.provider.pact.spec.ts`).
 */
const ETAT_CONTRAT_CRECHE =
  'un contrat crèche de Mia avec un planning de mars 2026 existe';

/** État pour l'édition/suppression : un contrat éditable existe (seedé provider). */
const ETAT_CONTRAT_EXISTE = 'un contrat de garde modifiable existe';

/** État pour la liste : un foyer possède au moins un contrat (seedé provider). */
const ETAT_FOYER_AVEC_CONTRATS =
  'un foyer avec au moins un contrat de garde existe';

/** État relecture : un contrat avec une saisie de planning de mars 2026 enregistrée. */
const ETAT_PLANNING_SAISI =
  'un contrat crèche avec une saisie de planning de mars 2026 existe';

/** Identifiant figé du contrat (seedé par le stateHandler provider). */
const CONTRAT_ID = '11111111-1111-1111-1111-111111111111';

/** Foyer figé porteur des contrats listés (seedé par le stateHandler provider). */
const FOYER_LISTE_ID = '22222222-2222-2222-2222-222222222222';

/**
 * Foyer figé porté par le contrat seedé sous `ETAT_CONTRAT_EXISTE` (même valeur
 * que le stateHandler provider). Sert la résolution contrat → foyer (PR7).
 */
const FOYER_CONTRAT_ID = '22222222-2222-2222-2222-222222222222';

/**
 * Foyer du body de modification. Distinct de `FOYER_LISTE_ID` car ce champ-là
 * traverse la validation Zod du corps (`z.string().uuid()`), STRICTE en Zod 4 :
 * elle n'accepte qu'un UUID RFC (version 1-8, variant 8-b). Les IDs « 2222… »
 * (variant 2) sont tolérés par `ParseUUIDPipe` (path/query) mais REJETÉS par Zod
 * → 400 à la création/modif. On emploie donc ici un v4 valide.
 */
const FOYER_MODIF_ID = '22222222-2222-4222-8222-222222222222';

// nx lance vitest avec cwd = racine du projet (apps/api-gateway) → racine du dépôt à ../../.
const PACTS_DIR = resolve(process.cwd(), '../../pacts');

const { integer, uuid } = MatchersV3;

/** Identifiant figé du foyer porté par le contrat ABCM créé. */
const FOYER_ID = '33333333-3333-4333-8333-333333333333';
/** Identifiant figé du contrat ABCM créé (renvoyé par le provider). */
const CONTRAT_ABCM_ID = '44444444-4444-4444-4444-444444444444';

const provider = new PactV3({
  consumer: 'api-gateway',
  provider: 'svc-planification',
  dir: PACTS_DIR,
});

/**
 * Le provider valide `semaineType`/`semaineAbcm` comme des **Record exhaustifs des
 * 7 jours** (`z.record(enum, …)` est exhaustif en Zod 4 — cf. AN-02 doc 22 §28 et
 * doc 14 §3 : les jours non gardés portent une valeur VIDE, `[]` en crèche, `{}` en
 * ABCM, et non l'absence de clé). Le front envoie d'ailleurs déjà les 7 jours. Les
 * pacts ci-dessous, qui n'envoyaient que `LUNDI`, étaient donc rejetés en 400 à la
 * vérification provider. On reconstitue ici la semaine complète, réutilisée à
 * l'identique dans `withRequest` ET le `fetch` réel (sinon le mock ne matche pas).
 */
const JOURS_SEMAINE = [
  'LUNDI',
  'MARDI',
  'MERCREDI',
  'JEUDI',
  'VENDREDI',
  'SAMEDI',
  'DIMANCHE',
] as const;

const semaineAbcmCantineLundi: Record<
  string,
  Record<string, boolean>
> = Object.fromEntries(
  JOURS_SEMAINE.map((j) => [j, j === 'LUNDI' ? { cantine: true } : {}]),
);

const semaineTypeCrecheLundi: Record<string, Record<string, number>[]> =
  Object.fromEntries(
    JOURS_SEMAINE.map((j) => [
      j,
      j === 'LUNDI'
        ? [{ debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 }]
        : [],
    ]),
  );

describe('Pact consumer · api-gateway → svc-planification', () => {
  it('lit les prestations crèche du mois de mars 2026 (planning réel)', async () => {
    provider
      .given(ETAT_CONTRAT_CRECHE)
      .uponReceiving('une lecture des prestations crèche du mois (réel)')
      .withRequest({
        method: 'GET',
        path: '/api/prestations',
        query: { contrat: CONTRAT_ID, mois: '2026-03', simule: 'false' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          contratId: CONTRAT_ID,
          mois: '2026-03',
          simule: false,
          prestations: MatchersV3.eachLike({
            mode: 'CRECHE_PSU',
            // Heures mensualisées figées : 763 h / 7 mensualités = 109,00 h (doc 02 §7).
            heuresMensualisees: integer(109),
            heuresReserveesMinutes: integer(8430),
            heuresDeduitesMinutes: integer(0),
            complementMinutes: integer(0),
          }),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/prestations?contrat=${CONTRAT_ID}&mois=2026-03&simule=false`,
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as {
        contratId: string;
        mois: string;
        prestations: { mode: string }[];
      };
      expect(corps.contratId).toBe(CONTRAT_ID);
      expect(corps.mois).toBe('2026-03');
      expect(corps.prestations[0]?.mode).toBe('CRECHE_PSU');
    });
  });

  it("liste les contrats d'un foyer (GET /api/contrats?foyer=)", async () => {
    provider
      .given(ETAT_FOYER_AVEC_CONTRATS)
      .uponReceiving('une lecture de la liste des contrats du foyer')
      .withRequest({
        method: 'GET',
        path: '/api/contrats',
        query: { foyer: FOYER_LISTE_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        // Tableau de `ContratDetailVue` (forme renvoyée par `listerContrats`) :
        // en plus des champs cœur, la config mode-spécifique (semaine type, heures,
        // mensualités) que le BFF relaie au front pour piloter les calendriers.
        body: MatchersV3.eachLike({
          id: uuid(CONTRAT_ID),
          foyerId: uuid(FOYER_LISTE_ID),
          enfant: MatchersV3.string('Mia'),
          mode: MatchersV3.string('CRECHE_PSU'),
          valideDu: MatchersV3.string('2026-01-01'),
          valideAu: MatchersV3.string('2026-07-31'),
          heuresAnnuellesContractualisees: integer(763),
          nbMensualites: integer(7),
          semaineType: {
            LUNDI: MatchersV3.eachLike({
              debutHeures: integer(8),
              debutMinutes: integer(30),
              finHeures: integer(17),
              finMinutes: integer(0),
            }),
          },
        }),
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/contrats?foyer=${FOYER_LISTE_ID}`,
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as {
        id: string;
        foyerId: string;
        mode: string;
        nbMensualites: number;
        semaineType: Record<string, unknown[]>;
      }[];
      expect(Array.isArray(corps)).toBe(true);
      expect(corps[0]?.foyerId).toBe(FOYER_LISTE_ID);
      expect(corps[0]?.mode).toBe('CRECHE_PSU');
      expect(corps[0]?.nbMensualites).toBe(7);
      expect(corps[0]?.semaineType?.['LUNDI']?.length).toBeGreaterThan(0);
    });
  });

  it('crée un contrat cantine (ABCM) et reçoit sa projection', async () => {
    // Aucune précondition base : le service insère le contrat tel quel (foyerId stocké).
    provider
      .uponReceiving('une création de contrat cantine ABCM')
      .withRequest({
        method: 'POST',
        path: '/api/contrats',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          mode: 'CANTINE',
          foyerId: FOYER_ID,
          enfant: 'Zoé',
          valideDu: '2026-09-01',
          valideAu: null,
          semaineAbcm: semaineAbcmCantineLundi,
        },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          id: uuid(CONTRAT_ABCM_ID),
          foyerId: uuid(FOYER_ID),
          enfant: 'Zoé',
          // Valeur exacte : le contrat fige le mode CANTINE.
          mode: 'CANTINE',
          valideDu: '2026-09-01',
          valideAu: null,
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(`${mockServer.url}/api/contrats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          mode: 'CANTINE',
          foyerId: FOYER_ID,
          enfant: 'Zoé',
          valideDu: '2026-09-01',
          valideAu: null,
          semaineAbcm: semaineAbcmCantineLundi,
        }),
      });
      expect(reponse.status).toBe(201);
      const corps = (await reponse.json()) as { id: string; mode: string };
      expect(corps.mode).toBe('CANTINE');
    });
  });

  it('lit le cœur d’un contrat par id (GET /api/contrats/:id → foyerId)', async () => {
    // Résolution contrat → foyer du guard d'appartenance (PR7). Réutilise l'état
    // « un contrat de garde modifiable existe » (contrat CONTRAT_ID, foyer figé).
    provider
      .given(ETAT_CONTRAT_EXISTE)
      .uponReceiving('une lecture du cœur d’un contrat par id')
      .withRequest({
        method: 'GET',
        path: `/api/contrats/${CONTRAT_ID}`,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          id: uuid(CONTRAT_ID),
          foyerId: uuid(FOYER_CONTRAT_ID),
          enfant: MatchersV3.string('Mia'),
          mode: MatchersV3.string('CRECHE_PSU'),
          valideDu: MatchersV3.string('2026-01-01'),
          valideAu: MatchersV3.string('2026-07-31'),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/contrats/${CONTRAT_ID}`,
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { id: string; foyerId: string };
      expect(corps.id).toBe(CONTRAT_ID);
      expect(corps.foyerId).toBe(FOYER_CONTRAT_ID);
    });
  });

  it('modifie un contrat existant (PUT) et reçoit sa projection', async () => {
    provider
      .given(ETAT_CONTRAT_EXISTE)
      .uponReceiving('une modification de contrat crèche')
      .withRequest({
        method: 'PUT',
        path: `/api/contrats/${CONTRAT_ID}`,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          mode: 'CRECHE_PSU',
          foyerId: FOYER_MODIF_ID,
          enfant: 'Mia',
          valideDu: '2026-01-01',
          valideAu: '2026-12-31',
          heuresAnnuellesContractualisees: 763,
          nbMensualites: 7,
          semaineType: semaineTypeCrecheLundi,
        },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          id: uuid(CONTRAT_ID),
          foyerId: uuid(FOYER_MODIF_ID),
          enfant: 'Mia',
          mode: 'CRECHE_PSU',
          valideDu: '2026-01-01',
          valideAu: '2026-12-31',
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/contrats/${CONTRAT_ID}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            mode: 'CRECHE_PSU',
            foyerId: FOYER_MODIF_ID,
            enfant: 'Mia',
            valideDu: '2026-01-01',
            valideAu: '2026-12-31',
            heuresAnnuellesContractualisees: 763,
            nbMensualites: 7,
            semaineType: semaineTypeCrecheLundi,
          }),
        },
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { id: string; valideAu: string };
      expect(corps.valideAu).toBe('2026-12-31');
    });
  });

  it('supprime un contrat existant (DELETE → 204)', async () => {
    provider
      .given(ETAT_CONTRAT_EXISTE)
      .uponReceiving('une suppression de contrat')
      .withRequest({
        method: 'DELETE',
        path: `/api/contrats/${CONTRAT_ID}`,
      })
      .willRespondWith({ status: 204 });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/contrats/${CONTRAT_ID}`,
        {
          method: 'DELETE',
        },
      );
      expect(reponse.status).toBe(204);
    });
  });

  it('relit la saisie de planning enregistrée d’un mois (GET .../plannings/:mois)', async () => {
    provider
      .given(ETAT_PLANNING_SAISI)
      .uponReceiving(
        'une relecture de la saisie de planning d’un mois (saisie présente)',
      )
      .withRequest({
        method: 'GET',
        path: `/api/contrats/${CONTRAT_ID}/plannings/2026-03`,
        query: { simule: 'false' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        // Forme renvoyée par le contrôleur : `{ saisie: EcrirePlanningDto | null }`.
        // Ici la saisie crèche stockée (complément + un jour supplémentaire).
        body: {
          saisie: {
            complementMinutes: integer(60),
            joursSupplementaires: MatchersV3.eachLike({
              date: MatchersV3.string('2026-03-18'),
              debutHeures: integer(9),
              debutMinutes: integer(0),
              finHeures: integer(12),
              finMinutes: integer(0),
            }),
          },
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/contrats/${CONTRAT_ID}/plannings/2026-03?simule=false`,
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as {
        saisie: { complementMinutes?: number } | null;
      };
      expect(corps.saisie).not.toBeNull();
      expect(corps.saisie?.complementMinutes).toBe(60);
    });
  });

  it('édite les besoins d’une semaine (PUT .../plannings/semaine/:iso → 204)', async () => {
    // Le contrat existe (ETAT_CONTRAT_EXISTE). Le service relit le mois (vide),
    // fusionne la semaine et ré-upsert → 204. Corps = catégories datées seules.
    const besoins = {
      joursSupplementaires: [
        {
          date: '2026-03-10', // dans 2026-W11 (tout mars).
          debutHeures: 9,
          debutMinutes: 0,
          finHeures: 12,
          finMinutes: 0,
        },
      ],
    };
    provider
      .given(ETAT_CONTRAT_EXISTE)
      .uponReceiving('une édition des besoins d’une semaine (réel)')
      .withRequest({
        method: 'PUT',
        path: `/api/contrats/${CONTRAT_ID}/plannings/semaine/2026-W11`,
        query: { simule: 'false' },
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: besoins,
      })
      .willRespondWith({ status: 204 });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/contrats/${CONTRAT_ID}/plannings/semaine/2026-W11?simule=false`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(besoins),
        },
      );
      expect(reponse.status).toBe(204);
    });
  });

  it('relit un mois sans saisie → { saisie: null } (200)', async () => {
    // Le contrat existe mais aucun planning n'a été enregistré : le service
    // répond 200 avec `{ saisie: null }` (et NON 204) — cf. lirePlanning.
    provider
      .given(ETAT_CONTRAT_EXISTE)
      .uponReceiving('une relecture de planning sans saisie enregistrée')
      .withRequest({
        method: 'GET',
        path: `/api/contrats/${CONTRAT_ID}/plannings/2026-03`,
        query: { simule: 'false' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: { saisie: null },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/contrats/${CONTRAT_ID}/plannings/2026-03?simule=false`,
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { saisie: unknown };
      expect(corps.saisie).toBeNull();
    });
  });
});
