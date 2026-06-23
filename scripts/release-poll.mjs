#!/usr/bin/env node
// @ts-check
/**
 * POLLER de PRODUCTION (Phase 10) — auto-déploiement des GitHub Releases SIGNÉES.
 *
 * Lancé périodiquement SUR LE SERVEUR (timer systemd, cf. scripts/systemd/) dans le
 * clone de PROD. Supprime la dépendance au poste de dev (bus factor de la Phase 3 :
 * `remote-deploy.ps1` exige le poste Windows + sa clé dans le ssh-agent) tout en
 * PRÉSERVANT la topologie PULL-BASED (zéro port entrant) : le serveur SONDE l'API
 * GitHub Releases en SORTANT et tire l'image lui-même — aucun runner ne pousse rien.
 *
 * C'est le pendant PROD du poller STAGING (scripts/staging-poll.mjs, Phase 8). La
 * différence tient aux GARDE-FOUS, car ici la cible est la PRODUCTION :
 *   - STAGING suit le tag MUTABLE `:main` (sonde le digest GHCR) et déploie tout `:main` ;
 *   - PROD ne déploie QUE des VERSIONS SEMVER FIGÉES (`0.x.y`) issues d'une GitHub
 *     Release publiée — donc des artefacts immuables et SIGNÉS cosign (release.yml).
 *
 * MÉCANIQUE :
 *   1. Interroge `GET /repos/<repo>/releases/latest` (SORTANT, repo public → auth
 *      optionnelle ; le token élève juste la limite de débit).
 *   2. Décompose le tag `{projet}@{version}` (release train) → extrait la VERSION.
 *      GARDE-FOUS : ignore draft/prerelease ; REFUSE tout tag non-semver strict
 *      (`main`/`latest`/suffixe pré-release) — on n'auto-déploie qu'un artefact figé.
 *   3. Compare à la BASELINE (marqueur ~/.creche-last-deployed, initialisée au 1er run
 *      depuis le label OCI du conteneur gateway en place). ROLL-FORWARD UNIQUEMENT :
 *      ne déploie QUE si la release est STRICTEMENT supérieure (semver) à la baseline.
 *      Un downgrade (rollback) reste un GESTE MANUEL DÉLIBÉRÉ (remote-deploy.ps1).
 *   4. Nouvelle version → lance `IMAGE_TAG=<version> DEPLOY_VERIFY_COSIGN=1 node
 *      scripts/deploy.mjs` (portes 1bis→3 + rollback auto Phase 7 + GitHub Deployment
 *      prod → DORA). La signature cosign est vérifiée par deploy.mjs (Porte 1bis) AVANT
 *      tout `up` : une release non signée est REFUSÉE. On force `DEPLOY_VERIFY_COSIGN=1`
 *      ici même (défense en profondeur, indépendamment de .env.server).
 *      - SUCCÈS → écrit la baseline = version déployée.
 *      - ÉCHEC → incrémente un compteur de tentatives pour cette version. On RÉESSAIE
 *        (transitoire : 6 images encore en cours de push, signature pas encore posée…)
 *        jusqu'à RELEASE_MAX_ATTEMPTS, puis on ABANDONNE bruyamment (intervention
 *        requise). La prod, elle, est protégée par le rollback auto de deploy.mjs.
 *
 * Le VERROU anti-concurrence (flock, MÊME verrou que remote-deploy → /tmp/creche-deploy.lock)
 * et le `source .env.server` sont portés par le wrapper scripts/release-poll.sh (que le
 * service systemd exécute). Zéro dépendance (Node ESM, `fetch` natif).
 *
 * Variables :
 *   GH_DEPLOYMENTS_TOKEN     token (optionnel) pour la limite de débit GitHub.
 *   GITHUB_REPOSITORY        défaut `EdouardZemb/creche-planner`.
 *   RELEASE_MARKER           baseline (défaut $HOME/.creche-last-deployed).
 *   RELEASE_ATTEMPTS_FILE    compteur de tentatives (défaut $HOME/.creche-release-attempts).
 *   RELEASE_MAX_ATTEMPTS     tentatives avant abandon (défaut 3).
 *   RELEASE_FORCE=1          ignore baseline + abandon (re-déploie la release latest).
 *   DORA_DRY_RUN=1           ne touche ni Docker ni le marqueur ; trace seulement.
 *   RELEASE_FAKE_TAG=<tag>   (TEST, dry-run) tag de la « release » simulée.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

const REPO = process.env.GITHUB_REPOSITORY ?? 'EdouardZemb/creche-planner';
const TOKEN = process.env.GH_DEPLOYMENTS_TOKEN ?? '';
const MARKER =
  process.env.RELEASE_MARKER || join(homedir(), '.creche-last-deployed');
const ATTEMPTS_FILE =
  process.env.RELEASE_ATTEMPTS_FILE ||
  join(homedir(), '.creche-release-attempts');
const MAX_ATTEMPTS = Number(process.env.RELEASE_MAX_ATTEMPTS || '3');
const FORCE = process.env.RELEASE_FORCE === '1';
const DRY_RUN = process.env.DORA_DRY_RUN === '1';

// Fichiers compose + env-file de PROD (mêmes défauts que deploy.mjs) — utilisés
// seulement pour lire la version EN PLACE (label OCI du conteneur gateway).
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

// Semver strict `MAJOR.MINOR.PATCH` (sans suffixe pré-release/build) : on n'AUTO-déploie
// qu'une version figée et stable. Tout le reste (main/latest, `0.2.0-rc.1`, …) est refusé.
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** Capture stdout (trim). '' si échec/dry-run. */
function capture(cmd, args) {
  if (DRY_RUN) return '';
  const r = spawnSync(cmd, args, { cwd: RACINE, encoding: 'utf8' });
  return r.status === 0 ? (r.stdout ?? '').trim() : '';
}

/** Compare deux versions semver. Retourne >0 si a>b, 0 si égales, <0 si a<b. -99 si non-semver. */
function cmpSemver(a, b) {
  const ma = SEMVER.exec(a);
  const mb = SEMVER.exec(b);
  if (!ma || !mb) return -99;
  for (let i = 1; i <= 3; i++) {
    const d = Number(ma[i]) - Number(mb[i]);
    if (d !== 0) return d;
  }
  return 0;
}

/** Tag de release `{projet}@{version}` → version (après le DERNIER `@`). */
function versionDuTag(tag) {
  const v = tag.includes('@') ? tag.slice(tag.lastIndexOf('@') + 1) : tag;
  return v.trim();
}

/**
 * Dernière GitHub Release publiée (objet API), ou :
 *   - null      : aucune release publiée (HTTP 404) — rien à faire.
 *   - undefined : erreur TRANSITOIRE (réseau, 5xx) — réessayer au prochain tick.
 * Repo public → auth optionnelle ; on tente AVEC token (limite de débit élevée) puis
 * SANS si 401/403 (token sans le scope Contents).
 */
async function derniereRelease() {
  if (DRY_RUN) {
    const tag = process.env.RELEASE_FAKE_TAG || 'web@9.9.9';
    console.log(`  (DORA_DRY_RUN — release simulée : ${tag})`);
    return { tag_name: tag, draft: false, prerelease: false };
  }
  const base = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'creche-planner-release-poll',
  };
  for (const useAuth of TOKEN ? [true, false] : [false]) {
    const headers = useAuth
      ? { ...base, Authorization: `Bearer ${TOKEN}` }
      : base;
    try {
      const res = await fetch(
        `https://api.github.com/repos/${REPO}/releases/latest`,
        { headers },
      );
      if (res.status === 404) return null; // aucune release publiée
      if (res.ok) return await res.json();
      if ((res.status === 401 || res.status === 403) && useAuth) {
        console.warn(
          `  ⚠️ releases/latest → HTTP ${res.status} avec token → nouvel essai sans auth (repo public).`,
        );
        continue;
      }
      console.error(`  ✗ API GitHub releases/latest → HTTP ${res.status}.`);
      return undefined;
    } catch (e) {
      console.error(
        `  ✗ API GitHub injoignable (releases/latest) : ${e.message}`,
      );
      return undefined;
    }
  }
  return undefined;
}

/**
 * Version actuellement EN PLACE en prod (baseline implicite), lue depuis le label OCI
 * du conteneur gateway. Priorité au semver de train (`image.version`). '' si aucun
 * conteneur (serveur vierge) ⇒ la 1re release publiée sera déployée.
 */
function versionEnPlace() {
  const cid = capture('docker', [
    'compose',
    ...COMPOSE,
    'ps',
    '-q',
    'api-gateway',
  ]);
  if (!cid) return '';
  const conteneur = cid.split('\n')[0].trim();
  const v = capture('docker', [
    'inspect',
    conteneur,
    '--format',
    '{{ index .Config.Labels "org.opencontainers.image.version" }}',
  ]);
  return v && v !== '<no value>' ? v : '';
}

/** Lit un fichier texte (trim). '' si absent. */
function lire(fichier) {
  try {
    return readFileSync(fichier, 'utf8').trim();
  } catch {
    return '';
  }
}

function ecrireBaseline(version) {
  if (DRY_RUN) {
    console.log(`  (DORA_DRY_RUN — baseline non écrite : ${version})`);
    return;
  }
  try {
    writeFileSync(MARKER, `${version}\n`, 'utf8');
  } catch (e) {
    console.warn(
      `  ⚠️ Écriture de la baseline ${MARKER} impossible : ${e.message}`,
    );
  }
}

/** Compteur de tentatives pour la version EN COURS de déploiement. */
function lireTentatives() {
  try {
    const o = JSON.parse(readFileSync(ATTEMPTS_FILE, 'utf8'));
    return { version: String(o.version || ''), count: Number(o.count || 0) };
  } catch {
    return { version: '', count: 0 };
  }
}

function ecrireTentatives(version, count) {
  if (DRY_RUN) return;
  try {
    writeFileSync(ATTEMPTS_FILE, JSON.stringify({ version, count }), 'utf8');
  } catch (e) {
    console.warn(
      `  ⚠️ Écriture du compteur ${ATTEMPTS_FILE} impossible : ${e.message}`,
    );
  }
}

function effacerTentatives() {
  if (DRY_RUN) return;
  try {
    unlinkSync(ATTEMPTS_FILE);
  } catch {
    /* absent → rien à faire */
  }
}

async function main() {
  console.log('═══ Poller release/prod creche-planner (Phase 10) ═══');
  console.log(`  dépôt=${REPO} · baseline=${MARKER}`);

  const release = await derniereRelease();
  if (release === undefined) {
    // Erreur transitoire : ne RIEN écrire → réessai au prochain tick.
    console.error(
      '  ✗ Sonde des releases échouée — abandon (réessai au prochain tick).',
    );
    process.exit(1);
  }
  if (release === null) {
    console.log('  ✓ Aucune GitHub Release publiée — rien à déployer.');
    return;
  }
  if (release.draft || release.prerelease) {
    console.log(
      `  ✓ Dernière release « ${release.tag_name} » est ${release.draft ? 'un brouillon' : 'une pré-release'} — ignorée.`,
    );
    return;
  }

  const version = versionDuTag(release.tag_name);
  // GARDE-FOU : refus de tout ce qui n'est pas un semver figé (main/latest, rc, …).
  if (!SEMVER.test(version)) {
    console.error(
      `  ✗ Tag « ${release.tag_name} » → version « ${version} » NON semver figée — REFUSÉ ` +
        "(on n'auto-déploie qu'un artefact immuable `0.x.y`).",
    );
    process.exit(1);
  }

  // Baseline : marqueur, sinon version EN PLACE (1er run → on s'aligne sur la prod
  // sans redéployer), sinon vide (serveur vierge → on déploiera la release).
  let baseline = lire(MARKER);
  if (!baseline) {
    baseline = versionEnPlace();
    if (baseline) {
      console.log(
        `  ↪ Baseline initialisée depuis le conteneur en place : ${baseline}`,
      );
      ecrireBaseline(baseline);
    }
  }
  console.log(`  release publiée : ${version}`);
  console.log(
    `  version déployée : ${baseline || '(aucune — serveur vierge)'}`,
  );

  if (baseline && SEMVER.test(baseline)) {
    // Comparaison semver fiable seulement si la baseline EST elle-même un semver.
    // (Une baseline non-semver — ex. un SHA déployé hors release — n'est pas
    // comparable : on la traite comme « pas de plancher » → on roule en avant.)
    const cmp = cmpSemver(version, baseline);
    if (cmp === 0 && !FORCE) {
      console.log('  ✓ Prod déjà à jour sur cette version — rien à faire.');
      return;
    }
    if (cmp < 0 && !FORCE) {
      // ROLL-FORWARD UNIQUEMENT : on n'auto-rétrograde JAMAIS. Un rollback est un
      // geste manuel délibéré (remote-deploy.ps1 -ImageTag <version_précédente>).
      console.warn(
        `  ⚠️ Release latest (${version}) < version déployée (${baseline}) — IGNORÉE ` +
          '(le poller ne fait que ROULER EN AVANT ; un rollback est un geste manuel).',
      );
      return;
    }
  }
  if (FORCE) console.log('  ↻ RELEASE_FORCE=1 — déploiement forcé.');

  // Budget de réessais (anti-churn sur une release durablement cassée).
  const t = lireTentatives();
  if (t.version === version && t.count >= MAX_ATTEMPTS && !FORCE) {
    console.error(
      `  ✗ Version ${version} ABANDONNÉE après ${t.count} échec(s) (≥ RELEASE_MAX_ATTEMPTS=${MAX_ATTEMPTS}). ` +
        'Intervention requise (la prod est restée sur la version précédente via le rollback auto). ' +
        'Relancer avec RELEASE_FORCE=1 une fois la cause corrigée.',
    );
    return; // exit 0 : on cesse de marteler ; le journal porte l'alerte.
  }

  console.log(
    `\n▶ Nouvelle release ${version} → déploiement PROD (cosign vérifié)…`,
  );
  const r = spawnSync('node', ['scripts/deploy.mjs'], {
    cwd: RACINE,
    stdio: 'inherit',
    // On FORCE la vérification cosign ici (défense en profondeur) : seule une release
    // réellement SIGNÉE par notre pipeline est déployable.
    env: { ...process.env, IMAGE_TAG: version, DEPLOY_VERIFY_COSIGN: '1' },
  });
  const ok = r.status === 0;

  if (ok) {
    ecrireBaseline(version);
    effacerTentatives();
    console.log(
      `\n✅ Prod déployée sur la release ${version} (tracé DORA via deploy.mjs).`,
    );
    process.exit(0);
  }

  const count = (t.version === version ? t.count : 0) + 1;
  ecrireTentatives(version, count);
  console.error(
    `\n❌ Déploiement PROD de ${version} ÉCHOUÉ (code ${r.status ?? '?'}, tentative ${count}/${MAX_ATTEMPTS}). ` +
      'La prod a été restaurée par le rollback auto de deploy.mjs (Phase 7) si une porte est tombée après le pull. ' +
      "Réessai au prochain tick tant que le budget de tentatives n'est pas épuisé.",
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(`\n❌ Échec inattendu du poller release : ${e.message}`);
  process.exit(1);
});
