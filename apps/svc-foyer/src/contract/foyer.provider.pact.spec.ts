import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { Verifier } from '@pact-foundation/pact';
import postgres, { type Sql } from 'postgres';

/**
 * Vérification **provider** : `svc-foyer` honore-t-il le contrat publié par
 * `api-gateway` (pact file) ? On démarre le bundle réel du service contre une base
 * Postgres, on rejoue les interactions du pact et on seede l'état attendu via
 * `stateHandlers`. **Bloquant en CI** ; ignoré localement si aucune base n'est
 * joignable (le développeur sans Docker n'est pas pénalisé).
 *
 * L'état `un foyer de référence T3 existe` est seedé via `stateHandlers` avec l'`id`
 * fourni par le pact (aligné sur le contrat consommateur).
 */
const ETAT_FOYER_T3 = 'un foyer de référence T3 existe';

// nx lance vitest avec cwd = racine du projet (apps/svc-foyer) → racine du dépôt à ../../.
const RACINE = resolve(process.cwd(), '../..');
const BUNDLE = resolve(RACINE, 'apps/svc-foyer/dist/main.js');
const PACT_FILE = resolve(RACINE, 'pacts/api-gateway-svc-foyer.json');

const PORT = Number(process.env['PACT_PROVIDER_PORT'] ?? 3999);
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://foyer:foyer@localhost:5434/foyer';
const EN_CI = Boolean(process.env['CI']);

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

describe('Pact provider · svc-foyer honore le contrat api-gateway', () => {
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
        OTEL_SDK_DISABLED: 'true',
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
      provider: 'svc-foyer',
      providerBaseUrl: `http://localhost:${PORT}`,
      pactUrls: [PACT_FILE],
      logLevel: 'warn',
      stateHandlers: {
        [ETAT_FOYER_T3]: async (params?: unknown): Promise<void> => {
          const id = String((params as { id: string }).id);
          // Foyer de référence (doc 02 §0) : RFR 72 705 € → T3.
          await db`
            insert into foyer (id, ressources_mensuelles_centimes, rfr_centimes, nb_enfants_a_charge, nb_parts)
            values (${id}, 671692, 7270500, 2, 3)
            on conflict (id) do update set
              ressources_mensuelles_centimes = excluded.ressources_mensuelles_centimes,
              rfr_centimes = excluded.rfr_centimes,
              nb_enfants_a_charge = excluded.nb_enfants_a_charge,
              nb_parts = excluded.nb_parts
          `;
        },
      },
    }).verifyProvider();
  });
});
