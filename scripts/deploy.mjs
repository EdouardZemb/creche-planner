#!/usr/bin/env node
// @ts-check
/**
 * Déploiement de PRODUCTION **traçable** (AUD-08, doc 25 ; cf. docs/26-instrumentation-dora-aud-08.md).
 *
 * Lancé SUR LE SERVEUR de production par l'opérateur. Enveloppe les portes de
 * qualité de la [doc 24](../docs/exploitation/24-plan-deploiement-serveur-ct-qdo.md)
 * (1bis pull → 2 up --wait → 3 health/seed/perf) et **enregistre l'événement de
 * déploiement** auprès de GitHub (API Deployments) → c'est la source des métriques
 * DORA (deployment frequency, lead time, change failure rate, MTTR).
 *
 * Pourquoi un wrapper côté serveur (et pas un runner GitHub) : la topologie réseau
 * interdit le push SSH (aucun port entrant ; Cloudflare Tunnel sortant ; Deploy Key
 * git-only). Le déploiement est PULL-based : l'événement doit donc naître ici.
 * Voir doc 26 §1-2.
 *
 * Principe de NON-BLOCAGE TÉLÉMÉTRIE : un échec de l'API GitHub n'avorte JAMAIS un
 * déploiement réel (avertissement journalisé). À l'inverse, l'échec d'une PORTE
 * (pull/up/health) est fatal et se reflète en statut `failure`.
 *
 * ROLLBACK AUTOMATIQUE (Phase 7) : avant toute mutation, on mémorise la version
 * SAINE en place (label OCI du conteneur gateway). Si une porte P2 (`up --wait`)
 * ou P3 (`/health`, seed, perf) échoue, on RESTAURE cette version (re-`up --wait`
 * sur l'ancien `IMAGE_TAG`, sans re-pull car ses images sont déjà locales) puis
 * on re-teste `/health` AVANT de poster le statut `failure` annoté
 * « rolled back to <tag> ». Le rollback ne se relance JAMAIS lui-même (garde
 * anti-boucle) et ne crée pas de nouveau Deployment : ce déploiement reste
 * `failure`, la prod redevient saine → MTTR réduit.
 *
 * Zéro dépendance (Node ESM pur, `fetch` natif). Configuré par variables
 * d'environnement (lues depuis `.env.server` au besoin) — cf. tableau doc 26 §4.
 *
 *   # déploiement rolling `:main`
 *   node scripts/deploy.mjs
 *   # déploiement reproductible d'un SHA (rollback inclus)
 *   IMAGE_TAG=<sha> DEPLOY_REF=<sha> node scripts/deploy.mjs
 *   # répétition à blanc du flux (ni Docker ni API)
 *   DORA_DRY_RUN=1 node scripts/deploy.mjs
 *   # test du rollback à blanc (force l'échec d'une porte + version précédente)
 *   DORA_DRY_RUN=1 DEPLOY_PREVIOUS_TAG=0.1.0 DEPLOY_FAKE_FAIL=p3-health \
 *     node scripts/deploy.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- Configuration ----------------------------------------------------------
const REPO = process.env.GITHUB_REPOSITORY ?? 'EdouardZemb/creche-planner';
const TOKEN = process.env.GH_DEPLOYMENTS_TOKEN ?? '';
const ENVIRONMENT = process.env.DEPLOY_ENVIRONMENT ?? 'production';
const ENVIRONMENT_URL =
  process.env.DEPLOY_ENVIRONMENT_URL ?? 'https://creche.testlens.dev';
const IMAGE_TAG = process.env.IMAGE_TAG ?? 'main';
// Porte 3 (santé/seed/perf) — où joindre la gateway. En prod « ports non publiés »
// (#31, doc 24 §6), api-gateway n'expose AUCUN port hôte : on passe par Caddy (CA
// interne) via l'origine LAN. On dérive donc l'URL de SERVER_ORIGIN à défaut d'un
// GATEWAY_URL explicite ; en dev (override = ports publiés) on garde localhost:3000.
const GATEWAY_URL =
  process.env.GATEWAY_URL ||
  process.env.SERVER_ORIGIN ||
  'http://localhost:3000';
const SEED_BASE_URL = process.env.SEED_BASE_URL || `${GATEWAY_URL}/api/v1`;
// CA à faire confiance pour le TLS « internal » de Caddy quand la gateway est en
// HTTPS : fichier explicite (DEPLOY_CA_CERT / NODE_EXTRA_CA_CERTS), sinon le
// `caddy-root.crt` exporté à la racine du dépôt (cf. Caddyfile). On NE désactive
// JAMAIS la vérification TLS (-k) : confiance RÉELLE du CA. Vide en dev HTTP.
const CA_CERT =
  process.env.DEPLOY_CA_CERT ||
  process.env.NODE_EXTRA_CA_CERTS ||
  (existsSync(join(RACINE, 'caddy-root.crt'))
    ? join(RACINE, 'caddy-root.crt')
    : '');
// Environnement transmis aux sous-scripts node (seed/perf) : même gateway + même
// CA (NODE_EXTRA_CA_CERTS est lu par Node au démarrage → confiance du CA interne).
const CHILD_ENV = {
  ...process.env,
  GATEWAY_URL,
  SEED_BASE_URL,
  ...(CA_CERT ? { NODE_EXTRA_CA_CERTS: CA_CERT } : {}),
};
const DRY_RUN = process.env.DORA_DRY_RUN === '1';
const VERIFY_COSIGN = process.env.DEPLOY_VERIFY_COSIGN === '1';
const SKIP_SEED = process.env.DEPLOY_SKIP_SEED === '1';
const SKIP_PERF = process.env.DEPLOY_SKIP_PERF === '1';
// Rollback auto (Phase 7). Override explicite de la version-cible du rollback
// (sinon détectée depuis le conteneur gateway en place — cf. versionDeployee()).
// `ROLLBACK=0` désactive le rollback automatique (échec = on laisse en l'état).
const PREVIOUS_TAG_OVERRIDE = process.env.DEPLOY_PREVIOUS_TAG || '';
const ROLLBACK_ENABLED = process.env.ROLLBACK !== '0';
// Affordance de TEST : force l'échec d'une porte donnée (p2 | p3-health |
// p3-seed | p3-perf) pour exercer le rollback (utile en DORA_DRY_RUN=1).
const FAKE_FAIL = process.env.DEPLOY_FAKE_FAIL || '';

// Fichiers compose + env-file (override par-dessus la base). PROD par défaut ;
// le STAGING (Phase 8) surcharge via .env.staging :
//   DEPLOY_COMPOSE_FILES="docker-compose.yml docker-compose.staging.yml"
//   DEPLOY_ENV_FILE=.env.staging
const ENV_FILE = process.env.DEPLOY_ENV_FILE ?? '.env.server';
const COMPOSE_FILES = (
  process.env.DEPLOY_COMPOSE_FILES ??
  'docker-compose.yml docker-compose.server.yml'
)
  .trim()
  .split(/\s+/)
  .filter(Boolean);
const COMPOSE = [
  '--env-file',
  ENV_FILE,
  ...COMPOSE_FILES.flatMap((f) => ['-f', f]),
];
// Sous-ensemble de services passé à `up -d --wait` (Porte 2 ET rollback). VIDE en
// prod (= pile entière). Le STAGING ne lève que les services applicatifs (leurs
// depends_on tirent l'infra), pas l'observabilité lourde :
//   DEPLOY_UP_SERVICES="web api-gateway svc-referentiel svc-foyer svc-planification svc-tarification svc-notifications"
const UP_SERVICES = (process.env.DEPLOY_UP_SERVICES ?? '')
  .trim()
  .split(/\s+/)
  .filter(Boolean);

const GATEWAY_IMAGE = `ghcr.io/edouardzemb/creche-planner/api-gateway:${IMAGE_TAG}`;

// --- Utilitaires ------------------------------------------------------------

/** Exécute une commande (stdio hérité). Retourne le code de sortie. */
function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  if (DRY_RUN) {
    console.log('  (DORA_DRY_RUN — commande non exécutée)');
    return 0;
  }
  const r = spawnSync(cmd, args, {
    cwd: RACINE,
    stdio: 'inherit',
    shell: false,
    ...opts,
  });
  if (r.error) {
    console.error(`  ✗ ${r.error.message}`);
    return 1;
  }
  return r.status ?? 1;
}

/** Comme run() mais capture stdout (trim). '' si échec/dry-run. */
function capture(cmd, args) {
  if (DRY_RUN) return '';
  const r = spawnSync(cmd, args, { cwd: RACINE, encoding: 'utf8' });
  return r.status === 0 ? (r.stdout ?? '').trim() : '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Appel API GitHub best-effort, avec REESSAIS sur erreur TRANSITOIRE (panne réseau
 * « fetch failed », HTTP 5xx). Un `up --wait` peut perturber brièvement la sortie
 * réseau (Caddy/cloudflared redémarrent) : sans réessai, le POST du statut TERMINAL
 * se perdait et DORA ratait le déploiement. Les erreurs PERMANENTES (4xx : token
 * invalide, validation) ne sont PAS réessayées. Retourne le JSON, ou null si KO.
 */
async function gh(method, path, body, { retries = 3 } = {}) {
  if (!TOKEN) {
    console.warn(
      `  ⚠️ GH_DEPLOYMENTS_TOKEN absent → ${method} ${path} ignoré (déploiement NON tracé).`,
    );
    return null;
  }
  if (DRY_RUN) {
    console.log(`  (DORA_DRY_RUN — ${method} ${path} non envoyé)`);
    return method === 'POST' && path.endsWith('/deployments') ? { id: 0 } : {};
  }
  for (let essai = 1; essai <= retries; essai++) {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'creche-planner-deploy',
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      if (res.ok) return text ? JSON.parse(text) : {};
      // 4xx = permanent (auth/validation) → inutile de réessayer.
      if (res.status < 500) {
        console.warn(
          `  ⚠️ API GitHub ${method} ${path} → HTTP ${res.status} : ${text.slice(0, 200)}`,
        );
        return null;
      }
      console.warn(
        `  ⚠️ API GitHub ${method} ${path} → HTTP ${res.status} (tentative ${essai}/${retries})`,
      );
    } catch (e) {
      console.warn(
        `  ⚠️ API GitHub injoignable (${method} ${path}, tentative ${essai}/${retries}) : ${e.message}`,
      );
    }
    if (essai < retries) await sleep(1000 * 2 ** (essai - 1)); // 1 s, 2 s, …
  }
  return null;
}

// --- Étapes du déploiement --------------------------------------------------

let deploymentId = null;
// Rollback auto (Phase 7) : version SAINE en place AVANT ce déploiement (cible de
// restauration), et garde anti-boucle (un rollback ne se relance jamais).
let versionPrecedente = '';
let enRollback = false;

/** Crée le GitHub Deployment + statut in_progress. `ref` = SHA/tag déployé. */
async function creerDeploiement(ref) {
  console.log(
    `\n▶ Enregistrement du déploiement (env=${ENVIRONMENT}, ref=${ref})`,
  );
  const dep = await gh('POST', '/deployments', {
    ref,
    environment: ENVIRONMENT,
    description: `Déploiement ${ENVIRONMENT} de ${ref} (IMAGE_TAG=${IMAGE_TAG})`,
    auto_merge: false,
    // On déploie un SHA DÉJÀ validé par la CI → pas de re-vérification de statuts.
    required_contexts: [],
    production_environment: ENVIRONMENT === 'production',
    transient_environment: false,
  });
  deploymentId = dep?.id ?? null;
  if (deploymentId) {
    console.log(`  ✓ Deployment #${deploymentId} créé.`);
    await statut('in_progress');
  }
}

/**
 * Poste un deployment_status (best-effort). Retourne `true` si RÉELLEMENT enregistré.
 * En cas d'échec d'un statut TERMINAL (success/failure), affiche la commande de
 * rattrapage manuel — sans quoi DORA raterait le déploiement.
 */
async function statut(state, description) {
  if (!deploymentId) return false;
  const res = await gh('POST', `/deployments/${deploymentId}/statuses`, {
    state,
    environment: ENVIRONMENT,
    environment_url: ENVIRONMENT_URL,
    description: description ?? `état : ${state}`,
  });
  if (res) {
    console.log(
      `  ✓ Statut « ${state} » posté sur le Deployment #${deploymentId}.`,
    );
    return true;
  }
  console.warn(
    `  ⚠️ Statut « ${state} » NON enregistré (API injoignable) sur le Deployment #${deploymentId}.`,
  );
  if (state === 'success' || state === 'failure') {
    console.warn(
      `     Rattrapage manuel : gh api -X POST ` +
        `repos/${REPO}/deployments/${deploymentId}/statuses ` +
        `-f state=${state} -f environment=${ENVIRONMENT} ` +
        `-f environment_url=${ENVIRONMENT_URL}`,
    );
  }
  return false;
}

/**
 * Échec d'une porte (P2/P3) : tente le ROLLBACK automatique vers la version saine
 * précédente, PUIS poste `failure` (annoté du résultat du rollback) et termine en
 * erreur. Le rollback est best-effort sur le statut GitHub (non-blocage télémétrie)
 * mais la RESTAURATION elle-même est réelle.
 */
async function echouer(message) {
  console.error(`\n❌ ${message}`);
  let note = message;
  if (enRollback) {
    // Sécurité : on n'entre jamais ici depuis le rollback (qui n'appelle pas
    // echouer), mais on garde le garde anti-boucle explicite.
    note = `${message} (échec pendant le rollback — pas de nouvelle tentative)`;
  } else if (!ROLLBACK_ENABLED) {
    note = `${message} (rollback auto désactivé — prod laissée en l'état)`;
  } else if (!versionPrecedente) {
    note = `${message} (aucune version précédente connue — rollback impossible)`;
  } else if (versionPrecedente === IMAGE_TAG) {
    // Redéploiement du MÊME tag (mutable, ou re-déploiement identique) : revenir
    // au même artefact ne réparerait rien → on ne tente pas un rollback futile.
    console.warn(
      `   ⚠️ cible de rollback (${versionPrecedente}) == IMAGE_TAG déployé : rollback sans effet, ignoré.`,
    );
    note = `${message} (rollback ignoré : version précédente == tag déployé ${IMAGE_TAG})`;
  } else {
    const ok = await rollback();
    note = ok
      ? `${message} — rolled back to ${versionPrecedente}`
      : `${message} — ROLLBACK vers ${versionPrecedente} ÉCHOUÉ (prod dégradée, intervention requise)`;
  }
  await statut('failure', note.slice(0, 140));
  process.exit(1);
}

/**
 * ROLLBACK automatique (Phase 7) : restaure `versionPrecedente`.
 * Re-démarre la pile sur l'ancien `IMAGE_TAG` puis re-teste `/health`. NE re-pull
 * PAS : avec des tags immuables (Phase 2) les images d'avant sont encore présentes
 * localement (les conteneurs tournaient dessus) ; éviter le réseau réduit la
 * surface d'échec du rollback lui-même. NE se relance JAMAIS (garde `enRollback`).
 * Retourne `true` si la prod est de nouveau saine (santé 200).
 */
async function rollback() {
  enRollback = true;
  console.error(
    `\n↩️  ROLLBACK automatique → restauration de « ${versionPrecedente} » (dernière version saine).`,
  );
  // `up -d --wait` avec l'ANCIEN IMAGE_TAG : recrée les conteneurs depuis les
  // images locales. La var d'environnement de shell prime sur l'--env-file. Même
  // sous-ensemble de services que le déploiement (UP_SERVICES) pour ne pas toucher
  // d'autres conteneurs.
  const code = run(
    'docker',
    ['compose', ...COMPOSE, 'up', '-d', '--wait', ...UP_SERVICES],
    { env: { ...process.env, IMAGE_TAG: versionPrecedente } },
  );
  if (code !== 0) {
    console.error(
      '   ✗ `up -d --wait` du rollback a échoué — la prod peut rester dégradée.',
    );
    return false;
  }
  console.log(
    `\n▶ Rollback — re-vérification santé (${GATEWAY_URL}/api/health)`,
  );
  if (verifierSante() !== 0) {
    console.error('   ✗ Santé toujours rouge après rollback.');
    return false;
  }
  console.error(
    `   ✓ Rollback réussi — prod restaurée sur « ${versionPrecedente} » (santé 200).`,
  );
  return true;
}

/**
 * Résout le SHA réellement déployé pour le `ref` du Deployment (clé du lead time).
 * Priorité : DEPLOY_REF explicite > label OCI de l'image gateway tirée > IMAGE_TAG.
 */
function resoudreRef() {
  if (process.env.DEPLOY_REF) return process.env.DEPLOY_REF;
  // metadata-action (AUD-05) pose org.opencontainers.image.revision = <sha>.
  const sha = capture('docker', [
    'image',
    'inspect',
    GATEWAY_IMAGE,
    '--format',
    '{{ index .Config.Labels "org.opencontainers.image.revision" }}',
  ]);
  if (sha && sha !== '<no value>') return sha;
  return IMAGE_TAG;
}

/**
 * Version actuellement DÉPLOYÉE (cible du rollback), lue AVANT toute mutation
 * depuis les labels OCI du CONTENEUR gateway en place. Priorité :
 * `.image.version` (semver de train — couvre tous les services, rollback uniforme) >
 * `.image.revision` (SHA). '' si aucun conteneur (1er déploiement) ⇒ pas de
 * rollback possible. Un override explicite `DEPLOY_PREVIOUS_TAG` court-circuite la
 * détection (utile en test, ou si l'opérateur connaît la cible).
 */
function versionDeployee() {
  if (PREVIOUS_TAG_OVERRIDE) return PREVIOUS_TAG_OVERRIDE;
  const cid = capture('docker', [
    'compose',
    ...COMPOSE,
    'ps',
    '-q',
    'api-gateway',
  ]);
  if (!cid) return '';
  // ps -q peut rendre plusieurs lignes (réplicas) : on inspecte la première.
  const conteneur = cid.split('\n')[0].trim();
  for (const label of [
    'org.opencontainers.image.version',
    'org.opencontainers.image.revision',
  ]) {
    const v = capture('docker', [
      'inspect',
      conteneur,
      '--format',
      `{{ index .Config.Labels "${label}" }}`,
    ]);
    if (v && v !== '<no value>') return v;
  }
  return '';
}

/** Porte 3 — santé gateway (`/api/health`). Retourne le code de sortie de curl. */
function verifierSante() {
  const curlArgs = [
    '--fail',
    '--retry',
    '10',
    '--retry-delay',
    '3',
    '--retry-connrefused',
    '--retry-all-errors',
  ];
  // TLS « internal » de Caddy : faire confiance au CA exporté (jamais -k).
  if (GATEWAY_URL.startsWith('https://') && CA_CERT)
    curlArgs.push('--cacert', CA_CERT);
  curlArgs.push(`${GATEWAY_URL}/api/health`);
  return run('curl', curlArgs);
}

/**
 * Verdict d'une porte : `true` = échec. Combine le code réel et l'affordance de
 * TEST `DEPLOY_FAKE_FAIL` (force l'échec de la porte `id` pour exercer le rollback,
 * notamment en DORA_DRY_RUN où `run()` renvoie toujours 0).
 */
function porteEchoue(id, codeReel) {
  if (FAKE_FAIL === id) {
    console.warn(`  (DEPLOY_FAKE_FAIL=${id} — échec de porte simulé)`);
    return true;
  }
  return codeReel !== 0;
}

// --- Orchestration ----------------------------------------------------------

async function main() {
  console.log('═══ Déploiement traçable creche-planner (AUD-08) ═══');
  console.log(`  dépôt=${REPO} · env=${ENVIRONMENT} · IMAGE_TAG=${IMAGE_TAG}`);
  console.log(
    `  compose=[${COMPOSE_FILES.join(' ')}] · services=${UP_SERVICES.length ? UP_SERVICES.join(',') : '(pile entière)'}`,
  );
  if (DRY_RUN) console.log('  MODE DORA_DRY_RUN : aucune action réelle.');
  if (!TOKEN && !DRY_RUN)
    console.warn(
      '  ⚠️ GH_DEPLOYMENTS_TOKEN absent → le déploiement NE SERA PAS tracé (DORA aveugle).',
    );

  // Rollback auto (Phase 7) : mémoriser la version SAINE en place AVANT toute
  // mutation (pull/up). C'est la cible de restauration si une porte échoue.
  versionPrecedente = versionDeployee();
  if (!ROLLBACK_ENABLED)
    console.log('  ↩️  rollback automatique DÉSACTIVÉ (ROLLBACK=0).');
  else if (versionPrecedente)
    console.log(
      `  ↩️  version en place (cible de rollback) : ${versionPrecedente}`,
    );
  else
    console.log(
      '  ↩️  aucune version en place détectée → rollback auto indisponible (1er déploiement ?).',
    );

  // On crée d'abord un Deployment provisoire sur IMAGE_TAG, puis on raffine le ref
  // une fois l'image tirée (résolution du SHA exact). Pour éviter deux Deployments,
  // on TIRE d'abord, on résout le SHA, PUIS on crée le Deployment.

  // Porte 1bis — récupération (+ vérification cosign optionnelle).
  if (VERIFY_COSIGN) {
    console.log('\n▶ Porte 1bis — vérification de signature cosign (AUD-07)');
    const code = run('cosign', [
      'verify',
      GATEWAY_IMAGE,
      '--certificate-identity-regexp',
      'https://github.com/EdouardZemb/creche-planner/.+',
      '--certificate-oidc-issuer',
      'https://token.actions.githubusercontent.com',
    ]);
    if (code !== 0) {
      // Pas encore de Deployment créé → on ne peut pas poster `failure` ; on sort.
      console.error('\n❌ Signature cosign invalide — déploiement refusé.');
      process.exit(1);
    }
  }

  console.log('\n▶ Porte 1bis — récupération des images (docker compose pull)');
  if (run('docker', ['compose', ...COMPOSE, 'pull']) !== 0) {
    console.error('\n❌ `docker compose pull` a échoué — déploiement refusé.');
    process.exit(1);
  }

  // Résout le SHA déployé MAINTENANT (images présentes) puis enregistre l'événement.
  const ref = resoudreRef();
  await creerDeploiement(ref);

  // Porte 2 — démarrage (healthcheck = porte via --wait). UP_SERVICES vide en prod
  // (pile entière) ; en staging, seulement les services applicatifs.
  console.log('\n▶ Porte 2 — démarrage de la pile (up -d --wait)');
  if (
    porteEchoue(
      'p2',
      run('docker', [
        'compose',
        ...COMPOSE,
        'up',
        '-d',
        '--wait',
        ...UP_SERVICES,
      ]),
    )
  )
    await echouer(
      "Porte 2 : `up -d --wait` a échoué (un conteneur n'est pas sain).",
    );

  // Porte 3 — vérification post-déploiement (shift-right).
  console.log(`\n▶ Porte 3 — santé gateway (${GATEWAY_URL}/api/health)`);
  if (porteEchoue('p3-health', verifierSante()))
    await echouer('Porte 3 : la santé gateway ne répond pas 200.');

  if (!SKIP_SEED) {
    console.log('\n▶ Porte 3 — seed de référence (idempotent)');
    if (
      porteEchoue(
        'p3-seed',
        run('node', ['scripts/seed-demo.mjs'], { env: CHILD_ENV }),
      )
    )
      await echouer('Porte 3 : le seed de référence a échoué.');
  }

  if (!SKIP_PERF) {
    console.log('\n▶ Porte 3 — smoke performance');
    if (
      porteEchoue(
        'p3-perf',
        run('node', ['scripts/perf-smoke.mjs'], { env: CHILD_ENV }),
      )
    )
      await echouer('Porte 3 : le smoke performance a dépassé le plafond.');
  }

  // Succès — statut final. `tracé` ne vaut que si le statut a RÉELLEMENT été posté.
  const trace = await statut(
    'success',
    `Déploiement ${ref} en ligne (${ENVIRONMENT_URL}).`,
  );
  console.log(
    `\n✅ Déploiement RÉUSSI — ${ref} en ligne sur ${ENVIRONMENT_URL}.` +
      (!deploymentId
        ? ' (NON tracé : pas de token)'
        : trace
          ? ` (Deployment #${deploymentId} tracé → DORA)`
          : ` (⚠️ Deployment #${deploymentId} créé mais statut success NON enregistré — voir rattrapage ci-dessus)`),
  );
}

main().catch(async (e) => {
  console.error(`\n❌ Échec inattendu du déploiement : ${e.message}`);
  try {
    await statut('error', `Erreur inattendue : ${e.message}`.slice(0, 140));
  } catch {
    /* best-effort */
  }
  process.exit(1);
});
