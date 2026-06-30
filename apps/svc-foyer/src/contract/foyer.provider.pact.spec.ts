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
// Parents (PR2) : états dédiés. « sans parent » seede le foyer et purge ses
// parents (+ l'e-mail visé) pour qu'un ajout réussisse ; « avec un parent »
// seede en plus un parent actif d'id connu pour lecture/édition/retrait. Les
// purges rendent les states **idempotents** (ré-exécution locale sans clash sur
// l'unicité globale `lower(email)`).
const ETAT_FOYER_SANS_PARENT = 'un foyer de référence T3 sans parent';
const ETAT_FOYER_AVEC_PARENT = 'un foyer de référence T3 avec un parent';
// Enfant (P4) : seede le foyer puis (table rase) un enfant actif d'id connu pour
// l'édition/le retrait. Idempotent (ré-exécution locale sans clash sur l'id).
const ETAT_FOYER_AVEC_ENFANT = 'un foyer de référence T3 avec un enfant';

// nx lance vitest avec cwd = racine du projet (apps/svc-foyer) → racine du dépôt à ../../.
const RACINE = resolve(process.cwd(), '../..');
const BUNDLE = resolve(RACINE, 'apps/svc-foyer/dist/main.js');
const PACT_FILE = resolve(RACINE, 'pacts/api-gateway-svc-foyer.json');

const PORT = Number(process.env['PACT_PROVIDER_PORT'] ?? 3999);
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://foyer:foyer@localhost:5434/foyer';
const EN_CI = Boolean(process.env['CI']);

/** Seede (idempotent) le foyer de référence (doc 02 §0) : RFR 72 705 € → T3. */
async function seedFoyer(db: Sql, id: string): Promise<void> {
  await db`
    insert into foyer (id, ressources_mensuelles_centimes, rfr_centimes, nb_enfants_a_charge, nb_parts)
    values (${id}, 671692, 7270500, 2, 3)
    on conflict (id) do update set
      ressources_mensuelles_centimes = excluded.ressources_mensuelles_centimes,
      rfr_centimes = excluded.rfr_centimes,
      nb_enfants_a_charge = excluded.nb_enfants_a_charge,
      nb_parts = excluded.nb_parts
  `;
}

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
          const { id } = params as { id: string };
          await seedFoyer(db, id);
        },
        [ETAT_FOYER_SANS_PARENT]: async (params?: unknown): Promise<void> => {
          const { foyerId, email } = params as {
            foyerId: string;
            email: string;
          };
          await seedFoyer(db, foyerId);
          // Table rase : aucun parent dans ce foyer, et l'e-mail visé est libre
          // (unicité globale) → l'ajout du pact réussit (201, pas 409).
          await db`delete from parent where foyer_id = ${foyerId}`;
          await db`delete from parent where lower(email) = lower(${email})`;
        },
        [ETAT_FOYER_AVEC_PARENT]: async (params?: unknown): Promise<void> => {
          const { foyerId, parentId, email } = params as {
            foyerId: string;
            parentId: string;
            email: string;
          };
          await seedFoyer(db, foyerId);
          await db`delete from parent where foyer_id = ${foyerId}`;
          await db`delete from parent where lower(email) = lower(${email})`;
          await db`
            insert into parent (id, foyer_id, prenom, nom, email, principal, ordre, actif)
            values (${parentId}, ${foyerId}, 'Alex', 'Dupont', ${email}, false, 0, true)
          `;
        },
        [ETAT_FOYER_AVEC_ENFANT]: async (params?: unknown): Promise<void> => {
          const { foyerId, enfantId } = params as {
            foyerId: string;
            enfantId: string;
          };
          await seedFoyer(db, foyerId);
          // Table rase de l'enfant visé puis (ré)insertion (idempotent).
          await db`delete from enfant where id = ${enfantId}`;
          await db`
            insert into enfant (id, foyer_id, prenom, date_naissance)
            values (${enfantId}, ${foyerId}, 'Mia', '2024-12-08')
          `;
        },
      },
    }).verifyProvider();
  });
});
