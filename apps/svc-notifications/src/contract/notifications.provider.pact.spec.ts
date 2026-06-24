import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { Verifier } from '@pact-foundation/pact';
import postgres, { type Sql } from 'postgres';

/**
 * Vérification **provider** : `svc-notifications` honore-t-il le contrat publié par
 * `api-gateway` (pact file) pour l'annuaire des établissements ? On démarre le
 * bundle réel du service contre une base Postgres, on rejoue les interactions du
 * pact et on seede l'état attendu via `stateHandlers`. **Bloquant en CI** ; ignoré
 * localement si aucune base n'est joignable (le développeur sans Docker n'est pas
 * pénalisé).
 */
const ETAT_ETABLISSEMENTS = 'des établissements destinataires existent';
const ETAT_ETABLISSEMENT_EDITABLE = 'un établissement crèche modifiable existe';

/** Id figé de la ligne crèche seedée par le stateHandler. */
const CRECHE_ID = '99999999-9999-4999-8999-999999999999';

// nx lance vitest avec cwd = racine du projet (apps/svc-notifications) → racine du dépôt à ../../.
const RACINE = resolve(process.cwd(), '../..');
const BUNDLE = resolve(RACINE, 'apps/svc-notifications/dist/main.js');
const PACT_FILE = resolve(RACINE, 'pacts/api-gateway-svc-notifications.json');

const PORT = Number(process.env['PACT_PROVIDER_PORT'] ?? 3998);
const DATABASE_URL =
  process.env['NOTIFICATIONS_DATABASE_URL'] ??
  'postgres://notifications:notifications@localhost:5437/notifications';
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

describe('Pact provider · svc-notifications honore le contrat api-gateway', () => {
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
        // NATS injoignable pendant la vérif → le consumer JetStream dégrade ;
        // l'annuaire des établissements ne dépend pas du stream.
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
    // Upsert idempotent de l'établissement crèche (les deux états en ont besoin).
    const seedCreche = async (): Promise<void> => {
      await db`
        insert into etablissement_destinataire (
          id, cle, libelle, email_service, preavis_regle, actif
        ) values (
          ${CRECHE_ID}, 'CRECHE_HIRONDELLES', 'Crèche Les Hirondelles',
          'contact-creche@example.org',
          ${JSON.stringify({ type: 'JOURS_OUVRES', valeur: 2 })}::jsonb, true
        )
        on conflict (cle) do update set
          email_service = excluded.email_service,
          preavis_regle = excluded.preavis_regle,
          actif = excluded.actif
      `;
    };
    await new Verifier({
      provider: 'svc-notifications',
      providerBaseUrl: `http://localhost:${PORT}`,
      pactUrls: [PACT_FILE],
      logLevel: 'warn',
      stateHandlers: {
        [ETAT_ETABLISSEMENTS]: seedCreche,
        [ETAT_ETABLISSEMENT_EDITABLE]: seedCreche,
      },
    }).verifyProvider();
  });
});
