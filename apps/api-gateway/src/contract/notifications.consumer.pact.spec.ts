import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MatchersV3, PactV3 } from '@pact-foundation/pact';

/**
 * Contrat **consommateur** : ce que l'`api-gateway` (BFF) attend du provider
 * `svc-notifications` pour l'annuaire des établissements destinataires (Lot 3).
 * Tourne contre un mock server Pact (aucune base) et génère le pact file dans
 * `<racine>/pacts/`, rejoué ensuite par la vérification provider
 * (`apps/svc-notifications`) — bloquant en CI.
 *
 * Les états doivent rester **alignés** avec les `stateHandlers` de la vérification
 * provider (`notifications.provider.pact.spec.ts`).
 */
const ETAT_SEMAINE_A_VALIDER = 'une semaine est à valider pour un foyer';
const ETAT_SEMAINE_VALIDABLE = 'une semaine A_VALIDER existe pour validation';
const ETAT_BROUILLON =
  'un brouillon de mail agrégé par établissement est disponible';
const ETAT_BROUILLON_SANS_EMAIL =
  'un brouillon agrégé pour un établissement sans e-mail est disponible';
const ETAT_BROUILLON_ARCHIVE =
  'un brouillon agrégé pour un établissement archivé est disponible';
const ETAT_ENVOI =
  'un récap agrégé par établissement est prêt à envoyer au service';
// Inbox in-app (PR6, §5.6) : un parent a UNE notification in-app non lue. Le même
// état sert la liste (200), l'accusé (200) et le 404 cross-parent (la notif reste
// possédée par `PARENT_INBOX_ID` ; le 404 la requête avec `AUTRE_PARENT_ID`).
const ETAT_INBOX = 'un parent a une notification in-app non lue';

/** Identifiants figés partagés avec les stateHandlers de la vérification provider. */
const FOYER_ID = '22222222-2222-4222-8222-222222222222';
const CONTRAT_ID = '55555555-0000-4000-8000-000000000000';
// Établissement réel destinataire du récap agrégé (read model `etablissement`, P3),
// rattaché au contrat par le lien explicite `contrat.etablissement_id`.
const ETABLISSEMENT_ID = '99999999-9999-4999-8999-999999999999';
// Établissement du même foyer **sans e-mail de service** → brouillon non routable.
const ETABLISSEMENT_SANS_EMAIL_ID = '99999999-9999-4999-8999-999999999998';
// Établissement du même foyer **archivé** (avec e-mail) → non routable, raison ARCHIVE
// prioritaire sur SANS_EMAIL.
const ETABLISSEMENT_ARCHIVE_ID = '99999999-9999-4999-8999-999999999997';
// Semaine entièrement dans un mois (mars) : une seule relecture amont côté provider.
const SEMAINE = '2026-W10';

// Inbox in-app : le parent propriétaire de la notification, un AUTRE parent (pour
// le 404 cross-parent), et l'id de la notification seedée. UUID v4 valides
// (`ParseUUIDPipe` rejette sinon), partagés avec le stateHandler provider.
const PARENT_INBOX_ID = '77777777-7777-4777-8777-777777777777';
const AUTRE_PARENT_ID = '66666666-6666-4666-8666-666666666666';
const NOTIF_INBOX_ID = '88888888-8888-4888-8888-888888888892';

// nx lance vitest avec cwd = racine du projet (apps/api-gateway) → racine du dépôt à ../../.
const PACTS_DIR = resolve(process.cwd(), '../../pacts');

const { string, boolean, integer } = MatchersV3;

const provider = new PactV3({
  consumer: 'api-gateway',
  provider: 'svc-notifications',
  dir: PACTS_DIR,
});

describe('Pact consumer · api-gateway → svc-notifications', () => {
  it('liste les semaines à valider d’un foyer (GET /api/validations/a-valider)', async () => {
    provider
      .given(ETAT_SEMAINE_A_VALIDER)
      .uponReceiving('une lecture des semaines à valider d’un foyer')
      .withRequest({
        method: 'GET',
        path: '/api/validations/a-valider',
        query: { foyer: FOYER_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: MatchersV3.eachLike({
          contratId: string(CONTRAT_ID),
          foyerId: string(FOYER_ID),
          semaineIso: string(SEMAINE),
          statut: string('A_VALIDER'),
          notifieeLe: string('2026-06-23T06:00:00.000Z'),
        }),
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/validations/a-valider?foyer=${FOYER_ID}`,
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { semaineIso: string }[];
      expect(corps[0]?.semaineIso).toBe(SEMAINE);
    });
  });

  it('valide une semaine (POST /api/validations/:contratId/:semaineIso)', async () => {
    provider
      .given(ETAT_SEMAINE_VALIDABLE)
      .uponReceiving('la validation d’une semaine A_VALIDER')
      .withRequest({
        method: 'POST',
        path: `/api/validations/${CONTRAT_ID}/${SEMAINE}`,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        // Provider sans svc-planification : relecture dégradée ⇒ snapshot inchangé
        // ⇒ statut VALIDEE, sans delta.
        body: {
          contratId: string(CONTRAT_ID),
          semaineIso: string(SEMAINE),
          statut: string('VALIDEE'),
          deltaModifs: null,
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/validations/${CONTRAT_ID}/${SEMAINE}`,
        { method: 'POST' },
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { statut: string };
      expect(corps.statut).toBe('VALIDEE');
    });
  });

  it('régénère le brouillon agrégé par établissement (GET …/etablissements/:etablissementId/brouillon)', async () => {
    provider
      .given(ETAT_BROUILLON)
      .uponReceiving('une régénération du brouillon agrégé par établissement')
      .withRequest({
        method: 'GET',
        path: `/api/validations/semaine/${FOYER_ID}/${SEMAINE}/etablissements/${ETABLISSEMENT_ID}/brouillon`,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          foyerId: string(FOYER_ID),
          semaineIso: string(SEMAINE),
          etablissementId: string(ETABLISSEMENT_ID),
          etablissementLibelle: string('Crèche Les Hirondelles'),
          destinataire: string('contact-creche@example.org'),
          sujet: string('Plannings modifiés — semaine 2026-W10'),
          corps: string('<p>Bonjour Crèche Les Hirondelles,</p>'),
          texte: string('Bonjour Crèche Les Hirondelles,'),
          // Au moins un enfant concerné (forme contrainte ; le détail du delta est
          // validé par les specs unitaires du template).
          enfants: MatchersV3.eachLike({
            contratId: string(CONTRAT_ID),
            enfant: string('Léa'),
            deltaModifs: {
              jours: MatchersV3.eachLike({ date: string('2026-03-04') }),
            },
          }),
          // Établissement joignable → routable, aucune raison de non-routabilité.
          routable: boolean(true),
          raisonNonRoutable: null,
          // Provider en dry-run par défaut (aucun SMTP réel pendant la vérif).
          dryRun: boolean(true),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/validations/semaine/${FOYER_ID}/${SEMAINE}/etablissements/${ETABLISSEMENT_ID}/brouillon`,
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { destinataire: string };
      expect(corps.destinataire).toBe('contact-creche@example.org');
    });
  });

  it('régénère un brouillon NON routable pour un établissement sans e-mail (routable=false)', async () => {
    provider
      .given(ETAT_BROUILLON_SANS_EMAIL)
      .uponReceiving(
        'une régénération du brouillon agrégé d’un établissement sans e-mail',
      )
      .withRequest({
        method: 'GET',
        path: `/api/validations/semaine/${FOYER_ID}/${SEMAINE}/etablissements/${ETABLISSEMENT_SANS_EMAIL_ID}/brouillon`,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          foyerId: string(FOYER_ID),
          semaineIso: string(SEMAINE),
          etablissementId: string(ETABLISSEMENT_SANS_EMAIL_ID),
          etablissementLibelle: string('Halte-garderie du Parc'),
          // Non routable : destinataire vide, jamais lu par le front dans ce cas.
          destinataire: '',
          sujet: string('Plannings modifiés — semaine 2026-W10'),
          corps: string('<p>Bonjour Halte-garderie du Parc,</p>'),
          texte: string('Bonjour Halte-garderie du Parc,'),
          // Le calcul des enfants ne dépend pas de l'e-mail : il y a bien des modifs.
          enfants: MatchersV3.eachLike({
            contratId: string('55555555-0000-4000-8000-000000000002'),
            enfant: string('Zoé'),
            deltaModifs: {
              jours: MatchersV3.eachLike({ date: string('2026-03-04') }),
            },
          }),
          routable: boolean(false),
          raisonNonRoutable: string('SANS_EMAIL'),
          // dryRun neutralisé (aucun envoi possible).
          dryRun: boolean(false),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/validations/semaine/${FOYER_ID}/${SEMAINE}/etablissements/${ETABLISSEMENT_SANS_EMAIL_ID}/brouillon`,
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as {
        routable: boolean;
        raisonNonRoutable: string | null;
        destinataire: string;
      };
      expect(corps.routable).toBe(false);
      expect(corps.raisonNonRoutable).toBe('SANS_EMAIL');
      expect(corps.destinataire).toBe('');
    });
  });

  it('régénère un brouillon NON routable pour un établissement archivé (raisonNonRoutable=ARCHIVE prioritaire)', async () => {
    provider
      .given(ETAT_BROUILLON_ARCHIVE)
      .uponReceiving(
        'une régénération du brouillon agrégé d’un établissement archivé',
      )
      .withRequest({
        method: 'GET',
        path: `/api/validations/semaine/${FOYER_ID}/${SEMAINE}/etablissements/${ETABLISSEMENT_ARCHIVE_ID}/brouillon`,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          foyerId: string(FOYER_ID),
          semaineIso: string(SEMAINE),
          etablissementId: string(ETABLISSEMENT_ARCHIVE_ID),
          etablissementLibelle: string('Crèche Les Coccinelles'),
          // Non routable (archivée) : destinataire vide, jamais lu par le front.
          destinataire: '',
          sujet: string('Plannings modifiés — semaine 2026-W10'),
          corps: string('<p>Bonjour Crèche Les Coccinelles,</p>'),
          texte: string('Bonjour Crèche Les Coccinelles,'),
          // Le calcul des enfants ne dépend ni de l'e-mail ni de l'état actif.
          enfants: MatchersV3.eachLike({
            contratId: string('55555555-0000-4000-8000-000000000003'),
            enfant: string('Nina'),
            deltaModifs: {
              jours: MatchersV3.eachLike({ date: string('2026-03-04') }),
            },
          }),
          routable: boolean(false),
          // Bien que la fiche ait un e-mail, l'archivage prime : raison ARCHIVE.
          raisonNonRoutable: string('ARCHIVE'),
          dryRun: boolean(false),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/validations/semaine/${FOYER_ID}/${SEMAINE}/etablissements/${ETABLISSEMENT_ARCHIVE_ID}/brouillon`,
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as {
        routable: boolean;
        raisonNonRoutable: string | null;
        destinataire: string;
      };
      expect(corps.routable).toBe(false);
      expect(corps.raisonNonRoutable).toBe('ARCHIVE');
      expect(corps.destinataire).toBe('');
    });
  });

  it('envoie le récap agrégé au service (POST /api/envois/etablissement)', async () => {
    provider
      .given(ETAT_ENVOI)
      .uponReceiving('un envoi du récap agrégé par établissement')
      .withRequest({
        method: 'POST',
        path: '/api/envois/etablissement',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          foyerId: FOYER_ID,
          semaineIso: SEMAINE,
          etablissementId: ETABLISSEMENT_ID,
        },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        // Provider en dry-run par défaut ⇒ statut DRY_RUN, aucun messageId.
        body: {
          foyerId: string(FOYER_ID),
          semaineIso: string(SEMAINE),
          etablissementId: string(ETABLISSEMENT_ID),
          destinataire: string('contact-creche@example.org'),
          statut: string('DRY_RUN'),
          messageId: null,
          erreur: null,
          envoyeLe: string('2026-03-09T08:00:00.000Z'),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/envois/etablissement`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            foyerId: FOYER_ID,
            semaineIso: SEMAINE,
            etablissementId: ETABLISSEMENT_ID,
          }),
        },
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { statut: string };
      expect(corps.statut).toBe('DRY_RUN');
    });
  });

  it('envoie le récap avec un objet + corps édités par le parent (POST /api/envois/etablissement)', async () => {
    provider
      .given(ETAT_ENVOI)
      .uponReceiving('un envoi du récap agrégé avec un corps édité')
      .withRequest({
        method: 'POST',
        path: '/api/envois/etablissement',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        // Objet + corps (texte brut) relus/édités par le parent avant l'envoi :
        // rétro-compatible avec l'interaction « 3 ids seuls » ci-dessus.
        body: {
          foyerId: FOYER_ID,
          semaineIso: SEMAINE,
          etablissementId: ETABLISSEMENT_ID,
          sujet: 'Planning de la semaine du 2 mars — Léa',
          corps:
            'Bonjour,\n\nVoici le planning complet de la semaine.\n\nMerci !',
        },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        // Réponse de forme identique (le corps édité ne change pas la forme du résultat).
        body: {
          foyerId: string(FOYER_ID),
          semaineIso: string(SEMAINE),
          etablissementId: string(ETABLISSEMENT_ID),
          destinataire: string('contact-creche@example.org'),
          statut: string('DRY_RUN'),
          messageId: null,
          erreur: null,
          envoyeLe: string('2026-03-09T08:00:00.000Z'),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/envois/etablissement`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            foyerId: FOYER_ID,
            semaineIso: SEMAINE,
            etablissementId: ETABLISSEMENT_ID,
            sujet: 'Planning de la semaine du 2 mars — Léa',
            corps:
              'Bonjour,\n\nVoici le planning complet de la semaine.\n\nMerci !',
          }),
        },
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { statut: string };
      expect(corps.statut).toBe('DRY_RUN');
    });
  });

  // --- Inbox in-app (cloche) : liste, accusé de lecture, isolation cross-parent ---

  it('liste l’inbox d’un parent (GET /api/moi/notifications?parent=…)', async () => {
    provider
      .given(ETAT_INBOX, { parentId: PARENT_INBOX_ID, id: NOTIF_INBOX_ID })
      .uponReceiving('une lecture du panneau in-app d’un parent')
      .withRequest({
        method: 'GET',
        path: '/api/moi/notifications',
        query: { parent: PARENT_INBOX_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          // Au moins une entrée récente, non lue (`luLe: null`). La forme d'une
          // `NotificationInAppVue` est figée ; le compteur est un entier.
          notifications: MatchersV3.eachLike({
            id: string(NOTIF_INBOX_ID),
            type: string('VALIDATION_HEBDO'),
            sujet: string('Planning de la semaine à valider'),
            corps: string(
              'Votre planning de la semaine est prêt à être validé.',
            ),
            lien: string(
              '/foyers/22222222-2222-4222-8222-222222222222/planning',
            ),
            creeLe: string('2026-06-23T06:00:00.000Z'),
            luLe: null,
          }),
          nonLus: integer(1),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/moi/notifications?parent=${PARENT_INBOX_ID}`,
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as {
        notifications: { luLe: string | null }[];
        nonLus: number;
      };
      expect(corps.notifications[0]?.luLe).toBeNull();
      expect(typeof corps.nonLus).toBe('number');
    });
  });

  it('marque une notification comme lue (POST …/:id/lu?parent=…) → 200 avec luLe', async () => {
    provider
      .given(ETAT_INBOX, { parentId: PARENT_INBOX_ID, id: NOTIF_INBOX_ID })
      .uponReceiving('un accusé de lecture d’une notification du parent')
      .withRequest({
        method: 'POST',
        path: `/api/moi/notifications/${NOTIF_INBOX_ID}/lu`,
        query: { parent: PARENT_INBOX_ID },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        // `luLe` désormais posé (chaîne ISO, matché en type) : prouve l'accusé.
        body: {
          id: string(NOTIF_INBOX_ID),
          type: string('VALIDATION_HEBDO'),
          sujet: string('Planning de la semaine à valider'),
          corps: string('Votre planning de la semaine est prêt à être validé.'),
          lien: string('/foyers/22222222-2222-4222-8222-222222222222/planning'),
          creeLe: string('2026-06-23T06:00:00.000Z'),
          luLe: string('2026-06-23T07:00:00.000Z'),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/moi/notifications/${NOTIF_INBOX_ID}/lu?parent=${PARENT_INBOX_ID}`,
        { method: 'POST' },
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { luLe: string | null };
      expect(corps.luLe).not.toBeNull();
    });
  });

  it('refuse (404) l’accusé de lecture d’un AUTRE parent (isolation cross-parent)', async () => {
    provider
      // La notif reste possédée par `PARENT_INBOX_ID` ; on la requête ici au nom
      // d'un AUTRE parent → 404 (même message, aucune fuite). C'est LE contrat de
      // sécurité : si le prédicat `parentId` de `inbox.service.ts` saute, le
      // provider répondrait 200 → la vérification provider échouerait.
      .given(ETAT_INBOX, { parentId: PARENT_INBOX_ID, id: NOTIF_INBOX_ID })
      .uponReceiving(
        'un accusé de lecture d’une notification d’un autre parent',
      )
      .withRequest({
        method: 'POST',
        path: `/api/moi/notifications/${NOTIF_INBOX_ID}/lu`,
        query: { parent: AUTRE_PARENT_ID },
      })
      .willRespondWith({
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          statusCode: integer(404),
          message: string('notification inconnue'),
          error: string('Not Found'),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/moi/notifications/${NOTIF_INBOX_ID}/lu?parent=${AUTRE_PARENT_ID}`,
        { method: 'POST' },
      );
      expect(reponse.status).toBe(404);
      const corps = (await reponse.json()) as { message: string };
      expect(corps.message).toBe('notification inconnue');
    });
  });
});
