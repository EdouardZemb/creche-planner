// @ts-check
/**
 * VEILLE CVE des images DÉJÀ déployées en production (Phase 12, roadmap CI/CD).
 *
 * Problème comblé — le « CVE-drift ». Trivy ne scanne qu'au BUILD (porte bloquante
 * dans `build-images` de ci.yml et dans release.yml). Une CVE HIGH/CRITICAL
 * divulguée APRÈS la publication d'une image en prod passe alors totalement
 * inaperçue : l'artefact est immuable (Phase 2, `IMAGE_TAG=0.1.0`), il n'est plus
 * rebuild, donc plus jamais re-scanné. Ce script re-scanne en CONTINU (cron
 * quotidien) les images RÉELLEMENT en ligne et NOTIFIE par e-mail sur tout
 * finding HIGH/CRITICAL corrigible — sans RIEN bloquer (c'est de la veille, pas
 * une porte de déploiement).
 *
 * Étapes :
 *   1. VERSION en ligne. `SCAN_VERSION` explicite (workflow_dispatch) sinon on la
 *      DÉDUIT de l'API GitHub Deployments : le DERNIER déploiement `production`
 *      dont le statut courant est `success` (un nouveau success AUTO-INACTIVE les
 *      précédents → l'actif est le seul `success` non `inactive`, cf. dora-metrics).
 *      `scripts/deploy.mjs` encode la version dans la description du Deployment :
 *      « … (IMAGE_TAG=0.1.0) ».
 *   2. SCAN. Trivy sur les 6 images `ghcr.io/.../<svc>:<version>` (mêmes réglages
 *      que la porte build : severity HIGH,CRITICAL, `--ignore-unfixed`, `.trivyignore`
 *      partagé) en `--exit-code 0` → un finding ne fait JAMAIS échouer le scan.
 *   3. VERDICT DE SOURCE. Pour chaque finding, on compare la version incriminée à
 *      ce que le lockfile du dépôt résout AUJOURD'HUI. Sans cela le rapport ne dit
 *      que « la prod est vulnérable » — pas s'il faut ÉCRIRE un correctif ou
 *      seulement REDÉPLOYER, deux suites qui n'ont ni le même coût ni la même
 *      urgence. Le cas du 2026-08-13 est l'archétype : CVE-2026-69152
 *      (brace-expansion), corrigée en source depuis le 2026-08-05 (overrides pnpm,
 *      PR #289), mais notifiée chaque matin parce que l'image 0.15.0 du 2026-08-01
 *      est antérieure au correctif. Le mail ne le disait pas ; la question a été
 *      réinstruite de zéro.
 *   4. RAPPORT dans `GITHUB_STEP_SUMMARY` (toujours).
 *   5. NOTIFICATION e-mail sur findings, en RÉUTILISANT la conf SMTP de la Phase 4
 *      (smarthost Gmail, expéditeur/destinataire `edouard.zemb@gmail.com`) via
 *      `curl` (aucune dépendance/action tierce à épingler ; curl est préinstallé).
 *      Le secret est le MÊME mot de passe d'application Gmail que la Phase 4, fourni
 *      ici en SECRET GitHub Actions `ALERTMANAGER_SMTP_PASSWORD`.
 *
 * SÉMANTIQUE D'ÉCHEC (clé) — « ne RIEN bloquer » = des CVE ne cassent jamais le run
 * (vert + e-mail). En revanche un échec OPÉRATIONNEL de la veille elle-même
 * (version introuvable, Trivy en erreur, e-mail non délivré alors qu'il y a des
 * findings) fait passer le run ROUGE : c'est VISIBLE et n'impacte AUCUN build (rien
 * ne dépend de ce workflow). Une veille muette serait pire qu'une veille rouge.
 *
 * Zéro dépendance npm (Node pur, `fetch` natif, `curl`/`trivy` via spawn).
 *
 * Variables :
 *   GITHUB_TOKEN            lecture Deployments + pull GHCR (défaut CI suffit)
 *   GITHUB_REPOSITORY       défaut EdouardZemb/creche-planner
 *   GITHUB_ACTOR            utilisateur pour l'auth registre GHCR (Trivy)
 *   SCAN_VERSION            tag d'image à scanner ; vide ⇒ déduit de l'API
 *   SCAN_SERVICES           liste d'images (défaut : les 6 projets déployables)
 *   IMAGE_BASE              défaut ghcr.io/edouardzemb/creche-planner
 *   TRIVY_SEVERITY          défaut HIGH,CRITICAL
 *   SMTP_PASSWORD           mot de passe d'application Gmail (= Phase 4)
 *   SMTP_SMARTHOST/FROM/TO  défauts Phase 4 (smtp.gmail.com:587, edouard.zemb@…)
 *   SCAN_DRY_RUN=1          n'exécute ni Trivy ni curl (mise au point locale)
 *   SCAN_DRY_RUN=verdicts   idem + injecte le JEU D'ESSAI des verdicts de source
 *                           (les 4 états, dont un dérivé du lockfile réel) ; joué en
 *                           CI par `veille-cve-autotest`
 *   SCAN_LOCKFILE           lockfile de référence pour le verdict (défaut pnpm-lock.yaml)
 *   SCAN_FAKE_FINDING=1     injecte un finding SYNTHÉTIQUE [TEST] après le scan réel
 *                           (valide la chaîne e-mail sans vraie CVE ; opt-in dispatch)
 *   GITHUB_STEP_SUMMARY     fichier de résumé (posé par Actions)
 */

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  writeFileSync,
  readFileSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = process.env.GITHUB_REPOSITORY ?? 'EdouardZemb/creche-planner';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
const ACTOR = process.env.GITHUB_ACTOR ?? 'github-actions';
const ENVIRONMENT = process.env.SCAN_ENVIRONMENT ?? 'production';
const IMAGE_BASE =
  process.env.IMAGE_BASE ?? 'ghcr.io/edouardzemb/creche-planner';
const SEVERITY = process.env.TRIVY_SEVERITY ?? 'HIGH,CRITICAL';
// Jeu d'essai des VERDICTS DE SOURCE (cf. ALERTES_DRY_RUN de veille-alertes.mjs) :
// injecte des findings choisis pour exercer les 4 états, dont un DÉRIVÉ du lockfile
// réel. Joué en CI par `veille-cve-autotest`. N'envoie ni Trivy ni curl.
const JEU_ESSAI_VERDICTS = process.env.SCAN_DRY_RUN === 'verdicts';
const DRY_RUN = process.env.SCAN_DRY_RUN === '1' || JEU_ESSAI_VERDICTS;
const LOCKFILE = process.env.SCAN_LOCKFILE ?? 'pnpm-lock.yaml';
// Affordance de TEST (cf. DEPLOY_FAKE_FAIL de deploy.mjs) : injecte un finding
// SYNTHÉTIQUE après le scan réel pour exercer la chaîne de notification e-mail
// (secret + curl + Gmail) sans attendre une vraie CVE-drift. Opt-in seulement
// (entrée `test_notification` du workflow_dispatch) ; ne se déclenche JAMAIS en cron.
const FAKE_FINDING = ['1', 'true'].includes(
  process.env.SCAN_FAKE_FINDING ?? '',
);
const SERVICES = (
  process.env.SCAN_SERVICES ??
  'web api-gateway svc-referentiel svc-foyer svc-planification svc-tarification'
)
  .trim()
  .split(/\s+/)
  .filter(Boolean);

// Conf SMTP — réutilise la Phase 4 (docker/alertmanager.yml). L'adresse e-mail
// n'est pas un secret (déjà dans l'historique git) ; seul le mot de passe l'est.
const SMTP_SMARTHOST = process.env.SMTP_SMARTHOST ?? 'smtp.gmail.com:587';
const SMTP_FROM = process.env.SMTP_FROM ?? 'edouard.zemb@gmail.com';
const SMTP_TO = process.env.SMTP_TO ?? 'edouard.zemb@gmail.com';
const SMTP_PASSWORD = process.env.SMTP_PASSWORD ?? '';

const summaryLines = [];
/** Empile une ligne pour le GITHUB_STEP_SUMMARY (et la journalise). */
function summary(line = '') {
  summaryLines.push(line);
}
/** Écrit le résumé accumulé dans GITHUB_STEP_SUMMARY (best-effort). */
function flushSummary() {
  const out = summaryLines.join('\n') + '\n';
  console.log('\n----- RÉSUMÉ -----\n' + out);
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) {
    try {
      appendFileSync(file, out);
    } catch (e) {
      console.warn(`⚠️ écriture GITHUB_STEP_SUMMARY impossible : ${e.message}`);
    }
  }
}
/** Termine en erreur (run ROUGE) : veille cassée, à corriger. N'impacte aucun build. */
function abort(message) {
  console.error(`\n❌ ${message}`);
  summary('');
  summary(`> ❌ **Veille en échec** : ${message}`);
  flushSummary();
  console.log(`::error::${message}`);
  process.exit(1);
}

/** GET API GitHub (best-effort, throw sur HTTP non-ok). */
async function ghGet(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: {
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'creche-planner-cve-rescan',
    },
  });
  if (!res.ok) {
    throw new Error(
      `GitHub ${path} → HTTP ${res.status} : ${await res.text()}`,
    );
  }
  return res.json();
}

/**
 * Déduit la version DÉPLOYÉE en prod depuis l'API Deployments : le dernier
 * déploiement `environment` dont le statut courant est `success`, puis extrait
 * `IMAGE_TAG=<v>` de sa description (posée par deploy.mjs). Retourne {version, ref}.
 */
async function versionDeployee() {
  const deps = await ghGet(
    `/deployments?environment=${ENVIRONMENT}&per_page=30`,
  );
  if (!Array.isArray(deps) || deps.length === 0) {
    abort(`Aucun déploiement « ${ENVIRONMENT} » trouvé via l'API GitHub.`);
  }
  // L'API renvoie les déploiements du plus récent au plus ancien.
  for (const dep of deps) {
    const statuses = await ghGet(`/deployments/${dep.id}/statuses?per_page=1`);
    const state = Array.isArray(statuses) ? statuses[0]?.state : undefined;
    if (state !== 'success') continue;
    const m = /IMAGE_TAG=([^)\s]+)/.exec(dep.description ?? '');
    if (!m) {
      abort(
        `Déploiement #${dep.id} (success) sans « IMAGE_TAG=… » dans la description : ` +
          `« ${dep.description ?? ''} ». Impossible de déduire la version.`,
      );
    }
    return { version: m[1], ref: dep.ref, id: dep.id };
  }
  abort(
    `Aucun déploiement « ${ENVIRONMENT} » au statut « success » dans les 30 derniers.`,
  );
}

/**
 * Scanne une image avec Trivy (non bloquant). Retourne {vulns:[], error|null}.
 * Mêmes réglages que la porte build (severity, ignore-unfixed, .trivyignore).
 */
function scanImage(image) {
  const args = [
    'image',
    '--scanners',
    'vuln',
    '--severity',
    SEVERITY,
    '--ignore-unfixed',
    '--ignorefile',
    '.trivyignore',
    '--format',
    'json',
    '--quiet',
    '--timeout',
    '10m',
    '--exit-code',
    '0', // un finding ne fait JAMAIS échouer Trivy : c'est de la veille.
    image,
  ];
  if (DRY_RUN) {
    console.log(`  (SCAN_DRY_RUN — trivy ${args.join(' ')} non exécuté)`);
    return { vulns: [], error: null };
  }
  const r = spawnSync('trivy', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // Auth registre GHCR pour le pull de l'image (Trivy honore TRIVY_USERNAME/PASSWORD).
    env: { ...process.env, TRIVY_USERNAME: ACTOR, TRIVY_PASSWORD: TOKEN },
  });
  if (r.status !== 0 || r.error) {
    return {
      vulns: [],
      error:
        r.error?.message || (r.stderr ?? '').slice(0, 500) || 'échec trivy',
    };
  }
  let report;
  try {
    report = JSON.parse(r.stdout || '{}');
  } catch (e) {
    return { vulns: [], error: `JSON Trivy illisible : ${e.message}` };
  }
  const vulns = [];
  for (const result of report.Results ?? []) {
    for (const v of result.Vulnerabilities ?? []) {
      vulns.push({
        id: v.VulnerabilityID,
        pkg: v.PkgName,
        installed: v.InstalledVersion,
        fixed: v.FixedVersion,
        severity: v.Severity,
        title: v.Title || '',
      });
    }
  }
  return { vulns, error: null };
}

// --- Verdict de source : « corriger » ou seulement « redéployer » ? -----------
//
// RÈGLE CARDINALE, symétrique de celle de veille-alertes.mjs (« un appel qui échoue
// n'est JAMAIS lu comme aucune alerte ») : ici, un doute n'est JAMAIS lu comme
// « déjà corrigé ». Le faux vert coûterait bien plus cher que le faux doute — il
// ferait classer « simple redéploiement » une CVE qui demande encore un correctif,
// et la prod repartirait vulnérable en croyant le contraire. Tout ce qui n'est pas
// PROUVÉ corrigé ressort donc en « à vérifier ».

/**
 * Lit les versions résolues par le lockfile pnpm (v9), sans dépendance YAML : la
 * section `packages:` porte une clé `nom@version` par paquet. Retourne une Map
 * nom → Set(versions), ou `null` si le fichier est illisible//vide — cas que
 * l'appelant DOIT traiter comme un doute, pas comme « rien à signaler ».
 * @returns {Map<string, Set<string>> | null}
 */
function lireVersionsSource(fichier = LOCKFILE) {
  let texte;
  try {
    texte = readFileSync(fichier, 'utf8');
  } catch (e) {
    console.warn(`⚠️ lockfile « ${fichier} » illisible : ${e.message}`);
    return null;
  }
  const versions = new Map();
  let dansPackages = false;
  for (const ligne of texte.split(/\r?\n/)) {
    if (/^packages:\s*$/.test(ligne)) {
      dansPackages = true;
      continue;
    }
    if (!dansPackages) continue;
    // Une ligne non indentée ferme la section (`snapshots:` suit `packages:`).
    if (/^\S/.test(ligne)) break;
    const m = /^ {2}'?((?:@[^/'\s]+\/)?[^@'\s]+)@([^:'()\s]+)'?:\s*$/.exec(
      ligne,
    );
    if (!m) continue;
    const [, nom, version] = m;
    if (!versions.has(nom)) versions.set(nom, new Set());
    versions.get(nom).add(version);
  }
  return versions.size ? versions : null;
}

/**
 * Compare deux versions numériques segment par segment. Retourne -1, 0 ou 1 — et
 * `null` dès qu'un segment n'est pas purement numérique (pré-release, epoch
 * Debian, suffixe amont). On refuse alors de conclure : deviner ici, c'est
 * fabriquer le faux vert que toute cette section existe pour empêcher.
 */
function comparerVersions(a, b) {
  const sa = String(a).trim().split('.');
  const sb = String(b).trim().split('.');
  if (![...sa, ...sb].every((s) => /^\d+$/.test(s))) return null;
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const x = Number(sa[i] ?? 0);
    const y = Number(sb[i] ?? 0);
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * État d'UNE version du lockfile face à la liste de correctifs de l'advisory.
 *
 * Trivy liste un correctif PAR LIGNE MAJEURE (« 1.1.18, 2.1.4, 3.0.6, 5.0.9 ») :
 * une version n'est corrigée que par le correctif de SA propre ligne. Une version
 * dont la ligne majeure ne figure pas dans la liste est déclarée vulnérable si
 * elle est SOUS la plus haute ligne corrigée (sa branche n'a pas reçu de correctif)
 * et INDÉTERMINÉE si elle est au-dessus (majeure plus récente que l'advisory).
 * @returns {'corrige'|'vulnerable'|'inconnu'}
 */
function etatDeLaVersion(version, correctifs) {
  const majeure = (v) => String(v).trim().split('.')[0];
  const memeLigne = correctifs.filter((f) => majeure(f) === majeure(version));
  for (const f of memeLigne) {
    const c = comparerVersions(version, f);
    if (c === null) return 'inconnu';
    if (c >= 0) return 'corrige';
  }
  if (memeLigne.length) return 'vulnerable'; // sa ligne a un correctif, elle est en deçà
  const majeuresCorrigees = correctifs
    .map((f) => Number(majeure(f)))
    .filter((n) => Number.isFinite(n));
  const m = Number(majeure(version));
  if (!Number.isFinite(m) || !majeuresCorrigees.length) return 'inconnu';
  return m < Math.max(...majeuresCorrigees) ? 'vulnerable' : 'inconnu';
}

/** Étiquettes affichées (rapport et e-mail). */
const ETIQUETTES = {
  corrige: '✅ déjà corrigé en source',
  vulnerable: '🔴 encore présent en source',
  inconnu: '❓ à vérifier',
  'hors-arbre': '➖ hors arbre npm',
};

/**
 * Verdict de la SOURCE pour un finding image : le correctif est-il déjà dans le
 * dépôt ? « corrige » n'est prononcé que si TOUTES les versions du paquet
 * présentes au lockfile sont prouvées corrigées — une seule douteuse suffit à
 * faire basculer en « inconnu ».
 * @returns {{etat: keyof typeof ETIQUETTES, texte: string}}
 */
function verdictSource(v, versionsSource) {
  if (!versionsSource)
    return { etat: 'inconnu', texte: 'lockfile source illisible' };
  const presentes = [...(versionsSource.get(v.pkg) ?? [])].sort();
  // Absent du lockfile : paquet OS (image de base Debian) ou binaire embarqué —
  // la source npm n'a alors rien à en dire, et surtout pas « c'est corrigé ».
  if (!presentes.length)
    return {
      etat: 'hors-arbre',
      texte: 'absent du lockfile (paquet OS / image de base)',
    };
  const correctifs = String(v.fixed ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!correctifs.length)
    return {
      etat: 'inconnu',
      texte: `source en ${presentes.join(', ')} — aucun correctif publié`,
    };
  const etats = presentes.map((p) => etatDeLaVersion(p, correctifs));
  if (etats.includes('vulnerable')) {
    const restantes = presentes.filter((_, i) => etats[i] === 'vulnerable');
    return {
      etat: 'vulnerable',
      texte: `source ENCORE en ${restantes.join(', ')}`,
    };
  }
  if (etats.includes('inconnu'))
    return {
      etat: 'inconnu',
      texte: `source en ${presentes.join(', ')} — comparaison non concluante`,
    };
  return { etat: 'corrige', texte: `source en ${presentes.join(', ')}` };
}

/**
 * Phrase de synthèse — la seule ligne du rapport qui dise quoi FAIRE. Elle ne
 * conclut « un redéploiement suffit » que si AUCUN finding n'est ni encore
 * présent ni douteux : un « à vérifier » pèse ici autant qu'un « vulnérable »,
 * parce que la suite à donner (regarder) est la même.
 * Les paquets hors arbre npm (OS de l'image de base) sont couverts par le
 * redéploiement : le Dockerfile applique `apt-get upgrade` au stage runtime.
 */
function syntheseSource(compte) {
  const aTraiter = compte.vulnerable + compte.inconnu;
  if (aTraiter === 0) {
    return (
      `**Aucun correctif de code à écrire** — tous les findings sont déjà corrigés dans ` +
      `la source (ou hors de l'arbre npm, donc couverts par la montée de l'image de base). ` +
      `Un REDÉPLOIEMENT (rebuild → nx release → déploiement) remet la prod au niveau du dépôt.`
    );
  }
  return (
    `**${aTraiter} finding(s) à instruire en source** (${compte.vulnerable} encore ` +
    `présent(s) au lockfile, ${compte.inconnu} à vérifier) — à traiter AVANT de republier ; ` +
    `${compte.corrige + compte['hors-arbre']} autre(s) ne demandent qu'un redéploiement.`
  );
}

/** Envoie l'e-mail via curl/SMTP (conf Phase 4). Retourne true si délivré. */
function envoyerEmail(subject, body) {
  if (DRY_RUN) {
    console.log(`  (SCAN_DRY_RUN — e-mail « ${subject} » non envoyé)`);
    return true;
  }
  // RFC 5322 : en-têtes + ligne vide + corps, en CRLF.
  const date = new Date().toUTCString().replace('GMT', '+0000');
  const eml =
    [
      `From: Veille CVE creche-planner <${SMTP_FROM}>`,
      `To: ${SMTP_TO}`,
      `Subject: ${subject}`,
      `Date: ${date}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body,
    ].join('\r\n') + '\r\n';
  // Répertoire temporaire à nom ALÉATOIRE (0700), pas un fichier au nom
  // prédictible dans `/tmp` : `cve-rescan-mail-<pid>.eml` était devinable, donc
  // pré-créable en lien symbolique par un autre utilisateur de la machine —
  // l'écriture aurait suivi le lien (CodeQL `js/insecure-temporary-file`,
  // alerte #17). `mkdtempSync` échoue si le chemin existe déjà.
  const dossier = mkdtempSync(join(tmpdir(), 'cve-rescan-'));
  const file = join(dossier, 'mail.eml');
  writeFileSync(file, eml, 'utf8');
  try {
    const r = spawnSync(
      'curl',
      [
        '--silent',
        '--show-error',
        '--ssl-reqd', // STARTTLS obligatoire (port 587)
        '--url',
        `smtp://${SMTP_SMARTHOST}`,
        '--user',
        `${SMTP_FROM}:${SMTP_PASSWORD}`,
        '--mail-from',
        SMTP_FROM,
        '--mail-rcpt',
        SMTP_TO,
        '--upload-file',
        file,
      ],
      { encoding: 'utf8' },
    );
    if (r.status !== 0 || r.error) {
      console.error(
        `  ✗ envoi e-mail : ${r.error?.message || r.stderr || 'échec curl'}`,
      );
      return false;
    }
    return true;
  } finally {
    try {
      rmSync(dossier, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

// --- Orchestration ----------------------------------------------------------

async function main() {
  console.log('═══ Veille CVE des images en production (Phase 12) ═══');

  // 1) Version en ligne.
  let version = (process.env.SCAN_VERSION ?? '').trim();
  let source;
  if (version) {
    source = 'workflow_dispatch (entrée explicite)';
  } else {
    const d = await versionDeployee();
    version = d.version;
    source = `API GitHub Deployments (#${d.id}, ref ${String(d.ref).slice(0, 12)})`;
  }
  console.log(`  version scannée : ${version}  ·  source : ${source}`);

  summary(`## 🛡️ Veille CVE — images en production`);
  summary('');
  summary(`- **Version scannée** : \`${version}\``);
  summary(`- **Source** : ${source}`);
  summary(
    `- **Sévérités** : ${SEVERITY} · \`--ignore-unfixed\` · \`.trivyignore\``,
  );
  summary(
    `- **Images** : ${SERVICES.length} (\`${IMAGE_BASE}/<svc>:${version}\`)`,
  );
  summary('');

  if (version === 'main' || version === 'latest') {
    summary(
      `> ⚠️ Tag **mutable** (\`${version}\`) — veille sur une cible non immuable.`,
    );
    summary('');
  }

  // 2) Scan des 6 images.
  let scanErrors = 0;
  let totalHigh = 0;
  let totalCritical = 0;
  const rows = [];
  /** @type {{image:string, vulns:any[]}[]} */
  const withFindings = [];

  for (const svc of SERVICES) {
    const image = `${IMAGE_BASE}/${svc}:${version}`;
    console.log(`\n▶ Scan ${image}`);
    const { vulns, error } = scanImage(image);
    if (error) {
      scanErrors++;
      console.error(`  ✗ ${error}`);
      rows.push(`| \`${svc}\` | — | — | ⚠️ erreur de scan |`);
      continue;
    }
    const crit = vulns.filter((v) => v.severity === 'CRITICAL').length;
    const high = vulns.filter((v) => v.severity === 'HIGH').length;
    totalCritical += crit;
    totalHigh += high;
    if (vulns.length) withFindings.push({ image, vulns });
    const verdict = vulns.length ? '🔴 à traiter' : '✅ RAS';
    rows.push(`| \`${svc}\` | ${crit} | ${high} | ${verdict} |`);
    console.log(`  CRITICAL=${crit} HIGH=${high}`);
  }

  // Affordance de TEST : finding synthétique pour valider la chaîne de notification
  // (le scan réel ci-dessus a quand même tourné). Clairement étiqueté [TEST].
  if (FAKE_FINDING) {
    console.log(
      '\n⚠️ SCAN_FAKE_FINDING — injection d’un finding synthétique [TEST].',
    );
    totalHigh += 1;
    rows.push('| `(test)` | 0 | 1 | 🧪 finding synthétique |');
    withFindings.push({
      image: `${IMAGE_BASE}/api-gateway:${version} (FINDING DE TEST)`,
      vulns: [
        {
          id: 'CVE-TEST-0000',
          pkg: 'paquet-de-test',
          installed: '1.0.0',
          fixed: '1.0.1',
          severity: 'HIGH',
          title: 'Finding synthétique — test de la notification e-mail',
        },
      ],
    });
  }

  // Jeu d'essai des verdicts de source (SCAN_DRY_RUN=verdicts). Les quatre états,
  // dont DEUX dérivés du lockfile réel plutôt qu'écrits en dur :
  //   - brace-expansion / correctifs RÉELS de CVE-2026-69152 ⇒ attendu « corrigé »
  //     TANT QUE les overrides pnpm de la PR #289 tiennent. Si quelqu'un les retire,
  //     ce jeu d'essai bascule en « encore présent » et le job CI rougit : c'est un
  //     RATCHET sur les overrides, pas seulement un test de la comparaison.
  //   - même paquet, correctif hors d'atteinte ⇒ attendu « encore présent » : c'est
  //     la SONDE NÉGATIVE, celle qui prouve que la comparaison mord encore.
  if (JEU_ESSAI_VERDICTS) {
    console.log(
      '\n⚠️ SCAN_DRY_RUN=verdicts — jeu d’essai des verdicts de source.',
    );
    const cas = [
      [
        'CVE-2026-69152',
        'brace-expansion',
        '2.1.3',
        '1.1.18, 2.1.4, 3.0.6, 5.0.9',
      ],
      ['CVE-ESSAI-VULN', 'brace-expansion', '2.1.3', '9999.0.0'],
      ['CVE-ESSAI-OS', 'libgnutls30', '3.7.9-2', '3.7.9-2+deb12u7'],
      ['CVE-ESSAI-SANSFIX', 'brace-expansion', '2.1.3', ''],
    ];
    totalHigh += cas.length;
    rows.push(
      `| \`(jeu d'essai)\` | 0 | ${cas.length} | 🧪 verdicts de source |`,
    );
    withFindings.push({
      image: `${IMAGE_BASE}/api-gateway:${version} (JEU D'ESSAI VERDICTS)`,
      vulns: cas.map(([id, pkg, installed, fixed]) => ({
        id,
        pkg,
        installed,
        fixed,
        severity: 'HIGH',
        title: 'Jeu d’essai — verdict de source',
      })),
    });
  }

  // 3) Verdict de source — écrire un correctif, ou seulement redéployer ?
  const versionsSource = lireVersionsSource();
  /** @type {Record<string, number>} */
  const compteVerdicts = {
    corrige: 0,
    vulnerable: 0,
    inconnu: 0,
    'hors-arbre': 0,
  };
  for (const f of withFindings) {
    for (const v of f.vulns) {
      v.source = verdictSource(v, versionsSource);
      compteVerdicts[v.source.etat]++;
    }
  }

  // 4) Rapport.
  summary('| Service | CRITICAL | HIGH | État |');
  summary('| --- | ---: | ---: | --- |');
  for (const r of rows) summary(r);
  summary('');

  const totalFindings = totalHigh + totalCritical;
  if (withFindings.length) {
    summary('### Détail des vulnérabilités');
    summary('');
    for (const { image, vulns } of withFindings) {
      summary(`**${image}**`);
      summary('');
      summary(
        '| CVE | Paquet | Installée → corrigée | Sévérité | Source du dépôt |',
      );
      summary('| --- | --- | --- | --- | --- |');
      for (const v of vulns) {
        summary(
          `| ${v.id} | \`${v.pkg}\` | \`${v.installed}\` → \`${v.fixed || '—'}\` | ${v.severity} | ` +
            `${ETIQUETTES[v.source.etat]} (${v.source.texte}) |`,
        );
      }
      summary('');
    }
    summary(`> ${syntheseSource(compteVerdicts)}`);
    summary('');
  }

  // Erreurs de scan = veille cassée → run ROUGE (après avoir publié le résumé).
  if (scanErrors) {
    abort(
      `${scanErrors}/${SERVICES.length} image(s) non scannée(s) (pull/registre/trivy). ` +
        `Veille incomplète — voir le journal.`,
    );
  }

  // 4) Notification.
  if (totalFindings === 0) {
    summary(
      `> ✅ **Aucune CVE ${SEVERITY} corrigible** sur la prod (\`${version}\`).`,
    );
    flushSummary();
    console.log('\n✅ Aucun finding — pas de notification.');
    return;
  }

  const prefix = FAKE_FINDING ? '[TEST] ' : '';
  const subject =
    `${prefix}[VEILLE CVE] ${totalFindings} vuln. ${SEVERITY} sur la prod (${version}) — ` +
    `${totalCritical} CRITICAL / ${totalHigh} HIGH`;
  const bodyLines = [
    FAKE_FINDING
      ? `*** E-MAIL DE TEST (SCAN_FAKE_FINDING) — finding synthétique, AUCUNE CVE réelle. ***`
      : `Veille CVE creche-planner — images DÉJÀ déployées en production.`,
    ``,
    `Version en ligne : ${version}  (source : ${source})`,
    `Total : ${totalCritical} CRITICAL, ${totalHigh} HIGH (corrigibles, hors .trivyignore).`,
    ``,
    `Ces CVE ont probablement été divulguées APRÈS le build de l'image (l'artefact`,
    `immuable n'est plus rescané au build).`,
    ``,
    `ACTION — ${syntheseSource(compteVerdicts).replace(/\*\*/g, '')}`,
    ``,
    `Le verdict « source » compare la version incriminée à ce que le lockfile du dépôt`,
    `résout AUJOURD'HUI sur main. Il ne dit « déjà corrigé » que si c'est PROUVÉ ; tout`,
    `doute ressort en « à vérifier ». Reste possible : allowlister sciemment dans`,
    `.trivyignore, avec justification datée.`,
    ``,
  ];
  for (const { image, vulns } of withFindings) {
    bodyLines.push(`■ ${image}`);
    for (const v of vulns) {
      bodyLines.push(
        `   - [${v.severity}] ${v.id}  ${v.pkg} ${v.installed} → ${v.fixed || '(pas de correctif)'}`,
      );
      bodyLines.push(
        `     source du dépôt : ${ETIQUETTES[v.source.etat]} — ${v.source.texte}`,
      );
    }
    bodyLines.push('');
  }
  bodyLines.push(
    `Run : https://github.com/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID ?? ''}`,
  );

  if (!SMTP_PASSWORD) {
    flushSummary();
    abort(
      `${totalFindings} CVE détectée(s) mais SMTP_PASSWORD (secret ALERTMANAGER_SMTP_PASSWORD) ` +
        `absent → notification IMPOSSIBLE. Ajouter le secret Actions (mot de passe ` +
        `d'application Gmail, cf. Phase 4) pour activer l'e-mail de veille.`,
    );
  }

  console.log(`\n▶ Envoi de la notification e-mail à ${SMTP_TO}…`);
  const sent = envoyerEmail(subject, bodyLines.join('\n'));
  if (sent) {
    summary('');
    summary(`> 📧 **Notification envoyée** à ${SMTP_TO}.`);
    flushSummary();
    console.log('  ✓ e-mail envoyé.');
  } else {
    flushSummary();
    abort(
      `Envoi e-mail ÉCHOUÉ malgré ${totalFindings} finding(s) — voir le journal ` +
        `(auth Gmail ? mot de passe d'application ?).`,
    );
  }
}

main().catch((e) => {
  abort(`Erreur inattendue : ${e.message}`);
});
