// @ts-check
/**
 * MESURE DU BUDGET DE TEMPS DE LA CI DE PR — exécuté par `budget-ci.yml`.
 *
 * Complète la porte statique `pnpm budget-ci` (qui refuse tout job ajouté derrière
 * `ci`) par la mesure réelle : p90 de la durée murale des runs `ci.yml` de PR sur
 * 14 jours, en deux classes, contre les plafonds décidés le 2026-09-30
 * (docs/exploitation/proposition-ci-mutation-delta.md §6) :
 *
 *   - PR SANS images : p90 ≤ 7 min  (7,0 mesuré avant le rééquilibrage) ;
 *   - PR AVEC images : p90 ≤ 20 min (19,5 mesuré).
 *
 * Durée murale d'un run = premier job démarré → dernier job terminé (l'attente
 * d'un runner, 3 s en médiane, est comprise). Un run « avec images » est un run où
 * un job `build-images (…)` a réellement tourné.
 *
 * Règles de lecture, dans l'esprit des autres veilles :
 *   - un appel qui échoue = POINT MORT, run rouge — jamais « budget tenu » ;
 *   - moins de 8 runs dans une classe = NON JUGÉ, dit comme tel (pas un vert) ;
 *   - l'API qui liste les runs rend des fenêtres incohérentes quand on la FILTRE
 *     (`event`, `status`) : on pagine sans filtre et on filtre ici.
 */
import { appendFileSync } from 'node:fs';

const DEPOT = process.env.GITHUB_REPOSITORY ?? '';
const JETON = process.env.GITHUB_TOKEN ?? '';
const JOURS = Number(process.env.BUDGET_JOURS || 14);
const PLAFONDS = {
  'sans images': Number(process.env.BUDGET_SANS_IMAGES_MIN || 7),
  'avec images': Number(process.env.BUDGET_AVEC_IMAGES_MIN || 20),
};
const ECHANTILLON_MIN = 8;

/** @param {string} chemin */
async function lire(chemin) {
  const r = await fetch(`https://api.github.com/${chemin}`, {
    headers: {
      authorization: `Bearer ${JETON}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'creche-planner-budget-ci',
    },
  });
  if (!r.ok) throw new Error(`${r.status} sur ${chemin.split('?')[0]}`);
  return r.json();
}

/** @param {number[]} valeurs @param {number} p */
export function quantile(valeurs, p) {
  const s = [...valeurs].sort((a, b) => a - b);
  if (s.length === 0) return null;
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
}

/**
 * @param {{ name: string, conclusion: string | null, started_at: string | null, completed_at: string | null }[]} jobs
 * @returns {{ minutes: number, images: boolean } | null}
 */
export function mesurerRun(jobs) {
  const actifs = jobs.filter(
    (j) => j.conclusion !== 'skipped' && j.started_at && j.completed_at,
  );
  if (actifs.length === 0) return null;
  const debut = Math.min(
    ...actifs.map((j) => Date.parse(/** @type {string} */ (j.started_at))),
  );
  const fin = Math.max(
    ...actifs.map((j) => Date.parse(/** @type {string} */ (j.completed_at))),
  );
  return {
    minutes: (fin - debut) / 60000,
    images: actifs.some((j) => j.name.startsWith('build-images (')),
  };
}

async function principal() {
  const limite = Date.now() - JOURS * 86_400_000;
  /** @type {any[]} */
  const runs = [];
  for (let page = 1; page <= 20; page++) {
    const d = await lire(
      `repos/${DEPOT}/actions/workflows/ci.yml/runs?per_page=100&page=${page}`,
    );
    if (d.workflow_runs.length === 0) break;
    for (const r of d.workflow_runs) {
      if (
        r.event === 'pull_request' &&
        r.status === 'completed' &&
        r.conclusion !== 'cancelled' &&
        Date.parse(r.created_at) >= limite
      ) {
        runs.push(r);
      }
    }
    if (
      d.workflow_runs.every(
        (/** @type {any} */ r) => Date.parse(r.created_at) < limite,
      )
    )
      break;
  }
  /** @type {Record<string, number[]>} */
  const classes = { 'sans images': [], 'avec images': [] };
  for (const r of runs) {
    const jobs = await lire(
      `repos/${DEPOT}/actions/runs/${r.id}/attempts/${r.run_attempt}/jobs?per_page=100`,
    );
    const m = mesurerRun(jobs.jobs);
    if (m) classes[m.images ? 'avec images' : 'sans images'].push(m.minutes);
  }

  let depasse = false;
  const lignes = [
    `## Budget de temps de la CI de PR — ${JOURS} derniers jours`,
    '',
    '| Classe | Runs | Médiane | p90 | Plafond p90 | Verdict |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const [classe, valeurs] of Object.entries(classes)) {
    const plafond = PLAFONDS[/** @type {keyof typeof PLAFONDS} */ (classe)];
    const med = quantile(valeurs, 0.5);
    const p90 = quantile(valeurs, 0.9);
    let verdict;
    if (valeurs.length < ECHANTILLON_MIN)
      verdict = `➖ non jugé (moins de ${ECHANTILLON_MIN} runs)`;
    else if (/** @type {number} */ (p90) > plafond) {
      verdict = '❌ dépassé';
      depasse = true;
    } else verdict = '✅ tenu';
    const f = (/** @type {number | null} */ x) =>
      x === null ? '—' : `${x.toFixed(1)} min`;
    lignes.push(
      `| ${classe} | ${valeurs.length} | ${f(med)} | ${f(p90)} | ${plafond} min | ${verdict} |`,
    );
  }
  lignes.push(
    '',
    depasse
      ? '> Budget dépassé : chercher le job qui s’est allongé (durées par job dans les runs), ou le job ajouté derrière `ci` que `pnpm budget-ci` aurait dû refuser.'
      : '> La règle structurelle (aucun job derrière `ci`) est tenue par `pnpm budget-ci` dans le job `ci`.',
  );
  const resume = lignes.join('\n');
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${resume}\n`);
  console.log(resume);
  return depasse ? 1 : 0;
}

if (process.argv[1]?.endsWith('budget-ci.mjs')) {
  if (!JETON || !/^[\w.-]+\/[\w.-]+$/.test(DEPOT)) {
    console.error('GITHUB_TOKEN ou GITHUB_REPOSITORY absent — POINT MORT.');
    process.exit(1);
  }
  principal().then(
    (code) => process.exit(code),
    (e) => {
      const msg = `## Budget de temps de la CI de PR — POINT MORT\n\nMesure impossible (${e instanceof Error ? e.message : String(e)}). Ce n'est PAS « budget tenu ».\n`;
      if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, msg);
      console.error(msg);
      process.exit(1);
    },
  );
}
