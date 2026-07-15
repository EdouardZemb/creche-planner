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
// Inbox in-app (PR6, §5.6) : un parent possède UNE notification in-app non lue.
const ETAT_INBOX = 'un parent a une notification in-app non lue';

/**
 * Id figé de la **fiche établissement projetée** (read model `etablissement`, P3) —
 * destinataire réel du récap agrégé, rattaché aux contrats par `etablissement_id`.
 * Partagé avec le consumer (`ETABLISSEMENT_ID`).
 */
const ETABLISSEMENT_ID = '99999999-9999-4999-8999-999999999999';
// Établissement du même foyer **sans e-mail** → brouillon non routable (partagé consumer).
const ETABLISSEMENT_SANS_EMAIL_ID = '99999999-9999-4999-8999-999999999998';
// Établissement du même foyer **archivé** (avec e-mail) → non routable, raison ARCHIVE.
const ETABLISSEMENT_ARCHIVE_ID = '99999999-9999-4999-8999-999999999997';

/** Identifiants figés des semaines à valider seedées (partagés avec le consumer). */
const NOTIF_ID = '88888888-8888-4888-8888-888888888888';
const NOTIF_ID_2 = '88888888-8888-4888-8888-888888888889';
const NOTIF_ID_SANS_EMAIL = '88888888-8888-4888-8888-888888888890';
const NOTIF_ID_ARCHIVE = '88888888-8888-4888-8888-888888888891';
const FOYER_ID = '22222222-2222-4222-8222-222222222222';
const CONTRAT_ID = '55555555-0000-4000-8000-000000000000';
const CONTRAT_ID_2 = '55555555-0000-4000-8000-000000000001';
const CONTRAT_ID_SANS_EMAIL = '55555555-0000-4000-8000-000000000002';
const CONTRAT_ID_ARCHIVE = '55555555-0000-4000-8000-000000000003';
const SEMAINE = '2026-W10';

// nx lance vitest avec cwd = racine du projet (apps/svc-notifications) → racine du dépôt à ../../.
const RACINE = resolve(process.cwd(), '../..');
const BUNDLE = resolve(RACINE, 'apps/svc-notifications/dist/main.js');
const PACT_FILE = resolve(RACINE, 'pacts/api-gateway-svc-notifications.json');

// Port dédié (3995) : distinct des autres providers pact (référentiel 3996,
// planification 3997, tarification 3998, foyer 3999) pour éviter une collision
// `EADDRINUSE` quand plusieurs vérifications provider tournent en parallèle dans le
// même job CI (cas d'un changement large « affected », ex. mise à jour du lockfile).
const PORT = Number(process.env['PACT_PROVIDER_PORT'] ?? 3995);
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
    // Upsert idempotent de la **fiche établissement projetée** (read model
    // `etablissement`, P3) : destinataire réel du récap agrégé, résolu par le lien
    // explicite `contrat.etablissement_id`.
    const seedEtablissementProjete = async (
      id: string = ETABLISSEMENT_ID,
      nom = 'Crèche Les Hirondelles',
      emailService: string | null = 'contact-creche@example.org',
      actif = true,
    ): Promise<void> => {
      await db`
        insert into etablissement (
          id, foyer_id, nom, email_service, preavis_regle, types, actif
        ) values (
          ${id}, ${FOYER_ID}, ${nom},
          ${emailService},
          ${JSON.stringify({ type: 'JOURS_OUVRES', valeur: 2 })}::jsonb,
          '[]'::jsonb, ${actif}
        )
        on conflict (id) do update set
          foyer_id = excluded.foyer_id,
          nom = excluded.nom,
          email_service = excluded.email_service,
          preavis_regle = excluded.preavis_regle,
          actif = excluded.actif
      `;
    };
    // Seede de quoi régénérer/envoyer un brouillon **agrégé par établissement** : deux
    // contrats du même foyer rattachés à la fiche projetée (`etablissement_id`), chacun
    // avec une semaine validée avec un delta, et la fiche établissement. Idempotent. Pour
    // l'envoi, on purge d'abord la trace `envoi_etablissement` afin que la vérification
    // reparte d'un envoi neuf (statut DRY_RUN attendu).
    const delta = (date: string): string =>
      JSON.stringify({
        jours: [
          {
            date,
            avant: null,
            apres: {
              joursSupplementaires: [],
              absences: [{ date }],
              exceptions: [],
              joursAlsh: [],
            },
          },
        ],
      });
    const seedContratValide = async (
      notifId: string,
      contratId: string,
      enfant: string,
      date: string,
      etablissementId: string = ETABLISSEMENT_ID,
    ): Promise<void> => {
      await db`
        insert into contrat (
          id, foyer_id, enfant, mode, etablissement_id, valide_du, valide_au
        ) values (
          ${contratId}, ${FOYER_ID}, ${enfant}, 'CRECHE_PSU',
          ${etablissementId}, '2026-01-01', null
        )
        on conflict (id) do update set
          enfant = excluded.enfant,
          mode = excluded.mode,
          etablissement_id = excluded.etablissement_id
      `;
      await db`
        insert into notification_hebdo (
          id, contrat_id, foyer_id, semaine_iso, type, statut, snapshot, delta_modifs
        ) values (
          ${notifId}, ${contratId}, ${FOYER_ID}, ${SEMAINE},
          'VALIDATION_HEBDO', 'VALIDEE_AVEC_MODIFS', '{}'::jsonb,
          ${delta(date)}::jsonb
        )
        on conflict (contrat_id, semaine_iso, type) do update set
          statut = 'VALIDEE_AVEC_MODIFS',
          delta_modifs = excluded.delta_modifs
      `;
    };
    const seedBrouillon = async (): Promise<void> => {
      await seedEtablissementProjete();
      await seedContratValide(NOTIF_ID, CONTRAT_ID, 'Léa', '2026-03-04');
      await seedContratValide(NOTIF_ID_2, CONTRAT_ID_2, 'Tom', '2026-03-05');
    };
    // Brouillon **non routable** : un établissement du même foyer **sans e-mail** avec
    // un contrat validé (le calcul des enfants ne dépend pas de l'adresse).
    const seedBrouillonSansEmail = async (): Promise<void> => {
      await seedEtablissementProjete(
        ETABLISSEMENT_SANS_EMAIL_ID,
        'Halte-garderie du Parc',
        null,
      );
      await seedContratValide(
        NOTIF_ID_SANS_EMAIL,
        CONTRAT_ID_SANS_EMAIL,
        'Zoé',
        '2026-03-04',
        ETABLISSEMENT_SANS_EMAIL_ID,
      );
    };
    // Brouillon **non routable** (archivé) : un établissement du même foyer **archivé**
    // (`actif=false`) mais **avec** e-mail → prouve la priorité `ARCHIVE` > `SANS_EMAIL`
    // (routable=false, raison ARCHIVE bien que l'adresse existe).
    const seedBrouillonArchive = async (): Promise<void> => {
      await seedEtablissementProjete(
        ETABLISSEMENT_ARCHIVE_ID,
        'Crèche Les Coccinelles',
        'contact-archive@example.org',
        false,
      );
      await seedContratValide(
        NOTIF_ID_ARCHIVE,
        CONTRAT_ID_ARCHIVE,
        'Nina',
        '2026-03-04',
        ETABLISSEMENT_ARCHIVE_ID,
      );
    };
    const seedEnvoi = async (): Promise<void> => {
      await seedBrouillon();
      await db`
        delete from envoi_etablissement
        where foyer_id = ${FOYER_ID} and semaine_iso = ${SEMAINE}
          and etablissement_id = ${ETABLISSEMENT_ID}
      `;
    };
    // Inbox in-app : (ré)insère UNE notification non lue (`lu_le = null`) possédée
    // par `parentId`, d'id `id`. Delete-then-insert = idempotent (l'accusé de
    // lecture d'une interaction précédente a pu poser `lu_le`). L'interaction 404
    // requête la MÊME notif au nom d'un autre parent → le prédicat `parent_id` de
    // `inbox.service.ts` la masque (404 `notification inconnue`).
    const seedInbox = async (parentId: string, id: string): Promise<void> => {
      await db`delete from notification where id = ${id}`;
      await db`
        insert into notification (
          id, parent_id, type, sujet, corps, lien, cree_le, lu_le
        ) values (
          ${id}, ${parentId}, 'VALIDATION_HEBDO',
          'Planning de la semaine à valider',
          'Votre planning de la semaine est prêt à être validé.',
          '/foyers/22222222-2222-4222-8222-222222222222/planning',
          now(), null
        )
      `;
    };
    await new Verifier({
      provider: 'svc-notifications',
      providerBaseUrl: `http://localhost:${PORT}`,
      pactUrls: [PACT_FILE],
      logLevel: 'warn',
      stateHandlers: {
        [ETAT_SEMAINE_A_VALIDER]: seedSemaineAValider,
        [ETAT_SEMAINE_VALIDABLE]: seedSemaineAValider,
        [ETAT_BROUILLON]: seedBrouillon,
        [ETAT_BROUILLON_SANS_EMAIL]: seedBrouillonSansEmail,
        [ETAT_BROUILLON_ARCHIVE]: seedBrouillonArchive,
        [ETAT_ENVOI]: seedEnvoi,
        [ETAT_INBOX]: async (params?: unknown): Promise<void> => {
          const { parentId, id } = params as { parentId: string; id: string };
          await seedInbox(parentId, id);
        },
      },
    }).verifyProvider();
  });
});
