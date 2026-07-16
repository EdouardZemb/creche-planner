import { createHmac } from 'node:crypto';
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
// entre interactions par prudence ; l'unicité e-mail est **par foyer** (lot 5,
// parents actifs) et les states provider font table rase → idempotence garantie.
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
// exercer lecture/écriture. E-mail dédié (unicité e-mail par foyer).
const EMAIL_PARENT_PREFERENCES = 'sacha.leroy@example.test';
const ETAT_FOYER_AVEC_PREFERENCES =
  'un foyer de référence T3 avec un parent et ses préférences';

// Création atomique (Lot 2) : le dossier complet (foyer + enfant + parents) est
// créé en une seule commande transactionnelle. Le provider purge d'abord les
// e-mails visés (unicité e-mail par foyer) pour rendre l'état idempotent.
// `createurEmail` (créateur non-admin) est rattaché EN FIN par `svc-foyer`.
const CREATEUR_ID_CREATION = '44444444-4444-4444-8444-444444444444';
const EMAIL_PARENT_CREATION = 'camille.creation@example.test';
const EMAIL_CREATEUR_CREATION = 'createur.creation@example.test';
const ETAT_CREATION_LIBRE =
  'aucun parent existant ne bloque la création de référence';

// Lot 5 — intégrité du modèle parent & contrats d'erreur.
// 1) Résolution identité→foyers (`?parentEmail=`) : réutilise l'état « avec un
//    parent » (parent actif d'e-mail connu dans le foyer de référence).
// 2) Doublon e-mail (409 EMAIL_DEJA_UTILISE) : un parent ACTIF porte déjà cet
//    e-mail dans le foyer → un second ajout du même e-mail est refusé. Depuis le
//    lot 5, l'unicité e-mail est **par foyer sur les actifs**.
const PARENT_DOUBLON_ID = '66666666-6666-4666-8666-666666666666';
const EMAIL_PARENT_DOUBLON = 'doublon.actif@example.test';
const ETAT_PARENT_ACTIF_DOUBLON =
  'un parent actif avec cet e-mail existe déjà dans ce foyer';
// 3) Dernier parent actif (409 DERNIER_PARENT_ACTIF) : le foyer n'a qu'UN parent
//    actif → son retrait est refusé (la famille doit garder ≥ 1 parent).
const PARENT_UNIQUE_ID = '77777777-7777-4777-8777-777777777777';
const EMAIL_PARENT_UNIQUE = 'unique.actif@example.test';
const ETAT_FOYER_UN_SEUL_PARENT = "le foyer n'a qu'un seul parent actif";
// 4) Foyer inexistant (404) : un id d'UUID valide mais absent en base.
const FOYER_INEXISTANT_ID = '99999999-9999-4999-8999-999999999999';
const ETAT_AUCUN_FOYER = 'aucun foyer avec cet id';

// L4 — désabonnement one-click (RFC 8058, PR5). On signe les jetons **en inline**
// avec `node:crypto` (frontière ESLint : le consumer ne DOIT PAS importer
// `signerJeton` de svc-foyer). `SECRET_DESABO` DOIT être byte-identique au
// `DESABONNEMENT_TOKEN_SECRET` épinglé dans l'env de spawn du provider, sinon la
// signature ne vérifie pas. `EXP_LOINTAIN` (2100-01-01) place l'`exp` du jeton ET
// l'`expire_le` seedé dans le futur au moment du verify.
const SECRET_DESABO = 'pact-desabo-secret';
const EXP_LOINTAIN = 4102444800; // 2100-01-01, epoch s
function signerJetonTest(jti: string, exp: number): string {
  const p = Buffer.from(JSON.stringify({ jti, exp }), 'utf8').toString(
    'base64url',
  );
  const s = createHmac('sha256', SECRET_DESABO)
    .update(p)
    .digest()
    .toString('base64url');
  return `${p}.${s}`;
}
// Parent + jetons dédiés au désabo (states DÉDIÉS, table rase → idempotents).
const PARENT_DESABO_ID = '55555555-5555-4555-8555-555555555555';
const EMAIL_PARENT_DESABO = 'desabo.actif@example.test';
const JTI_DESABO_OK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JTI_DESABO_DERNIER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
// A (204) : couper un canal non critique (EMAIL) laisse IN_APP (défaut actif).
const ETAT_DESABO_OK =
  'un jeton de désabonnement valide coupe un canal non critique';
// B (409) : couper EMAIL alors qu'IN_APP est déjà coupé → dernier canal → 409,
// jeton NON consommé.
const ETAT_DESABO_DERNIER =
  'un jeton de désabonnement couperait le dernier canal actif';

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

  it('crée un dossier foyer complet (foyer + enfant + parents dont le créateur)', async () => {
    provider
      .given(ETAT_CREATION_LIBRE, {
        emails: [EMAIL_PARENT_CREATION, EMAIL_CREATEUR_CREATION],
      })
      .uponReceiving('une création atomique de dossier foyer de référence')
      .withRequest({
        method: 'POST',
        path: '/api/foyers',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        // Foyer de référence (doc 02 §0) + son dossier : enfant, parent saisi et
        // e-mail du créateur (rattaché en fin par `svc-foyer`).
        body: {
          ressourcesMensuelles: 6716.92,
          rfr: 72705,
          nbEnfantsACharge: 2,
          nbParts: 3,
          enfants: [{ prenom: 'Mia', dateNaissance: '2024-12-08' }],
          parents: [
            {
              email: EMAIL_PARENT_CREATION,
              prenom: 'Camille',
              nom: 'Martin',
              principal: true,
              ordre: 0,
            },
          ],
          createurEmail: EMAIL_CREATEUR_CREATION,
        },
      })
      .willRespondWith({
        status: 201,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        // Réponse = dossier complet. Les ids (foyer, enfant, parents) sont générés
        // par `svc-foyer` → matchés en type (`uuid`). La tranche T3 est figée.
        body: {
          foyer: {
            id: uuid(FOYER_REFERENCE_ID),
            ressourcesMensuellesCentimes: integer(671692),
            ressourcesMensuellesEuros: decimal(6716.92),
            rfrCentimes: integer(7270500),
            rfrEuros: integer(72705),
            nbEnfantsACharge: integer(2),
            nbParts: integer(3),
            tranche: 3,
          },
          enfants: [
            {
              id: uuid(ENFANT_REFERENCE_ID),
              foyerId: uuid(FOYER_REFERENCE_ID),
              prenom: string('Mia'),
              dateNaissance: string('2024-12-08'),
            },
          ],
          // Deux parents dans l'ordre d'insertion : le saisi (ordre 0), puis le
          // créateur ajouté en fin (ordre 1, identité douce nulle).
          parents: [
            {
              id: uuid(PARENT_REFERENCE_ID),
              foyerId: uuid(FOYER_REFERENCE_ID),
              prenom: string('Camille'),
              nom: string('Martin'),
              email: string(EMAIL_PARENT_CREATION),
              principal: boolean(true),
              ordre: integer(0),
              actif: boolean(true),
            },
            {
              id: uuid(CREATEUR_ID_CREATION),
              foyerId: uuid(FOYER_REFERENCE_ID),
              prenom: null,
              nom: null,
              email: string(EMAIL_CREATEUR_CREATION),
              principal: boolean(false),
              ordre: integer(1),
              actif: boolean(true),
            },
          ],
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
          enfants: [{ prenom: 'Mia', dateNaissance: '2024-12-08' }],
          parents: [
            {
              email: EMAIL_PARENT_CREATION,
              prenom: 'Camille',
              nom: 'Martin',
              principal: true,
              ordre: 0,
            },
          ],
          createurEmail: EMAIL_CREATEUR_CREATION,
        }),
      });
      expect(reponse.status).toBe(201);
      const corps = (await reponse.json()) as {
        foyer: { tranche: number };
        enfants: unknown[];
        parents: unknown[];
      };
      expect(corps.foyer.tranche).toBe(3);
      expect(corps.enfants).toHaveLength(1);
      expect(corps.parents).toHaveLength(2);
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

  // --- Lot 5 : résolution identité→foyers + contrats d'erreur -----------------

  it('résout les foyers d’un e-mail parent (?parentEmail=…) → liste d’ids', async () => {
    provider
      .given(ETAT_FOYER_AVEC_PARENT, {
        foyerId: FOYER_REFERENCE_ID,
        parentId: PARENT_REFERENCE_ID,
        email: EMAIL_PARENT_EXISTANT,
      })
      .uponReceiving('une résolution des foyers par e-mail parent')
      .withRequest({
        method: 'GET',
        path: '/api/foyers',
        query: { parentEmail: EMAIL_PARENT_EXISTANT },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        // Forme réelle renvoyée par `FoyerClient.foyersParEmail` : un tableau de
        // `foyerId` (chaînes uuid), au moins celui de référence.
        body: eachLike(uuid(FOYER_REFERENCE_ID)),
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/foyers?parentEmail=${encodeURIComponent(
          EMAIL_PARENT_EXISTANT,
        )}`,
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as string[];
      expect(Array.isArray(corps)).toBe(true);
      expect(corps).toContain(FOYER_REFERENCE_ID);
    });
  });

  it('refuse un parent à l’e-mail déjà utilisé dans le foyer (409 EMAIL_DEJA_UTILISE)', async () => {
    provider
      .given(ETAT_PARENT_ACTIF_DOUBLON, {
        foyerId: FOYER_REFERENCE_ID,
        parentId: PARENT_DOUBLON_ID,
        email: EMAIL_PARENT_DOUBLON,
      })
      .uponReceiving('un ajout de parent à l’e-mail déjà actif dans ce foyer')
      .withRequest({
        method: 'POST',
        path: `/api/foyers/${FOYER_REFERENCE_ID}/parents`,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: { email: EMAIL_PARENT_DOUBLON, principal: false, ordre: 0 },
      })
      .willRespondWith({
        status: 409,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        // Corps 409 structuré (lot 1) : le `code` machine distingue la cause côté
        // front (le BFF relaie le corps amont tel quel via `ErreurAmont`).
        body: {
          statusCode: integer(409),
          code: string('EMAIL_DEJA_UTILISE'),
          message: string('adresse e-mail déjà utilisée dans ce foyer'),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/foyers/${FOYER_REFERENCE_ID}/parents`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            email: EMAIL_PARENT_DOUBLON,
            principal: false,
            ordre: 0,
          }),
        },
      );
      expect(reponse.status).toBe(409);
      const corps = (await reponse.json()) as { code: string };
      expect(corps.code).toBe('EMAIL_DEJA_UTILISE');
    });
  });

  it('refuse le retrait du dernier parent actif (409 DERNIER_PARENT_ACTIF)', async () => {
    provider
      .given(ETAT_FOYER_UN_SEUL_PARENT, {
        foyerId: FOYER_REFERENCE_ID,
        parentId: PARENT_UNIQUE_ID,
        email: EMAIL_PARENT_UNIQUE,
      })
      .uponReceiving('un retrait du dernier parent actif du foyer')
      .withRequest({
        method: 'DELETE',
        path: `/api/foyers/${FOYER_REFERENCE_ID}/parents/${PARENT_UNIQUE_ID}`,
      })
      .willRespondWith({
        status: 409,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          statusCode: integer(409),
          code: string('DERNIER_PARENT_ACTIF'),
          message: string(
            'impossible de retirer le dernier parent actif du foyer',
          ),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/foyers/${FOYER_REFERENCE_ID}/parents/${PARENT_UNIQUE_ID}`,
        { method: 'DELETE' },
      );
      expect(reponse.status).toBe(409);
      const corps = (await reponse.json()) as { code: string };
      expect(corps.code).toBe('DERNIER_PARENT_ACTIF');
    });
  });

  it('renvoie 404 pour un foyer inexistant', async () => {
    provider
      .given(ETAT_AUCUN_FOYER, { id: FOYER_INEXISTANT_ID })
      .uponReceiving('une lecture d’un foyer inexistant')
      .withRequest({
        method: 'GET',
        path: `/api/foyers/${FOYER_INEXISTANT_ID}`,
      })
      .willRespondWith({
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          statusCode: integer(404),
          message: string(`foyer introuvable : ${FOYER_INEXISTANT_ID}`),
          error: string('Not Found'),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/foyers/${FOYER_INEXISTANT_ID}`,
      );
      expect(reponse.status).toBe(404);
    });
  });

  // --- L4 : désabonnement one-click (204 / 409 dernier canal / 400 lien invalide) ---

  it('consomme un jeton de désabonnement valide (204, canal non critique)', async () => {
    provider
      .given(ETAT_DESABO_OK, {
        foyerId: FOYER_REFERENCE_ID,
        parentId: PARENT_DESABO_ID,
        email: EMAIL_PARENT_DESABO,
        jti: JTI_DESABO_OK,
      })
      .uponReceiving(
        'une consommation de jeton de désabonnement (canal non critique)',
      )
      .withRequest({
        method: 'POST',
        path: '/api/desabonnement',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: { token: signerJetonTest(JTI_DESABO_OK, EXP_LOINTAIN) },
      })
      .willRespondWith({ status: 204 });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(`${mockServer.url}/api/desabonnement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          token: signerJetonTest(JTI_DESABO_OK, EXP_LOINTAIN),
        }),
      });
      expect(reponse.status).toBe(204);
    });
  });

  it('refuse (409) de couper le dernier canal actif via le lien one-click', async () => {
    provider
      .given(ETAT_DESABO_DERNIER, {
        foyerId: FOYER_REFERENCE_ID,
        parentId: PARENT_DESABO_ID,
        email: EMAIL_PARENT_DESABO,
        jti: JTI_DESABO_DERNIER,
      })
      .uponReceiving('une consommation de jeton coupant le dernier canal')
      .withRequest({
        method: 'POST',
        path: '/api/desabonnement',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: { token: signerJetonTest(JTI_DESABO_DERNIER, EXP_LOINTAIN) },
      })
      .willRespondWith({
        status: 409,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          statusCode: integer(409),
          message: string(
            'ce canal ne peut pas être coupé : au moins un canal doit rester actif',
          ),
          error: string('Conflict'),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(`${mockServer.url}/api/desabonnement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          token: signerJetonTest(JTI_DESABO_DERNIER, EXP_LOINTAIN),
        }),
      });
      expect(reponse.status).toBe(409);
    });
  });

  it('refuse (400) un lien de désabonnement invalide', async () => {
    provider
      // Réutilise l'état A : le jeton malformé est rejeté par la signature AVANT
      // tout accès base (400 générique, pas de fuite d'existence de compte).
      .given(ETAT_DESABO_OK, {
        foyerId: FOYER_REFERENCE_ID,
        parentId: PARENT_DESABO_ID,
        email: EMAIL_PARENT_DESABO,
        jti: JTI_DESABO_OK,
      })
      .uponReceiving('une consommation de jeton de désabonnement invalide')
      .withRequest({
        method: 'POST',
        path: '/api/desabonnement',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: { token: 'jeton.invalide' },
      })
      .willRespondWith({
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          statusCode: integer(400),
          message: string('lien de désabonnement invalide ou expiré'),
          error: string('Bad Request'),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(`${mockServer.url}/api/desabonnement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ token: 'jeton.invalide' }),
      });
      expect(reponse.status).toBe(400);
    });
  });

  // --- L4 : préférences 400 dernier-canal + édition parent 409 collision e-mail ---

  it('refuse (400) une mise à jour des préférences coupant le dernier canal', async () => {
    provider
      // Réutilise l'état existant : EMAIL stocké `actif=false`. Couper AUSSI IN_APP
      // ne laisse aucun canal actif pour VALIDATION_HEBDO (type de service) → 400.
      .given(ETAT_FOYER_AVEC_PREFERENCES, {
        foyerId: FOYER_REFERENCE_ID,
        parentId: PARENT_REFERENCE_ID,
        email: EMAIL_PARENT_PREFERENCES,
      })
      .uponReceiving('une mise à jour des préférences coupant le dernier canal')
      .withRequest({
        method: 'PUT',
        path: `/api/foyers/${FOYER_REFERENCE_ID}/parents/${PARENT_REFERENCE_ID}/preferences`,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          preferences: [
            {
              typeNotification: 'VALIDATION_HEBDO',
              canal: 'IN_APP',
              actif: false,
            },
          ],
        },
      })
      .willRespondWith({
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          statusCode: integer(400),
          message: string(
            'au moins un canal doit rester actif pour VALIDATION_HEBDO',
          ),
          error: string('Bad Request'),
        },
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
                canal: 'IN_APP',
                actif: false,
              },
            ],
          }),
        },
      );
      expect(reponse.status).toBe(400);
    });
  });

  it('refuse (409) l’édition d’un parent vers un e-mail déjà actif du foyer', async () => {
    provider
      // Réutilise l'état à DEUX parents : renommer le parent de référence sur
      // l'e-mail du « lest » (déjà actif dans ce foyer) heurte l'unicité par foyer
      // → 409 structuré EMAIL_DEJA_UTILISE (via `traduireUnicite`).
      .given(ETAT_FOYER_AVEC_DEUX_PARENTS, {
        foyerId: FOYER_REFERENCE_ID,
        parentId: PARENT_REFERENCE_ID,
        email: EMAIL_PARENT_EXISTANT,
        parentLestId: PARENT_LEST_ID,
        emailLest: EMAIL_PARENT_LEST,
      })
      .uponReceiving('une édition de parent vers un e-mail déjà actif du foyer')
      .withRequest({
        method: 'PUT',
        path: `/api/foyers/${FOYER_REFERENCE_ID}/parents/${PARENT_REFERENCE_ID}`,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: { email: EMAIL_PARENT_LEST },
      })
      .willRespondWith({
        status: 409,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          statusCode: integer(409),
          code: string('EMAIL_DEJA_UTILISE'),
          message: string('adresse e-mail déjà utilisée dans ce foyer'),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/foyers/${FOYER_REFERENCE_ID}/parents/${PARENT_REFERENCE_ID}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ email: EMAIL_PARENT_LEST }),
        },
      );
      expect(reponse.status).toBe(409);
      const corps = (await reponse.json()) as { code: string };
      expect(corps.code).toBe('EMAIL_DEJA_UTILISE');
    });
  });
});
