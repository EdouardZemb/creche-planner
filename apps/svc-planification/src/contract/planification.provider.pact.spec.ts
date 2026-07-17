import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { Verifier } from '@pact-foundation/pact';
import { signerAssertion } from '@creche-planner/nest-commons';
import postgres, { type Sql } from 'postgres';

/**
 * Vérification **provider** : `svc-planification` honore-t-il le contrat publié par
 * `api-gateway` (pact file) ? On démarre le bundle réel du service contre une base
 * Postgres, on rejoue les interactions du pact et on seede l'état attendu via
 * `stateHandlers`. **Bloquant en CI** ; ignoré localement si aucune base n'est
 * joignable (le développeur sans Docker n'est pas pénalisé).
 *
 * L'état « un contrat crèche de Mia avec un planning de mars 2026 existe » est
 * garanti par le `stateHandler`. Le Référentiel n'est pas requis : son client
 * dégrade proprement (aucun jour exclu) s'il est injoignable.
 */
const ETAT_CONTRAT_CRECHE =
  'un contrat crèche de Mia avec un planning de mars 2026 existe';

/** État pour l'édition/suppression (aligné avec le pact consumer). */
const ETAT_CONTRAT_EXISTE = 'un contrat de garde modifiable existe';

/** État pour la liste des contrats d'un foyer (aligné avec le pact consumer). */
const ETAT_FOYER_AVEC_CONTRATS =
  'un foyer avec au moins un contrat de garde existe';

/** État relecture : un contrat avec une saisie de planning de mars 2026 (aligné consumer). */
const ETAT_PLANNING_SAISI =
  'un contrat crèche avec une saisie de planning de mars 2026 existe';

/**
 * États de purge des établissements créés « à la volée » par les interactions de
 * création/modification (alignés consumer) : `nouvelEtablissement` insère toujours
 * (unicité (foyer, nom)) — sans purge, rejouer la vérification sur une base
 * persistante (local) casse en doublon. En CI (base fraîche), purge = no-op.
 */
const ETAT_SANS_ETAB_CANTINE =
  'aucun établissement « Crèche Pact CANTINE » n existe';
const ETAT_SANS_ETAB_ALSH = 'aucun établissement « Centre Pact ALSH » n existe';
const ETAT_SANS_ETAB_MODIF =
  'aucun établissement « Crèche Pact Modif » n existe';

/** Identifiant figé du contrat (aligné avec le pact consumer). */
const CONTRAT_ID = '11111111-1111-1111-1111-111111111111';

/** Foyer figé dont on liste les contrats (aligné avec le pact consumer). */
const FOYER_LISTE_ID = '22222222-2222-2222-2222-222222222222';

/** Foyer commun des contrats seedés (tous dans le même foyer). */
const FOYER_SEED = '22222222-2222-2222-2222-222222222222';

/**
 * Établissement seedé : depuis P5 (`contrat.etablissement_id` NOT NULL), tout
 * contrat doit référencer un établissement existant (FK). On en sème un, fixe, que
 * les inserts de contrat ci-dessous rattachent.
 */
const ETAB_SEED_ID = '99999999-9999-9999-9999-999999999999';

/**
 * Enfant figé rattaché aux contrats seedés (aligné avec le pact consumer).
 * UUID RFC (v4) : la valeur repasse dans les corps de requête côté consumer, où
 * `z.string().uuid()` (Zod 4) exige version 1-8 ET variant 8-b.
 */
const ENFANT_SEED_ID = '77777777-7777-4777-8777-777777777777';

// nx lance vitest avec cwd = racine du projet (apps/svc-planification) → racine du dépôt à ../../.
const RACINE = resolve(process.cwd(), '../..');
const BUNDLE = resolve(RACINE, 'apps/svc-planification/dist/main.js');
const PACT_FILE = resolve(RACINE, 'pacts/api-gateway-svc-planification.json');

const PORT = Number(process.env['PACT_PROVIDER_PORT'] ?? 3997);
const DATABASE_URL =
  process.env['PLANIFICATION_DATABASE_URL'] ??
  'postgres://planification:planification@localhost:5435/planification';
const EN_CI = Boolean(process.env['CI']);

/** Semaine type crèche de Mia (doc 02 §7), en minutes depuis minuit. */
const SEMAINE_MIA = {
  LUNDI: [{ debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 }],
  MERCREDI: [
    { debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 },
  ],
  VENDREDI: [
    { debutHeures: 8, debutMinutes: 30, finHeures: 17, finMinutes: 0 },
  ],
};

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

/**
 * Sème l'établissement de référence (idempotent) que les contrats seedés
 * rattachent (FK `contrat.etablissement_id`, NOT NULL depuis P5).
 */
async function seedEtablissement(db: Sql): Promise<void> {
  await db`
    insert into etablissement (id, foyer_id, nom)
    values (${ETAB_SEED_ID}, ${FOYER_SEED}, 'Établissement Pact (seed)')
    on conflict (id) do nothing
  `;
}

/**
 * Purge un établissement créé « à la volée » par une interaction précédente
 * (et les contrats/plannings qui s'y rattachent), pour rendre la vérification
 * rejouable sur une base persistante.
 */
async function purgerEtablissementParNom(db: Sql, nom: string): Promise<void> {
  await db`
    delete from planning_mois where contrat_id in (
      select c.id from contrat c
      join etablissement e on c.etablissement_id = e.id
      where e.nom = ${nom}
    )
  `;
  await db`
    delete from contrat where etablissement_id in (
      select id from etablissement where nom = ${nom}
    )
  `;
  await db`delete from etablissement where nom = ${nom}`;
}

describe('Pact provider · svc-planification honore le contrat api-gateway', () => {
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
        // Référentiel injoignable pendant la vérif → client dégradé (aucun jour exclu).
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
      provider: 'svc-planification',
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
        [ETAT_SANS_ETAB_CANTINE]: async (): Promise<void> => {
          await purgerEtablissementParNom(db, 'Crèche Pact CANTINE');
        },
        [ETAT_SANS_ETAB_ALSH]: async (): Promise<void> => {
          await purgerEtablissementParNom(db, 'Centre Pact ALSH');
        },
        [ETAT_SANS_ETAB_MODIF]: async (): Promise<void> => {
          await purgerEtablissementParNom(db, 'Crèche Pact Modif');
        },
        [ETAT_CONTRAT_CRECHE]: async (): Promise<void> => {
          // Contrat crèche PSU de Mia (doc 02 §7) : 763 h / 7 mensualités.
          await db`delete from planning_mois where contrat_id = ${CONTRAT_ID}`;
          await db`delete from contrat where id = ${CONTRAT_ID}`;
          await seedEtablissement(db);
          await db`
            insert into contrat (
              id, foyer_id, etablissement_id, enfant, enfant_id, mode, valide_du, valide_au,
              heures_annuelles_contractualisees, nb_mensualites, semaine_type
            ) values (
              ${CONTRAT_ID}, '22222222-2222-2222-2222-222222222222', ${ETAB_SEED_ID}, 'Mia', ${ENFANT_SEED_ID},
              'CRECHE_PSU', '2026-01-01', '2026-07-31',
              763, 7, ${JSON.stringify(SEMAINE_MIA)}::jsonb
            )
          `;
          await db`
            insert into planning_mois (contrat_id, mois, simule, saisie)
            values (${CONTRAT_ID}, '2026-03', false, '{}'::jsonb)
          `;
        },
        [ETAT_CONTRAT_EXISTE]: async (): Promise<void> => {
          // Un contrat crèche existant, éditable/supprimable (mêmes id/foyer).
          await db`delete from planning_mois where contrat_id = ${CONTRAT_ID}`;
          await db`delete from contrat where id = ${CONTRAT_ID}`;
          await seedEtablissement(db);
          await db`
            insert into contrat (
              id, foyer_id, etablissement_id, enfant, enfant_id, mode, valide_du, valide_au,
              heures_annuelles_contractualisees, nb_mensualites, semaine_type
            ) values (
              ${CONTRAT_ID}, '22222222-2222-2222-2222-222222222222', ${ETAB_SEED_ID}, 'Mia', ${ENFANT_SEED_ID},
              'CRECHE_PSU', '2026-01-01', '2026-07-31',
              763, 7, ${JSON.stringify(SEMAINE_MIA)}::jsonb
            )
          `;
        },
        [ETAT_FOYER_AVEC_CONTRATS]: async (): Promise<void> => {
          // Le foyer porte au moins un contrat crèche → `GET /api/contrats?foyer=`
          // renvoie un tableau non vide.
          await db`delete from planning_mois where contrat_id = ${CONTRAT_ID}`;
          await db`delete from contrat where foyer_id = ${FOYER_LISTE_ID}`;
          await seedEtablissement(db);
          await db`
            insert into contrat (
              id, foyer_id, etablissement_id, enfant, enfant_id, mode, valide_du, valide_au,
              heures_annuelles_contractualisees, nb_mensualites, semaine_type
            ) values (
              ${CONTRAT_ID}, ${FOYER_LISTE_ID}, ${ETAB_SEED_ID}, 'Mia', ${ENFANT_SEED_ID},
              'CRECHE_PSU', '2026-01-01', '2026-07-31',
              763, 7, ${JSON.stringify(SEMAINE_MIA)}::jsonb
            )
          `;
        },
        [ETAT_PLANNING_SAISI]: async (): Promise<void> => {
          // Contrat crèche + une saisie de planning enregistrée pour mars 2026 →
          // `GET .../plannings/2026-03` renvoie `{ saisie: <la saisie stockée> }`.
          // La saisie reflète exactement ce qu'attend le pact consumer.
          await db`delete from planning_mois where contrat_id = ${CONTRAT_ID}`;
          await db`delete from contrat where id = ${CONTRAT_ID}`;
          await seedEtablissement(db);
          await db`
            insert into contrat (
              id, foyer_id, etablissement_id, enfant, enfant_id, mode, valide_du, valide_au,
              heures_annuelles_contractualisees, nb_mensualites, semaine_type
            ) values (
              ${CONTRAT_ID}, '22222222-2222-2222-2222-222222222222', ${ETAB_SEED_ID}, 'Mia', ${ENFANT_SEED_ID},
              'CRECHE_PSU', '2026-01-01', '2026-07-31',
              763, 7, ${JSON.stringify(SEMAINE_MIA)}::jsonb
            )
          `;
          await db`
            insert into planning_mois (contrat_id, mois, simule, saisie)
            values (
              ${CONTRAT_ID}, '2026-03', false,
              ${JSON.stringify({
                complementMinutes: 60,
                joursSupplementaires: [
                  {
                    date: '2026-03-18',
                    debutHeures: 9,
                    debutMinutes: 0,
                    finHeures: 12,
                    finMinutes: 0,
                  },
                ],
              })}::jsonb
            )
          `;
        },
      },
    }).verifyProvider();
  });
});
