// Comparaison de couverture vs baseline historisée (doc 27, AQ-06).
//
// La CI calculait la couverture sans jamais la comparer dans le temps : un
// abaissement silencieux (seuils retirés, exclusions élargies…) passerait
// inaperçu. Ce script :
//
//   1. Lit la couverture du run courant : `**/test-output/vitest/coverage/
//      coverage-summary.json` (projets AFFECTÉS seulement — nx affected).
//   2. Lit la baseline `.coverage-baseline/coverage-baseline.json` si le step
//      amont l'a téléchargée (artefact `coverage-baseline` du dernier run main).
//      Pas de baseline (premier run, artefact expiré) → comparaison sautée,
//      informatif, exit 0.
//   3. ÉCHOUE (exit 1) si la couverture lignes d'un projet baisse de plus de
//      SEUIL_PT points vs baseline ; résumé comparatif dans GITHUB_STEP_SUMMARY.
//   4. Écrit la baseline FUSIONNÉE dans `coverage-baseline/coverage-baseline.json` :
//      les projets non affectés gardent leur valeur, les affectés sont mis à jour.
//      Publiée en artefact UNIQUEMENT sur push main (la baseline reste « rolling »
//      et complète même si chaque run n'exécute qu'un sous-ensemble de projets).
//
// Sans dépendance externe (globSync node:fs), même convention que test-summary.mjs.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  globSync,
} from 'node:fs';

// Tolérance avant échec, en points de pourcentage sur la couverture lignes.
// 0,5 pt absorbe le bruit d'arrondi tout en bloquant toute vraie régression.
const SEUIL_PT = 0.5;

const BASELINE_LUE = '.coverage-baseline/coverage-baseline.json';
const BASELINE_ECRITE = 'coverage-baseline/coverage-baseline.json';

const root = process.cwd().replace(/\\/g, '/');

/** Nom de projet = segment de chemin précédant `/test-output` (cf. test-summary.mjs). */
function projectName(file) {
  const rel = file.replace(/\\/g, '/').replace(`${root}/`, '');
  return rel.split('/test-output')[0];
}

// 1. Couverture du run courant, par projet (lignes/branches/fonctions/instructions).
const courant = {};
for (const file of globSync(
  '**/test-output/vitest/coverage/coverage-summary.json',
)) {
  const total = JSON.parse(readFileSync(file, 'utf8')).total ?? {};
  courant[projectName(file)] = {
    lines: total.lines?.pct ?? null,
    statements: total.statements?.pct ?? null,
    branches: total.branches?.pct ?? null,
    functions: total.functions?.pct ?? null,
  };
}

// 2. Baseline du dernier run main, si téléchargée par le step amont.
let baseline = null;
if (existsSync(BASELINE_LUE)) {
  baseline = JSON.parse(readFileSync(BASELINE_LUE, 'utf8'));
}

// 3. Comparaison projet par projet (uniquement ceux mesurés DANS CE RUN : les
//    projets non affectés n'ont pas de rapport et gardent leur baseline).
const lignes = ['## 📈 Couverture vs baseline (main)', ''];
const regressions = [];

const projets = Object.keys(courant).sort();
if (projets.length === 0) {
  lignes.push(
    '_Aucun projet affecté n’a produit de couverture sur ce diff — rien à comparer._',
  );
} else if (!baseline) {
  lignes.push(
    '_Pas de baseline disponible (premier run ou artefact expiré) — comparaison sautée. La baseline sera publiée au prochain run `main`._',
    '',
    '| Projet | Couverture lignes |',
    '| --- | ---: |',
    ...projets.map((p) => `| \`${p}\` | ${fmt(courant[p].lines)} |`),
  );
} else {
  lignes.push(
    `Baseline : commit \`${(baseline.commit ?? '?').slice(0, 12)}\` (${baseline.generatedAt ?? 'date inconnue'}) — seuil de régression : ${SEUIL_PT} pt.`,
    '',
    '| Projet | Baseline | Courant | Δ |',
    '| --- | ---: | ---: | ---: |',
  );
  for (const p of projets) {
    const cur = courant[p].lines;
    const base = baseline.projects?.[p]?.lines ?? null;
    if (cur == null || base == null) {
      lignes.push(`| \`${p}\` | ${fmt(base)} | ${fmt(cur)} | — |`);
      continue;
    }
    const delta = cur - base;
    const regression = delta < -SEUIL_PT;
    if (regression) regressions.push({ projet: p, base, cur, delta });
    lignes.push(
      `| \`${p}\` | ${fmt(base)} | ${fmt(cur)} | ${regression ? '🔴' : delta > 0 ? '🟢' : '✅'} ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} pt |`,
    );
  }
}

function fmt(pct) {
  return pct == null ? '—' : `${pct.toFixed(1)} %`;
}

if (regressions.length > 0) {
  lignes.push(
    '',
    `**🔴 Régression de couverture (> ${SEUIL_PT} pt)** — soit ajouter les tests manquants, soit assumer EXPLICITEMENT la baisse (la baseline se réalignera au merge) :`,
    '',
    ...regressions.map(
      (r) =>
        `- \`${r.projet}\` : ${r.base.toFixed(2)} % → ${r.cur.toFixed(2)} % (${r.delta.toFixed(2)} pt)`,
    ),
  );
}

// 4. Baseline fusionnée (rolling) — écrite dans tous les cas, publiée sur main seul.
const fusion = {
  schema: 1,
  commit: process.env.GITHUB_SHA ?? 'local',
  generatedAt: new Date().toISOString(),
  projects: { ...(baseline?.projects ?? {}), ...courant },
};
mkdirSync('coverage-baseline', { recursive: true });
writeFileSync(BASELINE_ECRITE, JSON.stringify(fusion, null, 2) + '\n');

const texte = lignes.join('\n') + '\n';
process.stdout.write(texte);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, texte);
}

if (regressions.length > 0) {
  console.error(
    `::error::Couverture en baisse de plus de ${SEUIL_PT} pt sur ${regressions.length} projet(s) — voir le summary.`,
  );
  process.exit(1);
}
