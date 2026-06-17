// @ts-check
/**
 * Calcul des 4 métriques **DORA** depuis l'API GitHub Deployments (AUD-08, doc 25 ;
 * design : docs/26-instrumentation-dora-aud-08.md).
 *
 * Source de vérité : les **GitHub Deployments** de l'environnement `production`,
 * produits par `scripts/deploy.mjs` côté serveur (wrapper de déploiement traçable).
 * Ce script LIT cet historique (déploiements + statuts + date de commit) et en
 * dérive, sur une fenêtre glissante :
 *
 *   - **Deployment frequency**  : nb de déploiements `success` ÷ fenêtre.
 *   - **Lead time for changes** : médiane (horodatage success − date de commit du ref).
 *   - **Change failure rate**   : déploiements terminés en échec ÷ déploiements terminés.
 *   - **MTTR (time to restore)**: médiane (success suivant − échec).
 *
 * Subtilité API : poser un statut `success` AUTO-INACTIVE les déploiements `success`
 * précédents du même environnement (état terminal `inactive`). On classe donc un
 * déploiement par son DERNIER statut ≠ `inactive`, pas par `statuses[0]` brut.
 *
 * Zéro dépendance npm (Node pur, `fetch` natif). Lecture seule : le `GITHUB_TOKEN`
 * par défaut (`deployments: read`) suffit — aucun PAT requis côté CI. Écrit un
 * tableau Markdown dans `GITHUB_STEP_SUMMARY` ; export Prometheus optionnel.
 *
 * Variables : GITHUB_TOKEN, GITHUB_REPOSITORY (défaut EdouardZemb/creche-planner),
 * DORA_WINDOW_DAYS (30), DORA_ENVIRONMENT (production), DORA_NOW (ISO, tests),
 * DORA_PROM_TEXTFILE (chemin d'export optionnel).
 */

import { appendFileSync, writeFileSync } from 'node:fs';

const REPO = process.env.GITHUB_REPOSITORY ?? 'EdouardZemb/creche-planner';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
const ENVIRONMENT = process.env.DORA_ENVIRONMENT ?? 'production';
const WINDOW_DAYS = Number(process.env.DORA_WINDOW_DAYS ?? '30');
const NOW = process.env.DORA_NOW ? new Date(process.env.DORA_NOW) : new Date();
const WINDOW_START = new Date(NOW.getTime() - WINDOW_DAYS * 86_400_000);

const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** GET paginé de l'API GitHub. Retourne le tableau concaténé (best-effort). */
async function ghGet(path) {
  const out = [];
  let url = `https://api.github.com/repos/${REPO}${path}`;
  url += (url.includes('?') ? '&' : '?') + 'per_page=100';
  while (url) {
    const res = await fetch(url, {
      headers: {
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'creche-planner-dora',
      },
    });
    if (!res.ok) {
      throw new Error(
        `GitHub ${path} → HTTP ${res.status} : ${await res.text()}`,
      );
    }
    const page = await res.json();
    out.push(...(Array.isArray(page) ? page : [page]));
    // Pagination via l'en-tête Link (rel="next").
    const link = res.headers.get('link') ?? '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : '';
  }
  return out;
}

/** GET d'un objet unique (non paginé). null si indisponible. */
async function ghGetOne(path) {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
      headers: {
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'creche-planner-dora',
      },
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Médiane d'un tableau de nombres (ms). null si vide. */
function mediane(xs) {
  if (xs.length === 0) return null;
  const t = [...xs].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
}

/** Durée lisible (ms → « 2 h 15 », « 3 j », …). */
function duree(ms) {
  if (ms == null) return '—';
  if (ms < HOUR) return `${Math.round(ms / 60_000)} min`;
  if (ms < DAY) return `${(ms / HOUR).toFixed(1)} h`;
  return `${(ms / DAY).toFixed(1)} j`;
}

const cache = new Map();
/** Date de commit (ms epoch) d'un ref. Mémoïsé. null si introuvable. */
async function dateCommit(ref) {
  if (cache.has(ref)) return cache.get(ref);
  const c = await ghGetOne(`/commits/${ref}`);
  const iso = c?.commit?.committer?.date ?? c?.commit?.author?.date ?? null;
  const ms = iso ? new Date(iso).getTime() : null;
  cache.set(ref, ms);
  return ms;
}

/** Classement DORA → libellé. `bands` = [seuilElite, seuilHigh, seuilMedium]. */
function classer(valeur, bands, sensInverse = false) {
  if (valeur == null) return '—';
  const [e, h, m] = bands;
  const test = sensInverse
    ? (v, s) => v >= s // fréquence : plus c'est haut, mieux c'est
    : (v, s) => v <= s; // temps/taux : plus c'est bas, mieux c'est
  if (test(valeur, e)) return '🟢 Elite';
  if (test(valeur, h)) return '🔵 High';
  if (test(valeur, m)) return '🟡 Medium';
  return '🟠 Low';
}

async function main() {
  console.log(
    `▶ DORA · dépôt=${REPO} · env=${ENVIRONMENT} · fenêtre=${WINDOW_DAYS} j ` +
      `(${WINDOW_START.toISOString().slice(0, 10)} → ${NOW.toISOString().slice(0, 10)})`,
  );

  // 1. Récupère les déploiements de l'environnement (du plus récent au plus ancien),
  //    on s'arrête dès qu'on passe sous le début de fenêtre (avec marge nulle : on
  //    a besoin des success récents pour le MTTR, déjà inclus car plus récents).
  const bruts = await ghGet(
    `/deployments?environment=${encodeURIComponent(ENVIRONMENT)}`,
  );
  const dansFenetre = bruts.filter(
    (d) => new Date(d.created_at).getTime() >= WINDOW_START.getTime(),
  );

  // 2. Classe chaque déploiement par son dernier statut ≠ inactive.
  const evts = []; // { ref, outcome:'success'|'failed', time }
  for (const d of dansFenetre) {
    const statuts = await ghGet(`/deployments/${d.id}/statuses`);
    const utiles = statuts.filter((s) => s.state !== 'inactive');
    const dernier = utiles[0]; // [0] = plus récent
    if (!dernier) continue;
    if (dernier.state === 'success') {
      evts.push({
        ref: d.sha ?? d.ref,
        outcome: 'success',
        time: new Date(dernier.created_at).getTime(),
      });
    } else if (dernier.state === 'failure' || dernier.state === 'error') {
      evts.push({
        ref: d.sha ?? d.ref,
        outcome: 'failed',
        time: new Date(dernier.created_at).getTime(),
      });
    }
    // pending / in_progress / queued → en cours, ignoré.
  }
  evts.sort((a, b) => a.time - b.time);

  const succes = evts.filter((e) => e.outcome === 'success');
  const echecs = evts.filter((e) => e.outcome === 'failed');
  const termines = succes.length + echecs.length;

  // 3a. Deployment frequency (par semaine).
  const freqSemaine = (succes.length / WINDOW_DAYS) * 7;

  // 3b. Lead time : médiane (success − commit du ref).
  const leads = [];
  for (const e of succes) {
    const dc = await dateCommit(e.ref);
    if (dc != null && e.time >= dc) leads.push(e.time - dc);
  }
  const leadMed = mediane(leads);

  // 3c. Change failure rate.
  const cfr = termines > 0 ? echecs.length / termines : null;

  // 3d. MTTR : pour chaque échec, prochain success chronologique.
  const restaurations = [];
  for (const f of echecs) {
    const restore = succes.find((s) => s.time > f.time);
    if (restore) restaurations.push(restore.time - f.time);
  }
  const mttr = mediane(restaurations);

  // 4. Enrichissement incidents (best-effort, jamais bloquant) : issues `incident`.
  let incidentBloc = '';
  try {
    const issues = await ghGet(
      `/issues?labels=incident&state=all&since=${WINDOW_START.toISOString()}`,
    );
    const reels = issues.filter((i) => !i.pull_request); // exclut les PR
    const fermes = reels.filter((i) => i.closed_at);
    const ouverts = reels.filter((i) => !i.closed_at).length;
    if (reels.length > 0) {
      const mttrInc = mediane(
        fermes.map(
          (i) =>
            new Date(i.closed_at).getTime() - new Date(i.created_at).getTime(),
        ),
      );
      incidentBloc =
        `\n**Incidents (issues \`incident\`)** — ${reels.length} sur la fenêtre ` +
        `(${ouverts} ouvert·s) · MTTR incident (closed−created) : **${duree(mttrInc)}**.\n`;
    }
  } catch (e) {
    console.warn(`  ⚠️ Enrichissement incidents ignoré : ${e.message}`);
  }

  // 5. Rendu.
  const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(0)} %`);
  const lignes = [
    '## 📈 Métriques DORA',
    '',
    `Environnement **${ENVIRONMENT}** · fenêtre **${WINDOW_DAYS} j** · ` +
      `${termines} déploiement·s terminé·s (${succes.length} ✓ / ${echecs.length} ✗).`,
    '',
    '| Clé | Valeur | Niveau |',
    '| --- | ---: | :--: |',
    `| Deployment frequency | ${freqSemaine.toFixed(1)} / semaine | ${classer(freqSemaine, [7, 1, 0.23], true)} |`,
    `| Lead time for changes | ${duree(leadMed)} | ${classer(leadMed, [HOUR, DAY, WEEK])} |`,
    `| Change failure rate | ${pct(cfr)} | ${classer(cfr, [0.15, 0.3, 0.45])} |`,
    `| MTTR (time to restore) | ${duree(mttr)} | ${classer(mttr, [HOUR, DAY, WEEK])} |`,
    incidentBloc,
    termines < 3
      ? '> ⚠️ **Volume faible** (< 3 déploiements terminés) : métriques **indicatives de tendance**, non robustes statistiquement (cf. doc 26 §5).'
      : '',
    '',
    '_Source : GitHub Deployments (`scripts/deploy.mjs`). Détails : docs/26-instrumentation-dora-aud-08.md._',
  ];
  const resume = lignes.filter((l) => l !== '').join('\n') + '\n';
  process.stdout.write('\n' + resume);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, resume);

  // 6. Export Prometheus optionnel (textfile collector).
  if (process.env.DORA_PROM_TEXTFILE) {
    const g = (nom, aide, val) =>
      val == null
        ? ''
        : `# HELP ${nom} ${aide}\n# TYPE ${nom} gauge\n${nom}{environment="${ENVIRONMENT}"} ${val}\n`;
    const prom =
      g(
        'dora_deployment_frequency_per_week',
        'Déploiements success / semaine',
        freqSemaine.toFixed(3),
      ) +
      g(
        'dora_lead_time_seconds',
        'Lead time médian (s)',
        leadMed == null ? null : (leadMed / 1000).toFixed(0),
      ) +
      g(
        'dora_change_failure_ratio',
        'Change failure rate (0..1)',
        cfr == null ? null : cfr.toFixed(4),
      ) +
      g(
        'dora_time_to_restore_seconds',
        'MTTR médian (s)',
        mttr == null ? null : (mttr / 1000).toFixed(0),
      );
    writeFileSync(process.env.DORA_PROM_TEXTFILE, prom);
    console.log(
      `\n  ✓ Export Prometheus écrit : ${process.env.DORA_PROM_TEXTFILE}`,
    );
  }
}

main().catch((e) => {
  console.error(`\n❌ Échec du calcul DORA : ${e.message}`);
  process.exit(1);
});
