// Résumé des métriques de test pour `GITHUB_STEP_SUMMARY` (doc 18 §8, action P1-2).
//
// Agrège les artefacts produits par vitest en CI (cf. vitest.config.mts, reporters
// activés quand `process.env.CI`) :
//   - **JUnit**   `**/test-output/vitest/junit.xml`            → tests / échecs / durée
//   - **Couverture** `**/test-output/vitest/coverage/coverage-summary.json` → % lignes…
//
// Écrit un tableau Markdown dans le fichier pointé par `GITHUB_STEP_SUMMARY`. Sans
// dépendance externe (parsing XML par regex sur les attributs agrégés de `<testsuites>`).
// Tolérant : un projet sans couverture (apps/contracts) n'a pas de summary → « — ».

import { readFileSync, globSync } from 'node:fs';

const root = process.cwd();

/** Nom de projet = segment de chemin précédant `/test-output`. */
function projectName(file) {
  const rel = file
    .replace(/\\/g, '/')
    .replace(`${root.replace(/\\/g, '/')}/`, '');
  return rel.split('/test-output')[0];
}

/** Attribut numérique d'une balise XML (premier match), 0 si absent. */
function attr(xml, name) {
  const m = xml.match(new RegExp(`${name}="([0-9.]+)"`));
  return m ? Number(m[1]) : 0;
}

const rows = new Map(); // projet → { tests, failures, errors, skipped, time, lines }

for (const file of globSync('**/test-output/vitest/junit.xml')) {
  const xml = readFileSync(file, 'utf8');
  const head = xml.slice(0, xml.indexOf('>', xml.indexOf('<testsuites')) + 1);
  const p = projectName(file);
  const r = rows.get(p) ?? {};
  r.tests = attr(head, 'tests');
  r.failures = attr(head, 'failures');
  r.errors = attr(head, 'errors');
  r.skipped = attr(head, 'skipped');
  r.time = attr(head, 'time');
  rows.set(p, r);
}

for (const file of globSync(
  '**/test-output/vitest/coverage/coverage-summary.json',
)) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const p = projectName(file);
  const r = rows.get(p) ?? {};
  r.lines = json.total?.lines?.pct ?? null;
  rows.set(p, r);
}

const names = [...rows.keys()].sort();

let totTests = 0;
let totFail = 0;
let totTime = 0;
const lines = [
  '## 🧪 Métriques de test',
  '',
  '| Projet | Tests | Échecs | Couverture lignes | Durée (s) |',
  '| --- | ---: | ---: | ---: | ---: |',
];
for (const p of names) {
  const r = rows.get(p);
  totTests += r.tests ?? 0;
  totFail += (r.failures ?? 0) + (r.errors ?? 0);
  totTime += r.time ?? 0;
  const cov = r.lines == null ? '—' : `${r.lines.toFixed(1)} %`;
  const fail = (r.failures ?? 0) + (r.errors ?? 0);
  const flag = fail > 0 ? `🔴 ${fail}` : '✅ 0';
  lines.push(
    `| \`${p}\` | ${r.tests ?? 0} | ${flag} | ${cov} | ${(r.time ?? 0).toFixed(2)} |`,
  );
}
lines.push(
  '',
  `**Total** — ${totTests} tests · ${totFail} échec(s) · ${totTime.toFixed(2)} s sur ${names.length} projet(s) affecté(s).`,
);

if (names.length === 0) {
  lines.length = 0;
  lines.push(
    '## 🧪 Métriques de test',
    '',
    '_Aucun projet affecté n’a produit de rapport (rien à tester sur ce diff)._',
  );
}

const summary = lines.join('\n') + '\n';
process.stdout.write(summary);

const out = process.env.GITHUB_STEP_SUMMARY;
if (out) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(out, summary);
}
