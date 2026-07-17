import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { Verifier } from '@pact-foundation/pact';
import { signerAssertion } from '@creche-planner/nest-commons';
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
// l'unicité e-mail par foyer).
const ETAT_FOYER_SANS_PARENT = 'un foyer de référence T3 sans parent';
const ETAT_FOYER_AVEC_PARENT = 'un foyer de référence T3 avec un parent';
// Retrait de parent (Lot 1) : la garde « dernier parent actif » refuse (409) le
// retrait de l'unique parent → l'interaction 204 exige DEUX parents actifs (le
// parent de référence à retirer + un second « lest » qui reste dans le foyer).
const ETAT_FOYER_AVEC_DEUX_PARENTS =
  'un foyer de référence T3 avec deux parents';
// Enfant (P4) : seede le foyer puis (table rase) un enfant actif d'id connu pour
// l'édition/le retrait. Idempotent (ré-exécution locale sans clash sur l'id).
const ETAT_FOYER_AVEC_ENFANT = 'un foyer de référence T3 avec un enfant';
// Préférences (PR1, consommé en PR2) : seede foyer + parent connu + une
// préférence stockée (e-mail coupé) pour exercer lecture/écriture des préférences.
// Idempotent (purge parent par id ET par e-mail avant réinsertion — unicité
// e-mail par foyer ; la préférence cascade au `delete` du parent).
const ETAT_FOYER_AVEC_PREFERENCES =
  'un foyer de référence T3 avec un parent et ses préférences';
// Création atomique (Lot 2) : purge les e-mails visés (unicité e-mail **par foyer**
// sur les actifs depuis le lot 5) pour que la création POST du pact réussisse (201,
// pas 409) même en ré-exécution locale. `svc-foyer` insère foyer + enfant + parents.
const ETAT_CREATION_LIBRE =
  'aucun parent existant ne bloque la création de référence';
// Lot 5 — contrats d'erreur.
// Doublon e-mail (409 EMAIL_DEJA_UTILISE) : seede le foyer + UN parent ACTIF avec
// l'e-mail visé → un second ajout du même e-mail dans ce foyer est refusé.
const ETAT_PARENT_ACTIF_DOUBLON =
  'un parent actif avec cet e-mail existe déjà dans ce foyer';
// Dernier parent actif (409 DERNIER_PARENT_ACTIF) : seede le foyer + EXACTEMENT un
// parent actif (celui à retirer) → la garde refuse son retrait (transition 1→0).
const ETAT_FOYER_UN_SEUL_PARENT = "le foyer n'a qu'un seul parent actif";
// Foyer inexistant (404) : garantit l'absence du foyer visé (delete cascade).
const ETAT_AUCUN_FOYER = 'aucun foyer avec cet id';
// L4 — désabonnement one-click (RFC 8058, PR5). Deux états DÉDIÉS qui seedent
// parent + ligne `desabonnement_token` (`utilise_le=null`, `expire_le` 2100-01-01).
// `ETAT_DESABO_OK` : couper EMAIL laisse IN_APP (défaut actif) → 204. `ETAT_DESABO_
// DERNIER` seede en plus une préférence IN_APP `actif=false` → couper EMAIL ne
// laisse aucun canal actif → 409, jeton NON consommé (re-seedé à chaque run).
const ETAT_DESABO_OK =
  'un jeton de désabonnement valide coupe un canal non critique';
const ETAT_DESABO_DERNIER =
  'un jeton de désabonnement couperait le dernier canal actif';

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
        // Secret désabo ÉPINGLÉ : doit être byte-identique au `SECRET_DESABO` avec
        // lequel le consumer signe ses jetons, sinon la signature échoue au verify.
        DESABONNEMENT_TOKEN_SECRET: 'pact-desabo-secret',
        OTEL_SDK_DISABLED: 'true',
        // Secret d'assertion inter-services ÉPINGLÉ (fondations lot 3) : byte-identique
        // à celui dont le requestFilter signe l'en-tête x-assertion-identite ci-dessous.
        ASSERTION_IDENTITE_SECRET: 'pact-assertion-secret',
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
          // (unicité par foyer) → l'ajout du pact réussit (201, pas 409).
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
        [ETAT_FOYER_AVEC_DEUX_PARENTS]: async (
          params?: unknown,
        ): Promise<void> => {
          const { foyerId, parentId, email, parentLestId, emailLest } =
            params as {
              foyerId: string;
              parentId: string;
              email: string;
              parentLestId: string;
              emailLest: string;
            };
          await seedFoyer(db, foyerId);
          // Table rase (idempotence, unicité e-mail par foyer), puis DEUX
          // parents actifs : celui à retirer + le « lest » qui satisfait la garde.
          await db`delete from parent where foyer_id = ${foyerId}`;
          await db`delete from parent where lower(email) = lower(${email})`;
          await db`delete from parent where lower(email) = lower(${emailLest})`;
          await db`
            insert into parent (id, foyer_id, prenom, nom, email, principal, ordre, actif)
            values
              (${parentId}, ${foyerId}, 'Alex', 'Dupont', ${email}, false, 0, true),
              (${parentLestId}, ${foyerId}, 'Dominique', 'Bernard', ${emailLest}, false, 1, true)
          `;
        },
        [ETAT_CREATION_LIBRE]: async (params?: unknown): Promise<void> => {
          const { emails } = params as { emails: string[] };
          // Table rase des e-mails visés (unicité par foyer) → la création réussit.
          for (const email of emails) {
            await db`delete from parent where lower(email) = lower(${email})`;
          }
        },
        [ETAT_PARENT_ACTIF_DOUBLON]: async (
          params?: unknown,
        ): Promise<void> => {
          const { foyerId, parentId, email } = params as {
            foyerId: string;
            parentId: string;
            email: string;
          };
          await seedFoyer(db, foyerId);
          // Table rase puis UN parent ACTIF avec l'e-mail visé : un second ajout du
          // même e-mail dans ce foyer heurte `parent_email_par_foyer_actif_idx`.
          await db`delete from parent where foyer_id = ${foyerId}`;
          await db`delete from parent where lower(email) = lower(${email})`;
          await db`
            insert into parent (id, foyer_id, prenom, nom, email, principal, ordre, actif)
            values (${parentId}, ${foyerId}, 'Alex', 'Dupont', ${email}, false, 0, true)
          `;
        },
        [ETAT_FOYER_UN_SEUL_PARENT]: async (
          params?: unknown,
        ): Promise<void> => {
          const { foyerId, parentId, email } = params as {
            foyerId: string;
            parentId: string;
            email: string;
          };
          await seedFoyer(db, foyerId);
          // EXACTEMENT un parent actif (celui à retirer) : la garde « dernier parent
          // actif » refuse (409) la transition 1→0.
          await db`delete from parent where foyer_id = ${foyerId}`;
          await db`delete from parent where lower(email) = lower(${email})`;
          await db`
            insert into parent (id, foyer_id, prenom, nom, email, principal, ordre, actif)
            values (${parentId}, ${foyerId}, 'Alex', 'Dupont', ${email}, false, 0, true)
          `;
        },
        [ETAT_AUCUN_FOYER]: async (params?: unknown): Promise<void> => {
          const { id } = params as { id: string };
          // Garantit l'absence du foyer (enfants/parents cascadent) → 404 en lecture.
          await db`delete from foyer where id = ${id}`;
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
        [ETAT_FOYER_AVEC_PREFERENCES]: async (
          params?: unknown,
        ): Promise<void> => {
          const { foyerId, parentId, email } = params as {
            foyerId: string;
            parentId: string;
            email: string;
          };
          await seedFoyer(db, foyerId);
          // Table rase du parent visé (les préférences cascadent au delete).
          await db`delete from parent where foyer_id = ${foyerId}`;
          await db`delete from parent where lower(email) = lower(${email})`;
          await db`
            insert into parent (id, foyer_id, prenom, nom, email, principal, ordre, actif)
            values (${parentId}, ${foyerId}, 'Alex', 'Dupont', ${email}, true, 0, true)
          `;
          // Un choix explicite stocké : e-mail coupé (in-app reste au défaut).
          await db`
            insert into preference_notification (parent_id, type_notification, canal, actif, source_dernier)
            values (${parentId}, 'VALIDATION_HEBDO', 'EMAIL', false, 'ECRAN')
          `;
        },
        [ETAT_DESABO_OK]: async (params?: unknown): Promise<void> => {
          const { foyerId, parentId, email, jti } = params as {
            foyerId: string;
            parentId: string;
            email: string;
            jti: string;
          };
          await seedFoyer(db, foyerId);
          // Table rase (idempotence, unicité e-mail par foyer) puis UN parent actif.
          // Aucune préférence stockée : couper EMAIL laisse IN_APP au défaut (actif).
          await db`delete from parent where foyer_id = ${foyerId}`;
          await db`delete from parent where lower(email) = lower(${email})`;
          await db`
            insert into parent (id, foyer_id, prenom, nom, email, principal, ordre, actif)
            values (${parentId}, ${foyerId}, 'Alex', 'Dupont', ${email}, false, 0, true)
          `;
          // Jeton one-shot VALIDE (non expiré, non utilisé) ciblant EMAIL.
          await db`
            insert into desabonnement_token (jti, parent_id, type_notification, canal, emis_le, expire_le, utilise_le)
            values (${jti}, ${parentId}, 'VALIDATION_HEBDO', 'EMAIL', now(), '2100-01-01T00:00:00.000Z', null)
          `;
        },
        [ETAT_DESABO_DERNIER]: async (params?: unknown): Promise<void> => {
          const { foyerId, parentId, email, jti } = params as {
            foyerId: string;
            parentId: string;
            email: string;
            jti: string;
          };
          await seedFoyer(db, foyerId);
          await db`delete from parent where foyer_id = ${foyerId}`;
          await db`delete from parent where lower(email) = lower(${email})`;
          await db`
            insert into parent (id, foyer_id, prenom, nom, email, principal, ordre, actif)
            values (${parentId}, ${foyerId}, 'Alex', 'Dupont', ${email}, false, 0, true)
          `;
          // IN_APP explicitement coupé : couper EMAIL par le jeton laisserait ZÉRO
          // canal actif → 409, jeton NON consommé (utilise_le reste null).
          await db`
            insert into preference_notification (parent_id, type_notification, canal, actif, source_dernier)
            values (${parentId}, 'VALIDATION_HEBDO', 'IN_APP', false, 'ECRAN')
          `;
          await db`
            insert into desabonnement_token (jti, parent_id, type_notification, canal, emis_le, expire_le, utilise_le)
            values (${jti}, ${parentId}, 'VALIDATION_HEBDO', 'EMAIL', now(), '2100-01-01T00:00:00.000Z', null)
          `;
        },
      },
    }).verifyProvider();
  });
});
