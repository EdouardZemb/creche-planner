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

/**
 * États de nettoyage des créations « à la volée » : `nouvelEtablissement` insère
 * toujours (contrainte unique (foyer, nom) côté provider) — sans purge préalable,
 * rejouer la vérification sur une base persistante (local) casse en doublon.
 */
const ETAT_SANS_ETAB_CANTINE =
  'aucun établissement « Crèche Pact CANTINE » n existe';
const ETAT_SANS_ETAB_ALSH = 'aucun établissement « Centre Pact ALSH » n existe';

/**
 * État versionné (SFD 30 lot 4) : le contrat porte une version initiale d'id
 * FIGÉ (`VERSION_ID`), cible des interactions correction/historique/impact.
 */
const ETAT_CONTRAT_VERSIONNE =
  'un contrat crèche avec une version initiale identifiée existe';

/** Identifiant figé de la version initiale seedée (aligné provider). */
const VERSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * Établissement seedé par le provider, rattaché aux contrats figés. UUID **v4
 * valide** : sa valeur repasse dans le corps `version-courante`, où
 * `z.string().uuid()` (Zod 4) exige version 1-8 / variant 8-b.
 */
const ETAB_SEED_ID = '99999999-9999-4999-8999-999999999999';

/** Identifiant figé du contrat (seedé par le stateHandler provider). */
const CONTRAT_ID = '11111111-1111-1111-1111-111111111111';

/**
 * État calendrier (SFD 31, lot 2) : un établissement dont les trois couches sont
 * seedées **et dont la récurrence du lundi a été retouchée**, la ligne antérieure
 * restant ouverte jusqu'au 1er avril. C'est cette retouche qui donne son sens à
 * l'interaction : le même jour, lu à deux instants de connaissance, doit rendre
 * deux réponses. Un état sans retouche laisserait passer une implémentation qui
 * ignore `aLaDate` — le contrat serait vert et faux.
 */
const ETAT_CALENDRIER =
  'un établissement avec un calendrier d’ouverture retouché existe';

/**
 * État d'import (SFD 31, lot 3) : même établissement, zone B, ET **l'open data
 * neutralisé côté provider**. La vérification provider tourne contre une vraie
 * base ; elle ne doit pour autant jamais sortir sur Internet — un contrat qui
 * dépend d'une API tierce rougit un jour sans qu'une ligne ait bougé.
 */
const ETAT_CALENDRIER_IMPORTABLE =
  'un établissement de zone B dont l’open data scolaire est neutralisé';

/** Établissement porteur du calendrier seedé (aligné stateHandler provider). */
const ETAB_CALENDRIER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/**
 * Instants de connaissance encadrant la retouche du 1er avril (elle-même seedée
 * par le provider). Format `Instant` : UTC de largeur fixe, sans offset.
 */
const AVANT_RETOUCHE = '2026-02-01T00:00:00.000Z';
const APRES_RETOUCHE = '2026-05-01T00:00:00.000Z';

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
/**
 * Clés d'idempotence de création (chantier « Confiance », lot 3 — C1) : la GATEWAY
 * génère cet `id` et l'injecte dans le corps du POST **avant** son retry résilient
 * (les 2 tentatives le partagent) → dédup par PK côté provider. Le pact le matche
 * par regex UUID (comme `$.id` de la réponse). Exemples UUID **v4 valides** : le
 * provider rejoue cette valeur, qui traverse `z.string().uuid()` (Zod 4, strict
 * version 1-8 / variant 8-b) du DTO de création. **Distincts par interaction** :
 * l'insert étant désormais idempotent (dédup par `contrat.id`), un id partagé
 * ferait renvoyer, à la 2ᵉ interaction vérifiée, le contrat déjà créé par la 1ʳᵉ.
 */
const CONTRAT_CREE_CANTINE_ID = '55555555-5555-4555-8555-555555555555';
const CONTRAT_CREE_ALSH_ID = '66666666-6666-4666-8666-666666666666';
/**
 * Enfant figé des contrats seedés provider (aligné `ENFANT_SEED_ID` du
 * stateHandler). UUID RFC (v4) : le champ traverse `z.string().uuid()` (Zod 4,
 * strict version/variant) dans les corps de création/modification.
 */
const ENFANT_ID = '77777777-7777-4777-8777-777777777777';

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

// `retry: 1` : parade à la course pact-core sous charge CPU en CI (match
// enregistré côté mock server mais « expected but not received » à la
// vérification) — détail dans vitest.config.mts. Rejeu sûr (interaction
// ré-enregistrée dans le corps du `it`).
describe(
  'Pact consumer · api-gateway → svc-planification',
  { retry: 1 },
  () => {
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
            enfantId: uuid(ENFANT_ID),
            mode: MatchersV3.string('CRECHE_PSU'),
            valideDu: MatchersV3.string('2026-01-01'),
            valideAu: MatchersV3.string('2026-07-31'),
            // Première inscription ABCM (lot 4a) : exposée en lecture (false ici,
            // contrat crèche seedé — le champ est toujours false en CRECHE_PSU).
            premiereInscription: MatchersV3.boolean(false),
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
      provider
        .given(ETAT_SANS_ETAB_CANTINE)
        .uponReceiving('une création de contrat cantine ABCM')
        .withRequest({
          method: 'POST',
          path: '/api/contrats',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: {
            // Clé d'idempotence injectée par la gateway (lot 3 — C1), regex UUID.
            id: uuid(CONTRAT_CREE_CANTINE_ID),
            mode: 'CANTINE',
            foyerId: FOYER_ID,
            enfant: 'Zoé',
            enfantId: ENFANT_ID,
            valideDu: '2026-09-01',
            valideAu: null,
            semaineAbcm: semaineAbcmCantineLundi,
            // Première inscription ABCM (lot 4a) : cochée par le parent.
            premiereInscription: true,
            // Lien établissement OBLIGATOIRE (P5) : créé à la volée (aucun seed requis).
            nouvelEtablissement: { nom: 'Crèche Pact CANTINE' },
          },
        })
        .willRespondWith({
          status: 201,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: {
            id: uuid(CONTRAT_ABCM_ID),
            foyerId: uuid(FOYER_ID),
            enfant: 'Zoé',
            enfantId: uuid(ENFANT_ID),
            // Valeur exacte : le contrat fige le mode CANTINE.
            mode: 'CANTINE',
            valideDu: '2026-09-01',
            valideAu: null,
            // Valeur exacte : la coche demandée est persistée et restituée.
            premiereInscription: true,
          },
        });

      await provider.executeTest(async (mockServer) => {
        const reponse = await fetch(`${mockServer.url}/api/contrats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            id: CONTRAT_CREE_CANTINE_ID,
            mode: 'CANTINE',
            foyerId: FOYER_ID,
            enfant: 'Zoé',
            enfantId: ENFANT_ID,
            valideDu: '2026-09-01',
            valideAu: null,
            semaineAbcm: semaineAbcmCantineLundi,
            premiereInscription: true,
            nouvelEtablissement: { nom: 'Crèche Pact CANTINE' },
          }),
        });
        expect(reponse.status).toBe(201);
        const corps = (await reponse.json()) as {
          id: string;
          mode: string;
          premiereInscription: boolean;
        };
        expect(corps.mode).toBe('CANTINE');
        expect(corps.premiereInscription).toBe(true);
      });
    });

    it('crée un contrat ALSH avec inscription hebdomadaire (mercredis récurrents)', async () => {
      // Verrouille l'acceptation provider de `semaineAbcm[jour].alsh` (formule +
      // repas) : avant cette modélisation, la clé était silencieusement éliminée
      // par la validation Zod (saisie parent perdue sans erreur).
      const semaineAbcmAlshMercredi: Record<string, unknown> =
        Object.fromEntries(
          JOURS_SEMAINE.map((j) => [
            j,
            j === 'MERCREDI' ? { alsh: { type: 'COMPLETE', repas: true } } : {},
          ]),
        );
      const corpsCreation = {
        mode: 'ALSH',
        foyerId: FOYER_ID,
        enfant: 'Zoé',
        enfantId: ENFANT_ID,
        valideDu: '2026-09-01',
        valideAu: null,
        semaineAbcm: semaineAbcmAlshMercredi,
        nouvelEtablissement: { nom: 'Centre Pact ALSH' },
      };
      provider
        .given(ETAT_SANS_ETAB_ALSH)
        .uponReceiving(
          'une création de contrat ALSH avec récurrence hebdomadaire',
        )
        .withRequest({
          method: 'POST',
          path: '/api/contrats',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          // Clé d'idempotence injectée par la gateway (lot 3 — C1), regex UUID.
          body: { ...corpsCreation, id: uuid(CONTRAT_CREE_ALSH_ID) },
        })
        .willRespondWith({
          status: 201,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: {
            id: uuid(CONTRAT_ABCM_ID),
            foyerId: uuid(FOYER_ID),
            enfant: 'Zoé',
            enfantId: uuid(ENFANT_ID),
            mode: 'ALSH',
            valideDu: '2026-09-01',
            valideAu: null,
            // Rétro-compat lot 4a : corps de création SANS premiereInscription
            // (comme le front pré-lot 4a) → défaut false persisté et restitué.
            premiereInscription: false,
          },
        });

      await provider.executeTest(async (mockServer) => {
        const reponse = await fetch(`${mockServer.url}/api/contrats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ ...corpsCreation, id: CONTRAT_CREE_ALSH_ID }),
        });
        expect(reponse.status).toBe(201);
        const corps = (await reponse.json()) as { id: string; mode: string };
        expect(corps.mode).toBe('ALSH');
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
            enfantId: uuid(ENFANT_ID),
            mode: MatchersV3.string('CRECHE_PSU'),
            valideDu: MatchersV3.string('2026-01-01'),
            valideAu: MatchersV3.string('2026-07-31'),
            premiereInscription: MatchersV3.boolean(false),
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

    it('corrige la version courante (PUT .../version-courante) et reçoit la projection', async () => {
      // Remplace l'ancien « PUT /api/contrats/:id » (SFD 30 lot 4) : correction NON
      // destructive de la version courante — le corps reste le contrat complet mais
      // seuls les champs versionnés sont appliqués (H6) et les plannings survivent.
      const corpsModif = {
        mode: 'CRECHE_PSU',
        foyerId: FOYER_MODIF_ID,
        enfant: 'Mia',
        enfantId: ENFANT_ID,
        valideDu: '2026-01-01',
        valideAu: '2026-07-31',
        heuresAnnuellesContractualisees: 763,
        nbMensualites: 7,
        semaineType: semaineTypeCrecheLundi,
        etablissementId: ETAB_SEED_ID,
      };
      provider
        .given(ETAT_CONTRAT_EXISTE)
        .uponReceiving(
          'une correction de la version courante d’un contrat crèche',
        )
        .withRequest({
          method: 'PUT',
          path: `/api/contrats/${CONTRAT_ID}/version-courante`,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: corpsModif,
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: {
            id: uuid(CONTRAT_ID),
            foyerId: uuid(FOYER_CONTRAT_ID),
            enfant: 'Mia',
            enfantId: uuid(ENFANT_ID),
            mode: 'CRECHE_PSU',
            valideDu: '2026-01-01',
            valideAu: '2026-07-31',
            // Toujours false pour un contrat crèche (le DTO n'expose pas le champ).
            premiereInscription: false,
          },
        });

      await provider.executeTest(async (mockServer) => {
        const reponse = await fetch(
          `${mockServer.url}/api/contrats/${CONTRAT_ID}/version-courante`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(corpsModif),
          },
        );
        expect(reponse.status).toBe(200);
        const corps = (await reponse.json()) as {
          id: string;
          valideAu: string;
        };
        expect(corps.valideAu).toBe('2026-07-31');
      });
    });

    it('crée un avenant (POST .../versions) et reçoit la projection du contrat', async () => {
      // Avenant SFD 30 lot 4 : nouvelle version à date d'effet, paramètres
      // versionnés seuls (l'identité vient du contrat, H6).
      const corpsAvenant = {
        mode: 'CRECHE_PSU',
        dateEffet: '2026-06-01',
        heuresAnnuellesContractualisees: 700,
        nbMensualites: 7,
        semaineType: semaineTypeCrecheLundi,
        motif: 'changement de rentrée',
      };
      provider
        .given(ETAT_CONTRAT_EXISTE)
        .uponReceiving('une création d’avenant sur un contrat crèche')
        .withRequest({
          method: 'POST',
          path: `/api/contrats/${CONTRAT_ID}/versions`,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: corpsAvenant,
        })
        .willRespondWith({
          status: 201,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: {
            id: uuid(CONTRAT_ID),
            foyerId: uuid(FOYER_CONTRAT_ID),
            enfant: 'Mia',
            enfantId: uuid(ENFANT_ID),
            mode: 'CRECHE_PSU',
            valideDu: '2026-01-01',
            valideAu: '2026-07-31',
            premiereInscription: false,
          },
        });

      await provider.executeTest(async (mockServer) => {
        const reponse = await fetch(
          `${mockServer.url}/api/contrats/${CONTRAT_ID}/versions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(corpsAvenant),
          },
        );
        expect(reponse.status).toBe(201);
        const corps = (await reponse.json()) as { id: string; mode: string };
        expect(corps.id).toBe(CONTRAT_ID);
        expect(corps.mode).toBe('CRECHE_PSU');
      });
    });

    it('liste l’historique des versions (GET .../versions)', async () => {
      provider
        .given(ETAT_CONTRAT_VERSIONNE)
        .uponReceiving('une lecture de l’historique des versions d’un contrat')
        .withRequest({
          method: 'GET',
          path: `/api/contrats/${CONTRAT_ID}/versions`,
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: MatchersV3.eachLike({
            id: uuid(VERSION_ID),
            contratId: uuid(CONTRAT_ID),
            mode: MatchersV3.string('CRECHE_PSU'),
            dateEffet: MatchersV3.string('2026-01-01'),
            du: MatchersV3.string('2026-01-01'),
            // Version unique et ouverte : borne haute dérivée absente (null).
            au: null,
            heuresAnnuellesContractualisees: integer(763),
            nbMensualites: integer(7),
            saisiLe: MatchersV3.timestamp(
              "yyyy-MM-dd'T'HH:mm:ss.SSSX",
              '2026-01-01T00:00:00.000Z',
            ),
            motif: null,
          }),
        });

      await provider.executeTest(async (mockServer) => {
        const reponse = await fetch(
          `${mockServer.url}/api/contrats/${CONTRAT_ID}/versions`,
        );
        expect(reponse.status).toBe(200);
        const corps = (await reponse.json()) as {
          id: string;
          dateEffet: string;
          au: string | null;
        }[];
        expect(Array.isArray(corps)).toBe(true);
        expect(corps[0]?.dateEffet).toBe('2026-01-01');
      });
    });

    it('corrige une version existante (PUT .../versions/:versionId)', async () => {
      const corpsCorrection = {
        mode: 'CRECHE_PSU',
        heuresAnnuellesContractualisees: 700,
        nbMensualites: 7,
        semaineType: semaineTypeCrecheLundi,
        motif: 'erreur de saisie',
      };
      provider
        .given(ETAT_CONTRAT_VERSIONNE)
        .uponReceiving('une correction d’une version existante d’un contrat')
        .withRequest({
          method: 'PUT',
          path: `/api/contrats/${CONTRAT_ID}/versions/${VERSION_ID}`,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: corpsCorrection,
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: {
            id: uuid(CONTRAT_ID),
            foyerId: uuid(FOYER_CONTRAT_ID),
            enfant: 'Mia',
            enfantId: uuid(ENFANT_ID),
            mode: 'CRECHE_PSU',
            valideDu: '2026-01-01',
            valideAu: '2026-07-31',
            premiereInscription: false,
          },
        });

      await provider.executeTest(async (mockServer) => {
        const reponse = await fetch(
          `${mockServer.url}/api/contrats/${CONTRAT_ID}/versions/${VERSION_ID}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(corpsCorrection),
          },
        );
        expect(reponse.status).toBe(200);
        const corps = (await reponse.json()) as { id: string };
        expect(corps.id).toBe(CONTRAT_ID);
      });
    });

    it('donne l’aperçu d’impact d’une version (GET .../versions/:versionId/impact)', async () => {
      provider
        .given(ETAT_CONTRAT_VERSIONNE)
        .uponReceiving('une lecture de l’aperçu d’impact d’une version')
        .withRequest({
          method: 'GET',
          path: `/api/contrats/${CONTRAT_ID}/versions/${VERSION_ID}/impact`,
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: {
            versionId: uuid(VERSION_ID),
            // Version [2026-01-01, ouverte] plafonnée à valideAu 2026-07-31 → 7 mois.
            moisCouverts: MatchersV3.eachLike(MatchersV3.string('2026-01')),
          },
        });

      await provider.executeTest(async (mockServer) => {
        const reponse = await fetch(
          `${mockServer.url}/api/contrats/${CONTRAT_ID}/versions/${VERSION_ID}/impact`,
        );
        expect(reponse.status).toBe(200);
        const corps = (await reponse.json()) as {
          versionId: string;
          moisCouverts: string[];
        };
        expect(corps.versionId).toBe(VERSION_ID);
        expect(corps.moisCouverts.length).toBeGreaterThan(0);
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

    /**
     * ⚠️ **Le contrat gelé du chantier.** La forme de cette réponse sera
     * consommée par le plan 33 via un client REST inter-services **sans pact** —
     * un consommateur silencieux. Le pact ci-dessous est donc la seule garde qui
     * la surveille, et il porte délibérément sur le cas qui compte : `aLaDate`
     * **explicite**, encadrant une retouche seedée.
     */
    it('lit le calendrier résolu d’un établissement à un instant de connaissance', async () => {
      provider
        .given(ETAT_CALENDRIER)
        .uponReceiving('une lecture du calendrier résolu d’un établissement')
        .withRequest({
          method: 'GET',
          path: `/api/etablissements/${ETAB_CALENDRIER_ID}/calendrier`,
          query: {
            du: '2026-03-02',
            au: '2026-03-03',
            aLaDate: APRES_RETOUCHE,
          },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: {
            du: '2026-03-02',
            au: '2026-03-03',
            // Réverbéré tel quel : c'est ce qui rend l'instant employé
            // observable par l'appelant, y compris quand il l'omet.
            aLaDate: APRES_RETOUCHE,
            jours: [
              {
                jour: '2026-03-02',
                contexte: 'PERIODE_SCOLAIRE',
                libelle: '',
                // La retouche du 1er avril a retiré PERISCOLAIRE : lu APRÈS,
                // le lundi n'ouvre plus que la cantine.
                servicesOuverts: ['CANTINE'],
              },
              {
                jour: '2026-03-03',
                contexte: 'FERMETURE',
                libelle: MatchersV3.string('Fermeture exceptionnelle'),
                servicesOuverts: [],
              },
            ],
          },
        });

      await provider.executeTest(async (mockServer) => {
        const reponse = await fetch(
          `${mockServer.url}/api/etablissements/${ETAB_CALENDRIER_ID}/calendrier` +
            `?du=2026-03-02&au=2026-03-03&aLaDate=${encodeURIComponent(APRES_RETOUCHE)}`,
        );
        expect(reponse.status).toBe(200);
        const corps = (await reponse.json()) as {
          aLaDate: string;
          jours: { jour: string; servicesOuverts: string[] }[];
        };
        expect(corps.aLaDate).toBe(APRES_RETOUCHE);
        expect(corps.jours[0]?.servicesOuverts).toEqual(['CANTINE']);
      });
    });

    /**
     * Le pendant du précédent, et sa **sonde négative** : même établissement,
     * même jour, instant de connaissance ANTÉRIEUR à la retouche → l'ancienne
     * réponse. Une implémentation qui ignorerait `aLaDate` rendrait ici la
     * réponse d'aujourd'hui et ferait rougir la vérification provider.
     */
    it('rend l’ancienne réponse pour un instant antérieur à la retouche', async () => {
      provider
        .given(ETAT_CALENDRIER)
        .uponReceiving('une lecture du calendrier résolu avant retouche')
        .withRequest({
          method: 'GET',
          path: `/api/etablissements/${ETAB_CALENDRIER_ID}/calendrier`,
          query: {
            du: '2026-03-02',
            au: '2026-03-02',
            aLaDate: AVANT_RETOUCHE,
          },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: {
            du: '2026-03-02',
            au: '2026-03-02',
            aLaDate: AVANT_RETOUCHE,
            jours: [
              {
                jour: '2026-03-02',
                contexte: 'PERIODE_SCOLAIRE',
                libelle: '',
                servicesOuverts: ['CANTINE', 'PERISCOLAIRE'],
              },
            ],
          },
        });

      await provider.executeTest(async (mockServer) => {
        const reponse = await fetch(
          `${mockServer.url}/api/etablissements/${ETAB_CALENDRIER_ID}/calendrier` +
            `?du=2026-03-02&au=2026-03-02&aLaDate=${encodeURIComponent(AVANT_RETOUCHE)}`,
        );
        expect(reponse.status).toBe(200);
        const corps = (await reponse.json()) as {
          jours: { servicesOuverts: string[] }[];
        };
        expect(corps.jours[0]?.servicesOuverts).toEqual([
          'CANTINE',
          'PERISCOLAIRE',
        ]);
      });
    });

    /**
     * L'import (US-31-01, lot 3). Le contrat porte sur le **compte rendu**, pas
     * sur les périodes : celles-ci se relisent par `GET …/calendrier/periodes`,
     * seule source de vérité. Deux vues de la même chose finiraient par diverger.
     */
    it('importe une année scolaire et rend un compte rendu (200)', async () => {
      provider
        .given(ETAT_CALENDRIER_IMPORTABLE)
        .uponReceiving('un import du calendrier scolaire pour 2026-2027')
        .withRequest({
          method: 'POST',
          path: `/api/etablissements/${ETAB_CALENDRIER_ID}/calendrier/import`,
          headers: { 'Content-Type': 'application/json' },
          body: { anneeScolaire: '2026-2027' },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: {
            anneeScolaire: '2026-2027',
            zoneScolaire: 'B',
            importees: MatchersV3.integer(5),
            // 0 au premier import : le champ existe pour que l'écran puisse dire
            // « rafraîchi » plutôt que « importé » au second.
            remplacees: MatchersV3.integer(0),
          },
        });

      await provider.executeTest(async (mockServer) => {
        const reponse = await fetch(
          `${mockServer.url}/api/etablissements/${ETAB_CALENDRIER_ID}/calendrier/import`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ anneeScolaire: '2026-2027' }),
          },
        );
        expect(reponse.status).toBe(200);
        const corps = (await reponse.json()) as {
          zoneScolaire: string;
          importees: number;
        };
        expect(corps.zoneScolaire).toBe('B');
        expect(corps.importees).toBeGreaterThan(0);
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
  },
);
