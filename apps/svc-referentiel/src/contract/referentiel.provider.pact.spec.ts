import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { Verifier } from '@pact-foundation/pact';
import postgres, { type Sql } from 'postgres';

/**
 * Vérification **provider** : `svc-referentiel` honore-t-il le contrat publié par
 * `api-gateway` (pact file) ? On démarre le bundle réel du service contre une base
 * Postgres, on rejoue les interactions du pact et on seede l'état attendu via
 * `stateHandlers`. **Bloquant en CI** ; ignoré localement si aucune base n'est
 * joignable (le développeur sans Docker n'est pas pénalisé).
 *
 * L'état `une grille ABCM T3 applicable en 2026 existe` est garanti par le
 * `stateHandler` (et redondamment par le seed de boot du service).
 */
const ETAT_GRILLE_T3 = 'une grille ABCM T3 applicable en 2026 existe';

// nx lance vitest avec cwd = racine du projet (apps/svc-referentiel) → racine du dépôt à ../../.
const RACINE = resolve(process.cwd(), '../..');
const BUNDLE = resolve(RACINE, 'apps/svc-referentiel/dist/main.js');
const PACT_FILE = resolve(RACINE, 'pacts/api-gateway-svc-referentiel.json');

// 3996 : chaque vérification provider écoute sur un port par défaut DISTINCT
// (3997 planification, 3998 tarification, 3999 foyer) — elles tournent en
// parallèle dès qu'un changement transverse (contracts-kernel, lockfile) les
// rend toutes affectées, et un port partagé fait s'entre-tuer les bundles
// (EADDRINUSE + vérification contre le mauvais service).
const PORT = Number(process.env['PACT_PROVIDER_PORT'] ?? 3996);
const DATABASE_URL =
  process.env['REFERENTIEL_DATABASE_URL'] ??
  'postgres://referentiel:referentiel@localhost:5433/referentiel';
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

/**
 * La readiness HTTP (`/api/health/live`) ne garantit NI que les migrations sont
 * terminées (la table `grille_abcm` peut ne pas encore exister), NI que le seed de
 * boot **fire-and-forget** (`SeedService` : `void this.amorcer()`) a écrit la grille
 * T3. On attend donc que la grille T3 soit **commitée** avant de lancer la
 * vérification : sinon le `stateHandler` (select-puis-insert) lève
 * `relation "grille_abcm" does not exist` ou court contre le seed concurrent →
 * « state handler failed » intermittent en CI (surtout sous forte charge, tous
 * projets affectés). On TOLÈRE l'absence de table pendant l'attente (migration en
 * cours) ; borné, et en dernier recours le `stateHandler` tentera la création.
 */
async function attendreGrilleT3(db: Sql, delaiMs = 30000): Promise<void> {
  const echeance = Date.now() + delaiMs;
  for (;;) {
    try {
      const lignes =
        await db`select 1 from grille_abcm where tranche = 3 limit 1`;
      if (lignes.length > 0) {
        return;
      }
    } catch {
      // Table pas encore migrée (`relation does not exist`) → on continue d'attendre.
    }
    if (Date.now() > echeance) {
      return;
    }
    await sleep(500);
  }
}

describe('Pact provider · svc-referentiel honore le contrat api-gateway', () => {
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
    // Anti-course : attendre que le seed de boot ait commité la grille T3 avant la
    // vérification (le stateHandler verra alors la ligne et n'insérera pas).
    await attendreGrilleT3(sql);
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
      provider: 'svc-referentiel',
      providerBaseUrl: `http://localhost:${PORT}`,
      pactUrls: [PACT_FILE],
      logLevel: 'warn',
      stateHandlers: {
        [ETAT_GRILLE_T3]: async (): Promise<void> => {
          // Grille cantine T3 2026 (doc 02 §4.1) si le seed de boot ne l'a pas créée.
          const existe = await db`
            select 1 from grille_abcm where tranche = 3 limit 1
          `;
          if (existe.length === 0) {
            await db`
              insert into grille_abcm (
                tranche, valide_du, valide_au,
                cantine_total_centimes, cantine_part_garde_centimes,
                peri_matin_centimes, peri_soir_centimes,
                alsh_journee_complete_centimes, alsh_demi_journee_centimes, alsh_repas_centimes
              ) values (3, '2026-01-01', null, 1268, 801, 333, 705, 2650, 950, 750)
            `;
          }
        },
      },
    }).verifyProvider();
  });
});
