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
const ETAT_SEMAINE_A_VALIDER = 'une semaine est à valider pour un foyer';
const ETAT_SEMAINE_VALIDABLE = 'une semaine A_VALIDER existe pour validation';
const ETAT_BROUILLON = 'un brouillon de mail de service est disponible';
const ETAT_ENVOI = 'une semaine validée est prête à envoyer au service';

/** Id figé de la ligne crèche seedée par le stateHandler. */
const CRECHE_ID = '99999999-9999-4999-8999-999999999999';

/** Identifiants figés des semaines à valider seedées (partagés avec le consumer). */
const NOTIF_ID = '88888888-8888-4888-8888-888888888888';
const FOYER_ID = '22222222-2222-4222-8222-222222222222';
const CONTRAT_ID = '55555555-0000-4000-8000-000000000000';
const SEMAINE = '2026-W10';

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
    // Upsert idempotent d'une semaine A_VALIDER (remise à l'état initial à chaque
    // interaction : la validation peut faire passer la ligne à VALIDEE).
    const seedSemaineAValider = async (): Promise<void> => {
      await db`
        insert into notification_hebdo (
          id, contrat_id, foyer_id, semaine_iso, type, statut, snapshot
        ) values (
          ${NOTIF_ID}, ${CONTRAT_ID}, ${FOYER_ID}, ${SEMAINE},
          'VALIDATION_HEBDO', 'A_VALIDER', '{}'::jsonb
        )
        on conflict (contrat_id, semaine_iso, type) do update set
          statut = 'A_VALIDER',
          validee_le = null,
          delta_modifs = null,
          snapshot = '{}'::jsonb
      `;
    };
    // Seede de quoi régénérer/envoyer un brouillon : le contrat (read model,
    // mode → établissement), la semaine validée avec un delta, et l'établissement
    // crèche. Idempotent. Pour l'envoi, on purge d'abord la trace `envoi_mail` afin
    // que la vérification reparte d'un envoi neuf (statut DRY_RUN attendu).
    const seedBrouillon = async (): Promise<void> => {
      await seedCreche();
      await db`
        insert into contrat (id, foyer_id, enfant, mode, valide_du, valide_au)
        values (
          ${CONTRAT_ID}, ${FOYER_ID}, 'Léa', 'CRECHE_PSU', '2026-01-01', null
        )
        on conflict (id) do update set
          enfant = excluded.enfant, mode = excluded.mode
      `;
      await db`
        insert into notification_hebdo (
          id, contrat_id, foyer_id, semaine_iso, type, statut, snapshot, delta_modifs
        ) values (
          ${NOTIF_ID}, ${CONTRAT_ID}, ${FOYER_ID}, ${SEMAINE},
          'VALIDATION_HEBDO', 'VALIDEE_AVEC_MODIFS', '{}'::jsonb,
          ${JSON.stringify({
            jours: [
              {
                date: '2026-03-04',
                avant: null,
                apres: {
                  joursSupplementaires: [],
                  absences: [{ date: '2026-03-04' }],
                  exceptions: [],
                  joursAlsh: [],
                },
              },
            ],
          })}::jsonb
        )
        on conflict (contrat_id, semaine_iso, type) do update set
          statut = 'VALIDEE_AVEC_MODIFS',
          delta_modifs = excluded.delta_modifs
      `;
    };
    const seedEnvoi = async (): Promise<void> => {
      await seedBrouillon();
      await db`
        delete from envoi_mail
        where contrat_id = ${CONTRAT_ID} and semaine_iso = ${SEMAINE}
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
        [ETAT_SEMAINE_A_VALIDER]: seedSemaineAValider,
        [ETAT_SEMAINE_VALIDABLE]: seedSemaineAValider,
        [ETAT_BROUILLON]: seedBrouillon,
        [ETAT_ENVOI]: seedEnvoi,
      },
    }).verifyProvider();
  });
});
