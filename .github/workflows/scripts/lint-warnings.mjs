// Compteur de warnings ESLint vs baseline versionnée (chantier « consolidation »,
// lot D3 — pendant du coverage-compare.mjs pour le lint).
//
// Le ratchet ESLint du dépôt (28 règles en `warn`, destinées à passer en `error`)
// était EN PANNE : rien ne mesurait le nombre de warnings, donc rien n'empêchait
// qu'il remonte. Ce script :
//
//   1. Lance ESLint sur TOUT le dépôt via l'API programmatique (même config plate
//      qu'un `eslint .` — les artefacts `dist/`/`out-tsc/` sont ignorés par la
//      config racine, cf. son bloc `ignores`).
//   2. ÉCHOUE (exit 1) si le total de warnings dépasse `lint-baseline.json`, ou si
//      une seule ERREUR est présente (les règles promues en `error` sont
//      bloquantes par construction).
//   3. Écrit un tableau comparatif par règle dans GITHUB_STEP_SUMMARY, en signalant
//      les règles TOMBÉES À ZÉRO : ce sont les candidates à la promotion en `error`.
//
// La baseline est VERSIONNÉE (et non un artefact roulant comme la couverture) :
// la faire monter exige un diff visible en revue. La faire DESCENDRE fait partie
// du travail normal — c'est le sens du ratchet.
//
// Sans dépendance externe. Les lectures de fichiers sont écrites en `try/catch`
// (et non `existsSync` puis `readFileSync`) : la règle CodeQL `js/file-system-race`
// est bloquante en CI sur ce dépôt.

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { ESLint } from 'eslint';

const BASELINE = '.github/workflows/lint-baseline.json';

/** Lit un JSON ; `undefined` si absent ou illisible (pas de pré-test d'existence). */
function lireJson(chemin) {
  try {
    return JSON.parse(readFileSync(chemin, 'utf8'));
  } catch {
    return undefined;
  }
}

const eslint = new ESLint();
const resultats = await eslint.lintFiles(['.']);

const parRegle = {};
let warnings = 0;
let erreurs = 0;
const detailErreurs = [];

for (const resultat of resultats) {
  for (const message of resultat.messages) {
    const regle = message.ruleId ?? '(sans règle)';
    if (message.severity === 2) {
      erreurs += 1;
      if (detailErreurs.length < 20) {
        detailErreurs.push(
          `${resultat.filePath}:${message.line} ${regle} — ${message.message}`,
        );
      }
    } else {
      warnings += 1;
      parRegle[regle] = (parRegle[regle] ?? 0) + 1;
    }
  }
}

const baseline = lireJson(BASELINE);
const plafond = baseline?.total;
const parRegleBaseline = baseline?.parRegle ?? {};

// Toutes les règles vues d'un côté ou de l'autre, triées par volume courant.
const regles = [
  ...new Set([...Object.keys(parRegle), ...Object.keys(parRegleBaseline)]),
].sort((a, b) => (parRegle[b] ?? 0) - (parRegle[a] ?? 0) || a.localeCompare(b));

const lignes = [
  '## Ratchet ESLint',
  '',
  `**${warnings} warning(s)**${
    plafond === undefined ? ' (aucune baseline)' : ` / plafond ${plafond}`
  } · **${erreurs} erreur(s)**`,
  '',
  '| Règle | Baseline | Courant | Δ |',
  '| --- | ---: | ---: | ---: |',
];
for (const regle of regles) {
  const avant = parRegleBaseline[regle] ?? 0;
  const apres = parRegle[regle] ?? 0;
  if (avant === 0 && apres === 0) continue;
  const delta = apres - avant;
  const marque = apres === 0 ? ' 🎉 promouvable en `error`' : '';
  lignes.push(
    `| \`${regle}\` | ${avant} | ${apres} | ${delta > 0 ? `+${delta}` : delta}${marque} |`,
  );
}

const resume = process.env['GITHUB_STEP_SUMMARY'];
if (resume) {
  appendFileSync(resume, `${lignes.join('\n')}\n`);
}
console.log(lignes.join('\n'));

if (erreurs > 0) {
  console.error(
    `\n::error::${erreurs} erreur(s) ESLint — les règles promues en « error » sont bloquantes.`,
  );
  for (const detail of detailErreurs) console.error(detail);
  process.exit(1);
}

if (plafond === undefined) {
  console.log(
    `\nAucune baseline (${BASELINE}) — comparaison sautée. Créer le fichier pour armer le ratchet.`,
  );
  process.exit(0);
}

if (warnings > plafond) {
  console.error(
    `\n::error::Le nombre de warnings ESLint remonte : ${warnings} > ${plafond} (baseline ${BASELINE}). ` +
      `Corriger les nouveaux warnings — la baseline ne se relève pas pour laisser passer une régression.`,
  );
  process.exit(1);
}

if (warnings < plafond) {
  // Baisse : on n'échoue pas, mais on rend le geste explicite. La baseline n'est
  // PAS réécrite automatiquement — sinon elle suivrait un run partiel ou une
  // config accidentellement plus permissive.
  console.log(
    `\n::notice::${plafond - warnings} warning(s) de moins que la baseline. ` +
      `Penser à abaisser \`total\` dans ${BASELINE} pour verrouiller le terrain gagné.`,
  );
  writeFileSync(
    'lint-baseline-propose.json',
    `${JSON.stringify({ total: warnings, parRegle }, undefined, 2)}\n`,
  );
}
