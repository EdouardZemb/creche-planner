#!/usr/bin/env node
// @ts-check
/**
 * POLLER de STAGING (Phase 8) — auto-déploiement de `:main` à chaque merge.
 *
 * Lancé périodiquement SUR LE SERVEUR (timer systemd, cf. scripts/systemd/) dans
 * le clone de staging. Respecte la topologie PULL-BASED (zéro port entrant) : le
 * serveur SONDE GHCR en SORTANT et tire l'image lui-même — aucun runner GitHub ne
 * pousse rien. C'est le pendant STAGING (tag mutable `:main`) du poller PROD/RELEASE
 * signé esquissé en doc 24 §9.3 et planifié en Phase 10 (garde-fous différents :
 * la prod n'auto-déploie QUE des versions semver signées ; le staging suit `:main`).
 *
 * MÉCANIQUE :
 *   1. Résout le DIGEST distant de `ghcr.io/.../api-gateway:${IMAGE_TAG}` (= `:main`)
 *      via `docker buildx imagetools inspect` (utilise le `docker login` du serveur).
 *   2. Le compare à un MARQUEUR local (~/.creche-staging-last-digest).
 *   3. Inchangé → ne fait RIEN (sortie 0, silencieux).
 *      Nouveau digest (ou 1er run) → lance `node scripts/deploy.mjs` (portes +
 *      GitHub Deployment d'env `staging`), puis écrit le marqueur — que le déploiement
 *      RÉUSSISSE OU ÉCHOUE. Chaque `:main` distinct est ainsi déployé/fumé UNE fois :
 *      un échec est un résultat VALIDE et tracé (« ce main est mauvais, ne pas
 *      promouvoir ») ; re-tester le même digest toutes les 5 min n'apprendrait rien,
 *      et le merge suivant produira un nouveau digest re-testé.
 *
 * Le VERROU anti-concurrence (flock) et le `source .env.staging` sont portés par le
 * wrapper scripts/staging-poll.sh (que le service systemd exécute) — ce script-ci se
 * concentre sur « digest changé ? → déployer → marquer ». Zéro dépendance (Node ESM).
 *
 * Variables : IMAGE_TAG (défaut `main`), STAGING_DIGEST_MARKER (défaut
 * $HOME/.creche-staging-last-digest), STAGING_FORCE=1 (ignore le marqueur, force le
 * déploiement), DORA_DRY_RUN=1 (ni inspect ni déploiement — trace seulement).
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

const IMAGE_TAG = process.env.IMAGE_TAG ?? 'main';
const IMAGE_REF = `ghcr.io/edouardzemb/creche-planner/api-gateway:${IMAGE_TAG}`;
const MARKER =
  process.env.STAGING_DIGEST_MARKER ||
  join(homedir(), '.creche-staging-last-digest');
const FORCE = process.env.STAGING_FORCE === '1';
const DRY_RUN = process.env.DORA_DRY_RUN === '1';

/**
 * Digest distant (index OCI) du tag `:main` = sha256 du manifeste BRUT.
 * On NE se fie PAS à `--format '{{.Manifest.Digest}}'` : selon la version de buildx
 * (ex. 0.13.x sur le serveur), ce gabarit est IGNORÉ et imprime la sortie humaine
 * → la sonde renvoyait '' à tort. Or le digest d'un manifeste EST le sha256 de ses
 * octets bruts (`--raw`) : méthode canonique, indépendante de la version de buildx.
 * '' si la sonde échoue (réseau / login GHCR manquant).
 */
function digestDistant() {
  if (DRY_RUN) return 'sha256:dry-run';
  // stdout en Buffer (aucun `encoding`) pour hasher les OCTETS EXACTS du manifeste.
  const r = spawnSync(
    'docker',
    ['buildx', 'imagetools', 'inspect', IMAGE_REF, '--raw'],
    { cwd: RACINE },
  );
  if (r.status !== 0 || !r.stdout || r.stdout.length === 0) {
    console.error(
      `  ✗ Impossible de résoudre le digest de ${IMAGE_REF} :\n${(r.stderr?.toString() || '').trim()}`,
    );
    return '';
  }
  return 'sha256:' + createHash('sha256').update(r.stdout).digest('hex');
}

/** Marqueur local du dernier digest déployé. '' si absent. */
function marqueurLocal() {
  try {
    return readFileSync(MARKER, 'utf8').trim();
  } catch {
    return '';
  }
}

function ecrireMarqueur(digest) {
  if (DRY_RUN) {
    console.log(`  (DORA_DRY_RUN — marqueur non écrit : ${digest})`);
    return;
  }
  try {
    writeFileSync(MARKER, `${digest}\n`, 'utf8');
  } catch (e) {
    console.warn(
      `  ⚠️ Écriture du marqueur ${MARKER} impossible : ${e.message}`,
    );
  }
}

function main() {
  console.log('═══ Poller staging creche-planner (Phase 8) ═══');
  console.log(`  image=${IMAGE_REF} · marqueur=${MARKER}`);

  const distant = digestDistant();
  if (!distant) {
    // Sonde KO (réseau/login GHCR) : on n'écrit PAS le marqueur → réessai au
    // prochain tick. Sortie non nulle pour que journalctl/systemd la voie.
    console.error(
      '  ✗ Sonde du digest distant échouée — abandon (réessai au prochain tick).',
    );
    process.exit(1);
  }
  const local = marqueurLocal();
  console.log(`  digest distant : ${distant}`);
  console.log(`  digest déployé : ${local || '(aucun — 1er run)'}`);

  if (distant === local && !FORCE) {
    console.log('  ✓ Staging déjà à jour — rien à faire.');
    return;
  }
  if (FORCE) console.log('  ↻ STAGING_FORCE=1 — déploiement forcé.');

  console.log(`\n▶ Nouveau \`:${IMAGE_TAG}\` détecté → déploiement staging…`);
  const r = spawnSync('node', ['scripts/deploy.mjs'], {
    cwd: RACINE,
    stdio: 'inherit',
    env: process.env,
  });
  const ok = r.status === 0;

  // On marque le digest TENTÉ quel que soit le verdict (chaque main testé une fois).
  ecrireMarqueur(distant);

  if (ok) {
    console.log(
      `\n✅ Staging déployé/fumé sur \`:${IMAGE_TAG}\` (${distant}).`,
    );
  } else {
    console.error(
      `\n❌ Déploiement staging de \`:${IMAGE_TAG}\` ÉCHOUÉ (code ${r.status ?? '?'}) — ` +
        'ce main NE doit PAS être promu. Voir la sortie ci-dessus + le GitHub Deployment (env staging).',
    );
  }
  process.exit(ok ? 0 : 1);
}

main();
