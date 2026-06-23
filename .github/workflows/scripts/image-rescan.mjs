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
 *   3. RAPPORT dans `GITHUB_STEP_SUMMARY` (toujours).
 *   4. NOTIFICATION e-mail sur findings, en RÉUTILISANT la conf SMTP de la Phase 4
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
 *   SCAN_FAKE_FINDING=1     injecte un finding SYNTHÉTIQUE [TEST] après le scan réel
 *                           (valide la chaîne e-mail sans vraie CVE ; opt-in dispatch)
 *   GITHUB_STEP_SUMMARY     fichier de résumé (posé par Actions)
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = process.env.GITHUB_REPOSITORY ?? 'EdouardZemb/creche-planner';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
const ACTOR = process.env.GITHUB_ACTOR ?? 'github-actions';
const ENVIRONMENT = process.env.SCAN_ENVIRONMENT ?? 'production';
const IMAGE_BASE =
  process.env.IMAGE_BASE ?? 'ghcr.io/edouardzemb/creche-planner';
const SEVERITY = process.env.TRIVY_SEVERITY ?? 'HIGH,CRITICAL';
const DRY_RUN = process.env.SCAN_DRY_RUN === '1';
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
  const file = join(tmpdir(), `cve-rescan-mail-${process.pid}.eml`);
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
      rmSync(file, { force: true });
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

  // 3) Rapport.
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
      summary('| CVE | Paquet | Installée → corrigée | Sévérité |');
      summary('| --- | --- | --- | --- |');
      for (const v of vulns) {
        summary(
          `| ${v.id} | \`${v.pkg}\` | \`${v.installed}\` → \`${v.fixed || '—'}\` | ${v.severity} |`,
        );
      }
      summary('');
    }
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
    `immuable n'est plus rescané au build). Action : republier une version corrigée`,
    `(rebuild → nx release → déploiement) ou allowlister sciemment dans .trivyignore.`,
    ``,
  ];
  for (const { image, vulns } of withFindings) {
    bodyLines.push(`■ ${image}`);
    for (const v of vulns) {
      bodyLines.push(
        `   - [${v.severity}] ${v.id}  ${v.pkg} ${v.installed} → ${v.fixed || '(pas de correctif)'}`,
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
