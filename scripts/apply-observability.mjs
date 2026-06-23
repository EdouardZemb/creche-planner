#!/usr/bin/env node
// @ts-check
/**
 * Application TRAÇABLE et IDEMPOTENTE d'un changement de config d'OBSERVABILITÉ
 * (Phase 9, roadmap CI/CD — cf. docs/exploitation/observabilite.md § « Appliquer la
 * config d'observabilité (Phase 9) »).
 *
 * POURQUOI ce script. Jusqu'ici, appliquer un changement de config d'observabilité
 * (prometheus.yml, alerts.yml, alertmanager.yml, otel-collector-config.yaml, datasource
 * Grafana, dashboards…) se faisait À LA MAIN sur le serveur via
 *   docker compose up -d --no-deps <svc>
 * — geste HORS de scripts/deploy.mjs (réservé aux IMAGES applicatives + DORA prod),
 * donc NON tracé et exposé à deux pièges déjà rencontrés (Phase 4) :
 *   1. `--no-deps` est OBLIGATOIRE : sans lui, Compose réconcilie les dépendances
 *      (prometheus → alertmanager) et casse si un secret de source `environment`
 *      (ALERTMANAGER_SMTP_PASSWORD) manque transitoirement.
 *   2. Un conteneur FANTÔME (renommé / orphelin de même nom) bloque la recréation
 *      (« container name already in use ») → il faut le stop+rm explicitement.
 *
 * CE QUE FAIT CE SCRIPT, en UNE commande :
 *   A. RECRÉE proprement la pile d'observabilité (grafana, prometheus, alertmanager,
 *      otel-collector, tempo, nats-exporter, blackbox-exporter) avec `--no-deps`
 *      et `--force-recreate` (un changement de config bind-mountée n'est appliqué
 *      qu'en RECRÉANT le conteneur — Compose ne détecte pas un fichier modifié),
 *      en nettoyant automatiquement un éventuel conteneur fantôme avant de réessayer.
 *   B. VÉRIFIE l'état RÉEL (au-delà de « running ») :
 *        • conteneurs présents et en cours d'exécution ;
 *        • règles Prometheus chargées (`/api/v1/rules` → au moins une règle) ;
 *        • Alertmanager découvert par Prometheus (`/api/v1/alertmanagers`) ;
 *        • datasource Grafana Infinity « Health check successful »
 *          (`/api/datasources/uid/infinity-github-deploys/health` → status OK) —
 *          c'est le canari de l'`allowedHosts` + du token DORA (Phase 4).
 *   C. ENREGISTRE (optionnel, best-effort) un GitHub Deployment `environment=observability`
 *      → l'application de config redevient TRAÇABLE (DORA n'est plus aveugle dessus).
 *      Désactivable par OBS_TRACK=0 ; ignoré si GH_DEPLOYMENTS_TOKEN absent.
 *
 * Les conteneurs d'observabilité n'ont PAS de healthcheck embarqué (vérifié serveur) :
 * `up --wait` ne garantit donc que « running ». Ce sont les sondes HTTP ci-dessus
 * (avec réessais) qui constituent la VRAIE vérification de disponibilité.
 *
 * NON-BLOCAGE TÉLÉMÉTRIE (comme deploy.mjs) : un échec de l'API GitHub n'avorte
 * jamais l'application ; à l'inverse, un échec de RECRÉATION ou de VÉRIFICATION est
 * fatal (statut `failure`, sortie 1).
 *
 * Zéro dépendance (Node ESM pur, `fetch` natif). Lancé SUR LE SERVEUR avec les
 * variables de .env.server exportées (le wrapper remote-apply-observability.ps1 /
 * .sh fait `set -a; . .env.server; set +a`).
 *
 *   # appliquer + vérifier la pile d'obs de prod
 *   set -a; . ./.env.server; set +a; node scripts/apply-observability.mjs
 *   # vérifier SANS recréer (audit de l'état courant)
 *   OBS_APPLY=0 node scripts/apply-observability.mjs
 *   # répétition à blanc (ni Docker ni API)
 *   OBS_DRY_RUN=1 node scripts/apply-observability.mjs
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- Configuration ----------------------------------------------------------
const REPO = process.env.GITHUB_REPOSITORY ?? 'EdouardZemb/creche-planner';
const TOKEN = process.env.GH_DEPLOYMENTS_TOKEN ?? '';
const ENVIRONMENT = process.env.OBS_ENVIRONMENT ?? 'observability';
const DRY_RUN =
  process.env.OBS_DRY_RUN === '1' || process.env.DORA_DRY_RUN === '1';
// Étapes activables : A. recréer (OBS_APPLY=0 → vérification seule), C. tracer
// (OBS_TRACK=0 → pas de GitHub Deployment).
const APPLY = process.env.OBS_APPLY !== '0';
const TRACK = process.env.OBS_TRACK !== '0';

// Fichiers compose + env-file : mêmes conventions que deploy.mjs (défaut = PROD).
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

// Services d'observabilité à recréer. Défaut = la pile d'obs complète (mêmes 7
// services que le boot « obs-seul » du job CI config-validation, Phase 5/6).
// Surchargeable pour cibler un sous-ensemble : OBS_SERVICES="prometheus grafana".
const OBS_SERVICES = (
  process.env.OBS_SERVICES ??
  'otel-collector tempo prometheus alertmanager nats-exporter blackbox-exporter loki promtail grafana'
)
  .trim()
  .split(/\s+/)
  .filter(Boolean);

const GRAFANA_USER = process.env.GRAFANA_ADMIN_USER || 'admin';
const GRAFANA_PWD = process.env.GRAFANA_ADMIN_PWD || '';
const INFINITY_UID = process.env.OBS_INFINITY_UID || 'infinity-github-deploys';
// Réessais des sondes HTTP : les conteneurs n'ont pas de healthcheck → après une
// recréation, laisser le service démarrer (Grafana + install plugin = le plus lent).
const PROBE_RETRIES = Number(process.env.OBS_PROBE_RETRIES || '20');
const PROBE_DELAY_MS = Number(process.env.OBS_PROBE_DELAY_MS || '3000');

// --- Utilitaires ------------------------------------------------------------

/** Exécute une commande (stdio hérité). Retourne le code de sortie. */
function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  if (DRY_RUN) {
    console.log('  (OBS_DRY_RUN — commande non exécutée)');
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

/**
 * Comme run() mais CAPTURE (et ré-affiche) stdout+stderr. Retourne {code, out}.
 * Utile pour détecter un conflit de nom (conteneur fantôme) dans la sortie de
 * `compose up`, tout en gardant la trace lisible.
 */
function runCapture(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  if (DRY_RUN) {
    console.log('  (OBS_DRY_RUN — commande non exécutée)');
    return { code: 0, out: '' };
  }
  const r = spawnSync(cmd, args, { cwd: RACINE, encoding: 'utf8', ...opts });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (out.trim()) console.log(out.trimEnd());
  if (r.error) {
    console.error(`  ✗ ${r.error.message}`);
    return { code: 1, out };
  }
  return { code: r.status ?? 1, out };
}

/** Comme run() mais capture stdout (trim). '' si échec/dry-run. */
function capture(cmd, args) {
  if (DRY_RUN) return '';
  const r = spawnSync(cmd, args, { cwd: RACINE, encoding: 'utf8' });
  return r.status === 0 ? (r.stdout ?? '').trim() : '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Appel API GitHub best-effort, avec réessais sur erreur TRANSITOIRE (réseau, 5xx) —
 * identique à deploy.mjs (NON-BLOCAGE TÉLÉMÉTRIE). Retourne le JSON, ou null si KO.
 */
async function gh(method, path, body, { retries = 3 } = {}) {
  if (!TOKEN) {
    console.warn(
      `  ⚠️ GH_DEPLOYMENTS_TOKEN absent → ${method} ${path} ignoré (application NON tracée).`,
    );
    return null;
  }
  if (DRY_RUN) {
    console.log(`  (OBS_DRY_RUN — ${method} ${path} non envoyé)`);
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
          'User-Agent': 'creche-planner-apply-observability',
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      if (res.ok) return text ? JSON.parse(text) : {};
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
    if (essai < retries) await sleep(1000 * 2 ** (essai - 1));
  }
  return null;
}

// --- Suivi DORA (GitHub Deployment env=observability) -----------------------

let deploymentId = null;

async function creerDeploiement(ref) {
  if (!TRACK) {
    console.log('  ↪ suivi GitHub Deployment désactivé (OBS_TRACK=0).');
    return;
  }
  console.log(
    `\n▶ Enregistrement de l'application (env=${ENVIRONMENT}, ref=${ref})`,
  );
  const dep = await gh('POST', '/deployments', {
    ref,
    environment: ENVIRONMENT,
    description: `Application config observabilité (${OBS_SERVICES.join(', ')})`,
    auto_merge: false,
    required_contexts: [],
    production_environment: false,
    // Env de config (pas une appli déployée) : ne le compte pas comme un
    // déploiement de prod « éphémère » non plus → environnement persistant.
    transient_environment: false,
  });
  deploymentId = dep?.id ?? null;
  if (deploymentId) {
    console.log(`  ✓ Deployment #${deploymentId} créé.`);
    await statut('in_progress');
  }
}

async function statut(state, description) {
  if (!deploymentId) return false;
  const res = await gh('POST', `/deployments/${deploymentId}/statuses`, {
    state,
    environment: ENVIRONMENT,
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
        `-f state=${state} -f environment=${ENVIRONMENT}`,
    );
  }
  return false;
}

/** Ref consigné sur le Deployment = SHA du commit appliqué (la config vit dans Git). */
function resoudreRef() {
  if (process.env.DEPLOY_REF) return process.env.DEPLOY_REF;
  return capture('git', ['rev-parse', 'HEAD']) || 'HEAD';
}

// --- A. Recréation idempotente ---------------------------------------------

/**
 * Détecte les conteneurs en conflit de nom (fantômes) dans la sortie de `compose up` :
 * « Conflict. The container name "/creche-planner-grafana-1" is already in use… ».
 */
function detecterConflits(out) {
  const re = /container name "\/?([^"]+)" is already in use/gi;
  const noms = new Set();
  let m;
  while ((m = re.exec(out))) noms.add(m[1]);
  return [...noms];
}

/**
 * RECRÉE les services d'obs : `up -d --wait --no-deps --force-recreate`.
 *   • `--no-deps` : ne touche QUE ces services, sans réconcilier leurs dépendances
 *     (piège Phase 4 : prometheus → alertmanager casse sur le secret SMTP manquant).
 *   • `--force-recreate` : un changement de config bind-mountée n'est appliqué qu'en
 *     RECRÉANT le conteneur (Compose ne redémarre pas sur un simple fichier modifié).
 *   • Sur conflit de nom (conteneur fantôme), supprime l'intrus et réessaie UNE fois.
 * Retourne 0 si tout est (re)monté, sinon non-zéro.
 */
function recreer() {
  const args = [
    'compose',
    ...COMPOSE,
    'up',
    '-d',
    '--wait',
    '--no-deps',
    '--force-recreate',
    ...OBS_SERVICES,
  ];
  const premier = runCapture('docker', args);
  let code = premier.code;
  if (code !== 0) {
    const fantomes = detecterConflits(premier.out);
    if (fantomes.length) {
      console.warn(
        `\n  ⚠️ Conflit de nom (conteneur fantôme) : ${fantomes.join(', ')} → suppression et nouvelle tentative.`,
      );
      for (const n of fantomes) run('docker', ['rm', '-f', n]);
      code = runCapture('docker', args).code;
    }
  }
  return code;
}

// --- B. Vérifications -------------------------------------------------------

/** Premier conteneur d'un service (ps -q peut rendre plusieurs lignes). '' si aucun. */
function premierCid(svc) {
  const cid = capture('docker', ['compose', ...COMPOSE, 'ps', '-q', svc]);
  return cid ? cid.split('\n')[0].trim() : '';
}

/** Sonde HTTP exécutée DANS un conteneur (busybox wget). Réessaie jusqu'à succès. */
async function sonde(libelle, cid, url, extraArgs = []) {
  if (DRY_RUN) {
    console.log(`  (OBS_DRY_RUN — sonde « ${libelle} » non exécutée)`);
    return '';
  }
  for (let essai = 1; essai <= PROBE_RETRIES; essai++) {
    const r = spawnSync(
      'docker',
      ['exec', cid, 'wget', '-q', '-O-', ...extraArgs, url],
      { cwd: RACINE, encoding: 'utf8' },
    );
    if (r.status === 0 && (r.stdout ?? '').trim())
      return (r.stdout ?? '').trim();
    if (essai < PROBE_RETRIES) await sleep(PROBE_DELAY_MS);
  }
  return '';
}

/** Conteneurs présents et « running » (pas de healthcheck embarqué sur l'obs). */
function verifierConteneurs() {
  console.log('\n▶ Vérification — conteneurs en cours d’exécution');
  if (DRY_RUN) {
    console.log('  (OBS_DRY_RUN — vérification simulée OK)');
    return true;
  }
  let ok = true;
  for (const svc of OBS_SERVICES) {
    const cid = premierCid(svc);
    if (!cid) {
      console.error(`  ✗ ${svc} : aucun conteneur`);
      ok = false;
      continue;
    }
    const etat = capture('docker', [
      'inspect',
      '--format',
      '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}',
      cid,
    ]);
    const [status, health] = etat.split('|');
    const sain =
      status === 'running' && (health === 'healthy' || health === '-');
    console.log(
      `  ${sain ? '✓' : '✗'} ${svc} : ${status}${health && health !== '-' ? ` (${health})` : ''}`,
    );
    if (!sain) ok = false;
  }
  return ok;
}

/** Règles Prometheus chargées : `/api/v1/rules` → au moins une règle. */
async function verifierReglesPrometheus() {
  console.log('\n▶ Vérification — règles Prometheus chargées');
  const cid = premierCid('prometheus');
  if (!cid && !DRY_RUN) {
    console.error('  ✗ conteneur prometheus introuvable.');
    return false;
  }
  const body = await sonde('rules', cid, 'http://127.0.0.1:9090/api/v1/rules');
  if (DRY_RUN) return true;
  try {
    const j = JSON.parse(body);
    const groupes = j?.data?.groups ?? [];
    const nbRegles = groupes.reduce((n, g) => n + (g.rules?.length ?? 0), 0);
    const ok = j.status === 'success' && nbRegles > 0;
    console.log(
      `  ${ok ? '✓' : '✗'} ${groupes.length} groupe(s), ${nbRegles} règle(s) chargée(s).`,
    );
    return ok;
  } catch {
    console.error(`  ✗ réponse /rules inattendue : ${body.slice(0, 160)}`);
    return false;
  }
}

/** Alertmanager découvert par Prometheus : `/api/v1/alertmanagers` non vide. */
async function verifierAlertmanagerDecouvert() {
  console.log('\n▶ Vérification — Alertmanager découvert par Prometheus');
  const cid = premierCid('prometheus');
  if (!cid && !DRY_RUN) {
    console.error('  ✗ conteneur prometheus introuvable.');
    return false;
  }
  const body = await sonde(
    'alertmanagers',
    cid,
    'http://127.0.0.1:9090/api/v1/alertmanagers',
  );
  if (DRY_RUN) return true;
  try {
    const j = JSON.parse(body);
    const actifs = j?.data?.activeAlertmanagers ?? [];
    const ok = j.status === 'success' && actifs.length > 0;
    console.log(
      `  ${ok ? '✓' : '✗'} ${actifs.length} Alertmanager actif(s)` +
        (actifs[0]?.url ? ` (${actifs[0].url})` : '') +
        '.',
    );
    return ok;
  } catch {
    console.error(
      `  ✗ réponse /alertmanagers inattendue : ${body.slice(0, 160)}`,
    );
    return false;
  }
}

/**
 * Datasource Grafana Infinity « Health check successful » : c'est le canari de
 * l'`allowedHosts` (Infinity v2+) ET du token DORA — un changement de
 * datasources.yaml qui casse l'un OU l'autre est attrapé ici (régression Phase 4).
 * Ignoré (informatif) si aucun mot de passe admin n'est fourni (profil dev/anonyme).
 */
async function verifierDatasourceInfinity() {
  console.log(
    '\n▶ Vérification — datasource Grafana Infinity (annotations DORA)',
  );
  if (process.env.OBS_SKIP_GRAFANA === '1') {
    console.log('  ↪ ignoré (OBS_SKIP_GRAFANA=1).');
    return true;
  }
  if (!GRAFANA_PWD && !DRY_RUN) {
    console.warn(
      '  ⚠️ GRAFANA_ADMIN_PWD absent → datasource Infinity NON vérifiée (profil dev/anonyme ?).',
    );
    return true;
  }
  const cid = premierCid('grafana');
  if (!cid && !DRY_RUN) {
    console.error('  ✗ conteneur grafana introuvable.');
    return false;
  }
  const auth = Buffer.from(`${GRAFANA_USER}:${GRAFANA_PWD}`).toString('base64');
  const body = await sonde(
    'infinity-health',
    cid,
    `http://127.0.0.1:3000/api/datasources/uid/${INFINITY_UID}/health`,
    ['--header', `Authorization: Basic ${auth}`],
  );
  if (DRY_RUN) return true;
  try {
    const j = JSON.parse(body);
    const ok = j.status === 'OK';
    console.log(
      `  ${ok ? '✓' : '✗'} datasource « ${INFINITY_UID} » : ${j.status} — ${j.message}`,
    );
    return ok;
  } catch {
    console.error(
      `  ✗ santé datasource Infinity injoignable / échouée : ${body.slice(0, 160) || '(réponse vide — token / allowedHosts ?)'}`,
    );
    return false;
  }
}

// --- Orchestration ----------------------------------------------------------

async function terminer(echec, ref) {
  if (echec) {
    await statut(
      'failure',
      `Application config observabilité ÉCHOUÉE (${ref}).`.slice(0, 140),
    );
    console.error(
      '\n❌ Application de la config d’observabilité ÉCHOUÉE — voir les ✗ ci-dessus.',
    );
    process.exit(1);
  }
  const trace = await statut(
    'success',
    `Config observabilité appliquée et vérifiée (${ref}).`.slice(0, 140),
  );
  console.log(
    '\n✅ Config d’observabilité APPLIQUÉE et VÉRIFIÉE.' +
      (!TRACK
        ? ' (suivi désactivé)'
        : !deploymentId
          ? ' (NON tracé : pas de token)'
          : trace
            ? ` (Deployment #${deploymentId} tracé → DORA)`
            : ` (⚠️ Deployment #${deploymentId} créé mais statut success NON enregistré)`),
  );
  process.exit(0);
}

async function main() {
  console.log(
    '═══ Application config observabilité creche-planner (Phase 9) ═══',
  );
  console.log(
    `  dépôt=${REPO} · env=${ENVIRONMENT} · services=[${OBS_SERVICES.join(' ')}]`,
  );
  console.log(
    `  compose=[${COMPOSE_FILES.join(' ')}] · env-file=${ENV_FILE}` +
      `${APPLY ? '' : ' · OBS_APPLY=0 (vérification seule)'}`,
  );
  if (DRY_RUN) console.log('  MODE OBS_DRY_RUN : aucune action réelle.');

  const ref = resoudreRef();
  await creerDeploiement(ref);

  // A. Recréation idempotente (sautable : OBS_APPLY=0 = audit de l'état courant).
  if (APPLY) {
    console.log(
      '\n▶ Recréation de la pile d’observabilité (--no-deps --force-recreate)',
    );
    if (recreer() !== 0) {
      await terminer(true, ref);
      return;
    }
  } else {
    console.log('\n▶ OBS_APPLY=0 — recréation SAUTÉE (vérification seule).');
  }

  // B. Vérifications (on les exécute TOUTES pour un rapport complet, puis on tranche).
  const resultats = [
    verifierConteneurs(),
    await verifierReglesPrometheus(),
    await verifierAlertmanagerDecouvert(),
    await verifierDatasourceInfinity(),
  ];
  const echec = resultats.some((ok) => !ok);

  await terminer(echec, ref);
}

main().catch(async (e) => {
  console.error(`\n❌ Échec inattendu : ${e.message}`);
  try {
    await statut('error', `Erreur inattendue : ${e.message}`.slice(0, 140));
  } catch {
    /* best-effort */
  }
  process.exit(1);
});
