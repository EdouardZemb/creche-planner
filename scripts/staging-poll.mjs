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
 *   1. Résout le DIGEST distant de CHACUNE des images APPLICATIVES déployables
 *      (`ghcr.io/.../<projet>:${IMAGE_TAG}` = `:main`) via `docker buildx imagetools
 *      inspect --raw` (utilise le `docker login` du serveur), puis AGRÈGE ces digests
 *      en UN SEUL (sha256 de leur concaténation, dans un ordre stable trié).
 *      POURQUOI toutes les images et pas seulement api-gateway ? Le job CI `build-images`
 *      (nx affected) ne (re)construit/pousse QUE les images réellement touchées par un
 *      merge : un changement web-only laisse `api-gateway:main` au MÊME digest. Sonder la
 *      seule gateway ratait donc TOUT déploiement web-only (staging ne tirait jamais la
 *      nouvelle image `web`). L'agrégat bouge dès qu'AU MOINS une image change → n'importe
 *      quel merge déployable est désormais auto-déployé.
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

const IMAGE_TAG = process.env.IMAGE_TAG ?? 'main';
// Images APPLICATIVES déployables sur staging : lues depuis la source UNIQUE de
// topologie (scripts/services.json, audit 2026-07). La cohérence avec la liste
// `image:` de docker-compose.staging.yml est vérifiée à chaque tick
// (`verifierCoherenceCompose`) ; DEPLOY_UP_SERVICES de .env.staging reste à
// aligner côté serveur (garde-fou non bloquant dans deploy.mjs).
const TOPOLOGIE = JSON.parse(
  readFileSync(join(RACINE, 'scripts', 'services.json'), 'utf8'),
);
const REGISTRE = TOPOLOGIE.registre;
const PROJETS_DEPLOYABLES = TOPOLOGIE.servicesApplicatifs;
const IMAGE_REFS = PROJETS_DEPLOYABLES.map(
  (projet) => `${REGISTRE}/${projet}:${IMAGE_TAG}`,
);
const MARKER =
  process.env.STAGING_DIGEST_MARKER ||
  join(homedir(), '.creche-staging-last-digest');
const FORCE = process.env.STAGING_FORCE === '1';
const DRY_RUN = process.env.DORA_DRY_RUN === '1';

/**
 * Digest distant (index OCI) d'UNE image au tag `:main` = sha256 du manifeste BRUT.
 * On NE se fie PAS à `--format '{{.Manifest.Digest}}'` : selon la version de buildx
 * (ex. 0.13.x sur le serveur), ce gabarit est IGNORÉ et imprime la sortie humaine
 * → la sonde renvoyait '' à tort. Or le digest d'un manifeste EST le sha256 de ses
 * octets bruts (`--raw`) : méthode canonique, indépendante de la version de buildx.
 * '' si la sonde échoue (réseau / login GHCR manquant).
 */
function digestImage(ref) {
  // stdout en Buffer (aucun `encoding`) pour hasher les OCTETS EXACTS du manifeste.
  const r = spawnSync(
    'docker',
    ['buildx', 'imagetools', 'inspect', ref, '--raw'],
    { cwd: RACINE },
  );
  if (r.status !== 0 || !r.stdout || r.stdout.length === 0) {
    console.error(
      `  ✗ Impossible de résoudre le digest de ${ref} :\n${(r.stderr?.toString() || '').trim()}`,
    );
    return '';
  }
  return 'sha256:' + createHash('sha256').update(r.stdout).digest('hex');
}

/**
 * Agrège des digests d'images en UN digest DÉTERMINISTE (sha256 de leur concaténation
 * triée). Fonction PURE — exportée pour être unit-testable HORS serveur (le test de la
 * sonde GHCR elle-même est impossible sans le `docker login` du serveur) :
 *   - l'ORDRE des entrées n'influe pas sur le résultat (tri par ref) ;
 *   - la `ref` est incluse dans la chaîne hachée → deux images au même digest (artefacts
 *     identiques) restent distinguables, et ajouter/retirer une image change l'agrégat.
 * @param {Record<string, string>} digestsParRef  ref d'image → digest (`sha256:…`)
 * @returns {string} digest agrégé (`sha256:…`)
 */
export function agregerDigests(digestsParRef) {
  const lignes = Object.keys(digestsParRef)
    .sort()
    .map((ref) => `${ref}\t${digestsParRef[ref]}`);
  return (
    'sha256:' + createHash('sha256').update(lignes.join('\n')).digest('hex')
  );
}

/**
 * Digest AGRÉGÉ des images déployables au tag `:main`. '' si la sonde d'AU MOINS une
 * image échoue → le tick est abandonné proprement (marqueur intact, réessai au prochain)
 * plutôt que de marquer un état partiel/faux.
 */
function digestAgrege() {
  if (DRY_RUN) return 'sha256:dry-run';
  /** @type {Record<string, string>} */
  const digestsParRef = {};
  for (const ref of IMAGE_REFS) {
    const d = digestImage(ref);
    if (!d) return ''; // une sonde KO → on n'agrège pas un état partiel.
    digestsParRef[ref] = d;
  }
  return agregerDigests(digestsParRef);
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

/**
 * Vérifie que la liste `image:` de docker-compose.staging.yml correspond EXACTEMENT
 * aux `servicesApplicatifs` de scripts/services.json (source unique). Une dérive
 * (service ajouté au compose sans la source, ou l'inverse) faisait auparavant
 * dériver silencieusement la sonde de digest — on échoue désormais explicitement.
 */
function verifierCoherenceCompose() {
  const compose = readFileSync(
    join(RACINE, 'docker-compose.staging.yml'),
    'utf8',
  );
  const motif = new RegExp(`image:\\s*${REGISTRE}/([a-z0-9-]+):`, 'g');
  const duCompose = new Set([...compose.matchAll(motif)].map((m) => m[1]));
  const duJson = new Set(PROJETS_DEPLOYABLES);
  const manquants = [...duJson].filter((s) => !duCompose.has(s));
  const inconnus = [...duCompose].filter((s) => !duJson.has(s));
  if (manquants.length > 0 || inconnus.length > 0) {
    console.error(
      '  ✗ Dérive de topologie entre scripts/services.json et docker-compose.staging.yml :',
    );
    for (const s of manquants)
      console.error(
        `      - "${s}" attendu (services.json) mais absent du compose staging`,
      );
    for (const s of inconnus)
      console.error(
        `      - "${s}" présent dans le compose staging mais absent de services.json`,
      );
    console.error(
      '    → aligner les deux AVANT de poller (source unique : scripts/services.json).',
    );
    process.exit(1);
  }
}

function main() {
  console.log('═══ Poller staging creche-planner (Phase 8) ═══');
  verifierCoherenceCompose();
  console.log(
    `  images=${PROJETS_DEPLOYABLES.length} (${PROJETS_DEPLOYABLES.join(', ')}) @ :${IMAGE_TAG} · marqueur=${MARKER}`,
  );

  const distant = digestAgrege();
  if (!distant) {
    // Sonde KO (réseau/login GHCR) : on n'écrit PAS le marqueur → réessai au
    // prochain tick. Sortie non nulle pour que journalctl/systemd la voie.
    console.error(
      '  ✗ Sonde du digest distant échouée — abandon (réessai au prochain tick).',
    );
    process.exit(1);
  }
  const local = marqueurLocal();
  console.log(
    `  digest distant : ${distant} (agrégat des ${PROJETS_DEPLOYABLES.length} images)`,
  );
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

// Lancé directement (pas importé pour un test unitaire de `agregerDigests`) → on POLL.
// Sans cette garde, importer le module exécuterait main() (sonde docker + process.exit),
// ce qui tuerait le test runner.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
