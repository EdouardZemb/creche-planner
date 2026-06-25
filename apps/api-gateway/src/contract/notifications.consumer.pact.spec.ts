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
const ETAT_ETABLISSEMENTS = 'des établissements destinataires existent';
const ETAT_ETABLISSEMENT_EDITABLE = 'un établissement crèche modifiable existe';
const ETAT_SEMAINE_A_VALIDER = 'une semaine est à valider pour un foyer';
const ETAT_SEMAINE_VALIDABLE = 'une semaine A_VALIDER existe pour validation';
const ETAT_BROUILLON =
  'un brouillon de mail agrégé par établissement est disponible';
const ETAT_ENVOI =
  'un récap agrégé par établissement est prêt à envoyer au service';

/** Identifiants figés partagés avec les stateHandlers de la vérification provider. */
const FOYER_ID = '22222222-2222-4222-8222-222222222222';
const CONTRAT_ID = '55555555-0000-4000-8000-000000000000';
// Établissement destinataire du récap agrégé (mode crèche → CRECHE_HIRONDELLES).
const CLE = 'CRECHE_HIRONDELLES';
// Semaine entièrement dans un mois (mars) : une seule relecture amont côté provider.
const SEMAINE = '2026-W10';

// nx lance vitest avec cwd = racine du projet (apps/api-gateway) → racine du dépôt à ../../.
const PACTS_DIR = resolve(process.cwd(), '../../pacts');

const { string, boolean, integer } = MatchersV3;

const provider = new PactV3({
  consumer: 'api-gateway',
  provider: 'svc-notifications',
  dir: PACTS_DIR,
});

describe('Pact consumer · api-gateway → svc-notifications', () => {
  it('liste les établissements destinataires (GET /api/etablissements)', async () => {
    provider
      .given(ETAT_ETABLISSEMENTS)
      .uponReceiving('une lecture de la liste des établissements')
      .withRequest({ method: 'GET', path: '/api/etablissements' })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        // `eachLike` impose le MÊME template à chaque élément ; or la liste mêle
        // deux variantes de `preavisRegle` (crèche = JOURS_OUVRES, ABCM =
        // JOUR_HEURE). On ne contraint donc que le champ discriminant commun
        // `type` (présent dans les deux variantes) — la forme complète est
        // validée par le schéma Zod du client et par les specs dto.
        body: MatchersV3.eachLike({
          cle: string('CRECHE_HIRONDELLES'),
          libelle: string('Crèche Les Hirondelles'),
          emailService: string('contact-creche@example.org'),
          preavisRegle: { type: string('JOURS_OUVRES') },
          actif: boolean(true),
        }),
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(`${mockServer.url}/api/etablissements`);
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { cle: string }[];
      expect(Array.isArray(corps)).toBe(true);
      expect(corps[0]?.cle).toBe('CRECHE_HIRONDELLES');
    });
  });

  it('upsert un établissement par clé (PUT /api/etablissements/:cle)', async () => {
    provider
      .given(ETAT_ETABLISSEMENT_EDITABLE)
      .uponReceiving('une mise à jour de l’établissement crèche')
      .withRequest({
        method: 'PUT',
        path: '/api/etablissements/CRECHE_HIRONDELLES',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          emailService: 'nouvelle@example.org',
          preavisRegle: { type: 'JOURS_OUVRES', valeur: 3 },
        },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          cle: string('CRECHE_HIRONDELLES'),
          libelle: string('Crèche Les Hirondelles'),
          emailService: string('nouvelle@example.org'),
          preavisRegle: {
            type: string('JOURS_OUVRES'),
            valeur: integer(3),
          },
          actif: boolean(true),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/etablissements/CRECHE_HIRONDELLES`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            emailService: 'nouvelle@example.org',
            preavisRegle: { type: 'JOURS_OUVRES', valeur: 3 },
          }),
        },
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { emailService: string };
      expect(corps.emailService).toBe('nouvelle@example.org');
    });
  });

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

  it('régénère le brouillon agrégé par établissement (GET …/etablissements/:cle/brouillon)', async () => {
    provider
      .given(ETAT_BROUILLON)
      .uponReceiving('une régénération du brouillon agrégé par établissement')
      .withRequest({
        method: 'GET',
        path: `/api/validations/semaine/${FOYER_ID}/${SEMAINE}/etablissements/${CLE}/brouillon`,
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          foyerId: string(FOYER_ID),
          semaineIso: string(SEMAINE),
          etablissementCle: string(CLE),
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
          // Provider en dry-run par défaut (aucun SMTP réel pendant la vérif).
          dryRun: boolean(true),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const reponse = await fetch(
        `${mockServer.url}/api/validations/semaine/${FOYER_ID}/${SEMAINE}/etablissements/${CLE}/brouillon`,
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { destinataire: string };
      expect(corps.destinataire).toBe('contact-creche@example.org');
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
        body: { foyerId: FOYER_ID, semaineIso: SEMAINE, cle: CLE },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        // Provider en dry-run par défaut ⇒ statut DRY_RUN, aucun messageId.
        body: {
          foyerId: string(FOYER_ID),
          semaineIso: string(SEMAINE),
          etablissementCle: string(CLE),
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
            cle: CLE,
          }),
        },
      );
      expect(reponse.status).toBe(200);
      const corps = (await reponse.json()) as { statut: string };
      expect(corps.statut).toBe('DRY_RUN');
    });
  });
});
