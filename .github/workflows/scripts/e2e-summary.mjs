// Résumé E2E Playwright + flakiness pour `GITHUB_STEP_SUMMARY` (doc 27, AQ-06).
//
// Usage : node e2e-summary.mjs <results.json> [libellé]
//
// Parse le rapport du reporter `json` de Playwright (activé en CI par
// playwright.config.ts / playwright.stack.config.ts) et publie totaux + durée +
// **tests passés après retry** (outcome `flaky`). C'est le compteur que le simple
// vert/rouge masque : avec `retries: 1` en CI, un test instable finit vert — sans
// ce relevé, la flakiness s'installe sans laisser de trace.
//
// Tolérant : rapport absent (run interrompu avant les tests) → note informative,
// exit 0. Ce script ne porte AUCUN verdict : le run Playwright lui-même a déjà
// fait échouer le job si un test est rouge.

import { existsSync, readFileSync, appendFileSync } from 'node:fs';

const [fichier, libelle = 'E2E Playwright'] = process.argv.slice(2);
if (!fichier) {
  console.error('Usage : node e2e-summary.mjs <results.json> [libellé]');
  process.exit(2);
}

/** Écrit le summary sur stdout et dans GITHUB_STEP_SUMMARY si présent. */
function publier(lignes) {
  const texte = lignes.join('\n') + '\n';
  process.stdout.write(texte);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, texte);
  }
}

if (!existsSync(fichier)) {
  publier([
    `## 🎭 ${libelle}`,
    '',
    `_Aucun rapport Playwright trouvé (\`${fichier}\`) — le run s'est probablement interrompu avant les tests._`,
  ]);
  process.exit(0);
}

const rapport = JSON.parse(readFileSync(fichier, 'utf8'));

// Parcours récursif des suites : chaque spec porte ses tests, dont l'outcome
// agrégé (`expected` | `unexpected` | `flaky` | `skipped`) et les tentatives.
const flaky = [];
function parcourir(suite, chemin) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      if (test.status === 'flaky') {
        flaky.push({
          titre: [...chemin, spec.title].join(' › '),
          fichier: spec.file,
          tentatives: (test.results ?? []).length,
        });
      }
    }
  }
  for (const sous of suite.suites ?? []) {
    parcourir(sous, [...chemin, sous.title]);
  }
}
for (const suite of rapport.suites ?? []) {
  parcourir(suite, [suite.title]);
}

const stats = rapport.stats ?? {};
const total =
  (stats.expected ?? 0) +
  (stats.unexpected ?? 0) +
  (stats.flaky ?? 0) +
  (stats.skipped ?? 0);
const duree = ((stats.duration ?? 0) / 1000).toFixed(1);
const echecs = stats.unexpected ?? 0;
const passesApresRetry = stats.flaky ?? flaky.length;

const lignes = [
  `## 🎭 ${libelle}`,
  '',
  `| Tests | Échecs | Passés après retry (flaky) | Ignorés | Durée (s) |`,
  `| ---: | ---: | ---: | ---: | ---: |`,
  `| ${total} | ${echecs > 0 ? `🔴 ${echecs}` : '✅ 0'} | ${
    passesApresRetry > 0 ? `⚠️ ${passesApresRetry}` : '0'
  } | ${stats.skipped ?? 0} | ${duree} |`,
];

if (flaky.length > 0) {
  lignes.push(
    '',
    '**Tests instables (passés après retry — à fiabiliser, pas à ignorer)** :',
    '',
    ...flaky.map(
      (t) => `- \`${t.fichier}\` — ${t.titre} (${t.tentatives} tentatives)`,
    ),
  );
}

publier(lignes);
