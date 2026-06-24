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
});
