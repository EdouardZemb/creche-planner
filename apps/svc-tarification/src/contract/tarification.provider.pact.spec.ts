import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { Verifier } from '@pact-foundation/pact';
import { signerAssertion } from '@creche-planner/nest-commons';
import postgres, { type Sql } from 'postgres';

/**
 * Vérification **provider** : `svc-tarification` honore-t-il le contrat publié par
 * `api-gateway` (pact file) ? On démarre le bundle réel du service contre une base
 * Postgres, on rejoue les interactions du pact et on seede l'état attendu via
 * `stateHandlers`. **Bloquant en CI** ; ignoré localement si aucune base n'est
 * joignable (le développeur sans Docker n'est pas pénalisé).
 *
 * L'état « un foyer avec des prestations cantine en octobre 2026 existe » est
 * garanti par le `stateHandler` : on seede directement le **read model**
 * (`foyer`/`contrat`/`prestation_mois`) que les consommateurs JetStream auraient
 * écrit. Les services amont (Foyer/Planification/Référentiel) ne sont donc pas
 * requis ; leurs clients de repli dégradent proprement s'ils sont injoignables.
 */
const ETAT_FOYER_COUT =
  'un foyer avec des prestations cantine en octobre 2026 existe';

/**
 * SFD 40 — suivi des unités associatives. Le seed ne pose que des sessions
 * **RÉALISÉES** : « réservé » et « à confirmer » se trient par rapport au jour
 * courant, et les figer rendrait le contrat faux au premier changement de date.
 */
const ETAT_FOYER_UA =
  'un foyer avec un engagement d’unités associatives 2026/27 existe';

const ENGAGEMENT_UA_ID = '99999999-9999-4999-8999-999999999999';
const SESSION_UA_1 = '88888888-8888-4888-8888-888888888888';
const SESSION_UA_2 = '88888888-8888-4888-8888-888888888889';

/** Identifiants figés (alignés avec le pact consumer). */
const FOYER_ID = '22222222-2222-2222-2222-222222222222';
const CONTRAT_ID = '33333333-3333-3333-3333-333333333333';
const GRILLE_ID = '55555555-5555-5555-5555-555555555555';
const VERSION_ID = '66666666-6666-6666-6666-666666666666';

// nx lance vitest avec cwd = racine du projet (apps/svc-tarification) → racine du dépôt à ../../.
const RACINE = resolve(process.cwd(), '../..');
const BUNDLE = resolve(RACINE, 'apps/svc-tarification/dist/main.js');
const PACT_FILE = resolve(RACINE, 'pacts/api-gateway-svc-tarification.json');

// Port par défaut DISTINCT par vérification provider (3996 referentiel,
// 3997 planification, 3999 foyer) : elles tournent en parallèle dès qu'un
// changement transverse les rend toutes affectées.
const PORT = Number(process.env['PACT_PROVIDER_PORT'] ?? 3998);
const DATABASE_URL =
  process.env['TARIFICATION_DATABASE_URL'] ??
  'postgres://tarification:tarification@localhost:5436/tarification';
const EN_CI = Boolean(process.env['CI']);

/** Prestation cantine projetée (16 jours réservés, CT-10). */
const PRESTATION_CANTINE = { mode: 'CANTINE', nbJours: 16 };

async function baseJoignable(): Promise<boolean> {
  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => undefined });
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function attendreReadiness(url: string, delaiMs = 40000): Promise<void> {
  const echeance = Date.now() + delaiMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return;
      }
    } catch {
      // service pas encore à l'écoute
    }
    if (Date.now() > echeance) {
      throw new Error(`provider non prêt après ${delaiMs} ms (${url})`);
    }
    await sleep(500);
  }
}

describe('Pact provider · svc-tarification honore le contrat api-gateway', () => {
  let provider: ChildProcess | undefined;
  let sql: Sql | undefined;
  let baseOk = false;

  beforeAll(async () => {
    baseOk = await baseJoignable();
    if (!baseOk) {
      if (EN_CI) {
        throw new Error(
          `Postgres injoignable (${DATABASE_URL}) — requis pour la vérification Pact en CI`,
        );
      }
      return; // local sans base : on saute la vérification
    }

    sql = postgres(DATABASE_URL, { max: 1, onnotice: () => undefined });
    provider = spawn(process.execPath, [BUNDLE], {
      env: {
        ...process.env,
        PORT: String(PORT),
        DATABASE_URL,
        NATS_URL: process.env['NATS_URL'] ?? 'nats://localhost:4222',
        // Services amont injoignables pendant la vérif → clients de repli dégradés.
        FOYER_URL: 'http://localhost:65535',
        PLANIFICATION_URL: 'http://localhost:65535',
        REFERENTIEL_URL: 'http://localhost:65535',
        OTEL_SDK_DISABLED: 'true',
        // Secret d'assertion inter-services ÉPINGLÉ (fondations lot 3) : byte-identique
        // à celui dont le requestFilter signe l'en-tête x-assertion-identite ci-dessous.
        ASSERTION_IDENTITE_SECRET: 'pact-assertion-secret',
        // ENFORCE réel (fondations lot 4) : la CI prouve que le guard enforce ne casse
        // pas les interactions du pact. L'assertion machine du requestFilter passe la
        // vérification d'identité ET bypasse le scoping par ressource → aucune 401/403.
        INTERSERVICE_AUTHZ_ENFORCE: '1',
      },
      stdio: 'inherit',
    });
    await attendreReadiness(`http://localhost:${PORT}/api/health/live`);
  });

  afterAll(async () => {
    provider?.kill('SIGTERM');
    await sql?.end({ timeout: 5 });
  });

  it('vérifie les interactions du pact', async (ctx) => {
    const db = sql;
    if (!baseOk || !db) {
      ctx.skip();
      return;
    }
    await new Verifier({
      provider: 'svc-tarification',
      providerBaseUrl: `http://localhost:${PORT}`,
      pactUrls: [PACT_FILE],
      logLevel: 'warn',
      // Chaque requête du pact reçoit une assertion machine signée (fondations lot 3) :
      // en observe rien ne refuse ; au lot 4 (enforce) l'assertion machine bypasse le
      // scoping. Les en-têtes ne sont pas déclarés côté pact → pacts/*.json inchangés.
      requestFilter: (req, _res, next) => {
        req.headers['x-assertion-identite'] = signerAssertion(
          { machine: 'api-gateway' },
          'pact-assertion-secret',
        );
        next();
      },
      stateHandlers: {
        [ETAT_FOYER_COUT]: async (): Promise<void> => {
          // Read model seedé tel que les consommateurs JetStream l'auraient écrit :
          // foyer de référence (T3, doc 02 §0), un contrat cantine, sa prestation d'octobre,
          // et la grille cantine T3 (montants v2) — sans laquelle le calcul répond 503
          // (SFD 30, D1 : la projection est désormais la source du tarif).
          await db`delete from prestation_mois where foyer_id = ${FOYER_ID}`;
          await db`delete from contrat where foyer_id = ${FOYER_ID}`;
          await db`delete from foyer_version where foyer_id = ${FOYER_ID}`;
          await db`delete from foyer where id = ${FOYER_ID}`;
          await db`delete from grille_tarifaire where grille_id = ${GRILLE_ID}`;
          await db`
            insert into foyer (
              id, ressources_mensuelles_centimes, rfr_centimes, tranche,
              nb_parts, nb_enfants_a_charge
            ) values (
              ${FOYER_ID}, 671692, 7270500, 3, 2, 2
            )
          `;
          // Version de ressources COUVRANT le mois de l'interaction (`AM-55`) :
          // le calcul refuse désormais un mois qu'aucune version ne couvre. Sans
          // cette ligne, la vérification passait **par accident** — la ligne
          // « courante » vaut pour le mois courant et les suivants, or octobre
          // 2026 était encore à venir au moment d'écrire ce lot. Le même pact
          // aurait viré au rouge un 1er novembre 2026, sans qu'aucun commit
          // n'ait bougé.
          await db`
            insert into foyer_version (
              id, foyer_id, date_effet, date_fin,
              ressources_mensuelles_centimes, rfr_centimes, tranche,
              nb_parts, nb_enfants_a_charge
            ) values (
              ${VERSION_ID}, ${FOYER_ID}, '2026-01-01', null,
              671692, 7270500, 3, 2, 2
            )
          `;
          await db`
            insert into grille_tarifaire (
              grille_id, mode, tranche, valide_du, valide_au, parametres
            ) values (
              ${GRILLE_ID}, 'CANTINE', 3, '2026-01-01', null,
              ${JSON.stringify({
                cantineTotalCentimes: 1268,
                cantinePartGardeCentimes: 801,
              })}::jsonb
            )
          `;
          await db`
            insert into contrat (id, foyer_id, enfant, mode)
            values (${CONTRAT_ID}, ${FOYER_ID}, 'Zoé', 'CANTINE')
          `;
          await db`
            insert into prestation_mois (
              contrat_id, foyer_id, enfant, mode, mois, simule, prestations
            ) values (
              ${CONTRAT_ID}, ${FOYER_ID}, 'Zoé', 'CANTINE', '2026-10', false,
              ${JSON.stringify(PRESTATION_CANTINE)}::jsonb
            )
          `;
        },
        [ETAT_FOYER_UA]: async (): Promise<void> => {
          // Engagement de référence de la doc 02 §4.5 (20 UA à 31,25 €, caution
          // 625 €, 1er juin → 31 mai) et deux créneaux DÉJÀ RÉALISÉS : 4 h + 2 h.
          // Ni foyer ni contrat requis — ces deux tables ne sont pas un read model
          // et ne référencent rien.
          await db`delete from session_ua where foyer_id = ${FOYER_ID}`;
          await db`delete from engagement_ua where foyer_id = ${FOYER_ID}`;
          await db`
            insert into engagement_ua (
              id, foyer_id, debut, fin, quota_heures, valeur_ua_centimes,
              caution_centimes
            ) values (
              ${ENGAGEMENT_UA_ID}, ${FOYER_ID}, '2026-06-01', '2027-05-31',
              20, 3125, 62500
            )
          `;
          await db`
            insert into session_ua (
              id, engagement_id, foyer_id, date, duree_heures, type,
              realise_par, etat
            ) values (
              ${SESSION_UA_1}, ${ENGAGEMENT_UA_ID}, ${FOYER_ID}, '2026-09-12',
              4, 'MENAGE', 'Camille', 'REALISEE'
            ), (
              ${SESSION_UA_2}, ${ENGAGEMENT_UA_ID}, ${FOYER_ID}, '2026-09-20',
              2, 'CANTINE', 'Camille', 'REALISEE'
            )
          `;
        },
      },
    }).verifyProvider();
  });
});
