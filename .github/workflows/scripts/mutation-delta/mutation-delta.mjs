// @ts-check
/**
 * GATE — MUTATION TESTING SUR LE CODE MODIFIÉ (job `mutation-delta` de ci.yml).
 *
 * Juge les SEULES lignes qu'une PR ajoute ou modifie dans le code muté (libs
 * dotées d'un `stryker.config.mjs`), avec le seuil `thresholds.break` de leur
 * config. Une PR n'échoue donc jamais à cause de code ancien qu'elle ne touche
 * pas — et le code neuf mal testé ne se dilue plus dans le score global.
 *
 * Décision : `plan.mjs` (pur). Verdict : `verdict.mjs` (pur). Ce fichier ne fait
 * que la plomberie : git, build, Stryker, résumé.
 *
 * Proposition et mesures : docs/exploitation/proposition-ci-mutation-delta.md.
 *
 * Entrées (environnement) :
 *   MUTATION_BASE       référence de comparaison (défaut `origin/main`) ; la base
 *                       effective est `git merge-base MUTATION_BASE HEAD`
 *   MUTATION_PLAN_SEUL  `1` : écrit le plan et s'arrête (aucun Stryker)
 *
 * Sorties : résumé Markdown (GITHUB_STEP_SUMMARY ou stdout),
 * `mutation-delta-resultat.json`, rapports copiés dans `mutation-delta-rapports/`.
 * Code de sortie 1 si une lib échoue ou n'a pas pu être jugée.
 */
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  globSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  lireNomsStatuts,
  lirePlages,
  outillageModifie,
  planifier,
} from './plan.mjs';
import { juger } from './verdict.mjs';

const RACINE = process.cwd();
const WIN = process.platform === 'win32';

/** @param {string[]} args */
function git(args) {
  const r = spawnSync('git', args, {
    cwd: RACINE,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: r.status === 0, sortie: r.stdout ?? '', erreur: r.stderr ?? '' };
}

/**
 * @param {string} commande
 * @param {string[]} args
 * @param {string} cwd
 */
function lancer(commande, args, cwd) {
  const r = spawnSync(commande, args, {
    cwd,
    encoding: 'utf8',
    shell: WIN,
    maxBuffer: 256 * 1024 * 1024,
  });
  return { code: r.status ?? 1, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Texte de code rendu en code span sûr (ni Markdown, ni rupture de tableau). */
function code(brut, max = 90) {
  const s = String(brut)
    .replace(/[\r\n`|]+/g, ' ')
    .trim()
    .slice(0, max);
  return s === '' ? '`∅`' : `\`${s}\``;
}

async function libsMutees() {
  const configs = globSync(
    [
      'libs/*/*/stryker.config.mjs',
      'libs/*/stryker.config.mjs',
      'apps/*/stryker.config.mjs',
    ],
    { cwd: RACINE },
  ).sort();
  const libs = [];
  for (const cfg of configs) {
    const dossier = dirname(cfg).replaceAll('\\', '/');
    const config =
      (await import(pathToFileURL(resolve(RACINE, cfg)).href)).default ?? {};
    const pkg = JSON.parse(
      readFileSync(join(RACINE, dossier, 'package.json'), 'utf8'),
    );
    libs.push({
      dossier,
      projet: String(pkg.nx?.name ?? pkg.name),
      mutate: Array.isArray(config.mutate) ? config.mutate.map(String) : [],
      seuil: Number(config.thresholds?.break),
      rapport: String(
        config.jsonReporter?.fileName ?? 'reports/mutation/mutation.json',
      ),
    });
  }
  return libs;
}

const base = process.env.MUTATION_BASE || 'origin/main';
const libs = await libsMutees();
const mb = git(['merge-base', base, 'HEAD']);
const baseSha = mb.ok ? mb.sortie.trim() : '';
const baseTrouvee = mb.ok && /^[0-9a-f]{40}$/.test(baseSha);

const changements = baseTrouvee
  ? lireNomsStatuts(
      git(['diff', '--name-status', '-M', baseSha, 'HEAD']).sortie,
    )
  : [];
const plages = baseTrouvee
  ? lirePlages(
      git([
        'diff',
        '-U0',
        '-M',
        '--no-color',
        baseSha,
        'HEAD',
        '--',
        'libs',
        'apps',
      ]).sortie,
    )
  : new Map();
const outillage =
  baseTrouvee &&
  outillageModifie(
    git(['diff', '-U0', '--no-color', baseSha, 'HEAD', '--', 'package.json'])
      .sortie,
  );
const plan = planifier({
  libs,
  baseTrouvee,
  changements,
  plages,
  outillageModifie: outillage,
});

const lignesPlan = libs.map((l) => {
  const p = plan.get(l.dossier);
  return `- ${code(l.dossier)} : **${p?.mode}** — ${p?.raison}`;
});

if (process.env.MUTATION_PLAN_SEUL === '1') {
  console.log(
    JSON.stringify({ base, baseSha, plan: Object.fromEntries(plan) }, null, 1),
  );
  process.exit(0);
}

const rapports = join(RACINE, 'mutation-delta-rapports');
mkdirSync(rapports, { recursive: true });
/** @type {Record<string, any>} */
const resultat = { base, baseSha: baseSha || null, libs: {} };
const sections = [];
let echec = false;

for (const lib of libs) {
  const p = plan.get(lib.dossier);
  if (!p || p.mode === 'rien') {
    resultat.libs[lib.dossier] = {
      mode: 'rien',
      raison: p?.raison ?? '?',
      etat: 'rien',
    };
    continue;
  }
  const build = lancer(
    'pnpm',
    ['nx', 'run', `${lib.projet}:build`, '--outputStyle=static'],
    RACINE,
  );
  let verdict;
  let journal = '';
  if (build.code !== 0) {
    verdict = juger(null, lib.seuil);
    verdict.detail = `build de ${lib.projet} en échec : la lib n'a pas pu être jugée`;
    journal = build.sortie;
  } else {
    const cheminRapport = join(RACINE, lib.dossier, lib.rapport);
    rmSync(cheminRapport, { force: true });
    const args = ['stryker', 'run', '--reporters', 'json,clear-text'];
    if (p.mode === 'delta') args.push('--mutate', p.mutate.join(','));
    const run = lancer('npx', args, join(RACINE, lib.dossier));
    journal = run.sortie;
    const brut = existsSync(cheminRapport)
      ? readFileSync(cheminRapport, 'utf8')
      : null;
    verdict = juger(brut, lib.seuil);
    if (brut !== null)
      copyFileSync(cheminRapport, join(rapports, `${lib.projet}.json`));
  }
  writeFileSync(join(rapports, `${lib.projet}.log`), journal);
  if (verdict.etat === 'echoue' || verdict.etat === 'erreur') echec = true;
  resultat.libs[lib.dossier] = {
    mode: p.mode,
    raison: p.raison,
    mutate: p.mutate,
    ...verdict,
  };

  const icone = {
    passe: '✅',
    echoue: '❌',
    'rien-a-juger': '➖',
    erreur: '⚠️',
  }[verdict.etat];
  const bloc = [
    `#### ${icone} ${code(lib.projet)} — ${p.mode}`,
    '',
    `${verdict.detail}.`,
    '',
  ];
  if (verdict.etat === 'rien-a-juger')
    bloc.push(
      'Rien à juger : **passage explicite**, pas un score (Stryker aurait affiché `NaN`).',
      '',
    );
  if (verdict.survivants.length > 0) {
    bloc.push(
      '| Fichier:ligne | Mutateur | Remplacement | Statut |',
      '| --- | --- | --- | --- |',
    );
    for (const s of verdict.survivants.slice(0, 30)) {
      bloc.push(
        `| ${code(`${s.fichier}:${s.ligne}`)} | ${code(s.mutateur, 40)} | ${code(s.remplacement)} | ${s.statut} |`,
      );
    }
    if (verdict.survivants.length > 30)
      bloc.push(`| … | ${verdict.survivants.length - 30} autres | | |`);
    bloc.push('');
  }
  sections.push(bloc.join('\n'));
}

writeFileSync(
  join(RACINE, 'mutation-delta-resultat.json'),
  JSON.stringify(resultat, null, 1),
);

const resume = [
  `### Mutation sur le code modifié — ${echec ? '❌ bloquant' : '✅'}`,
  '',
  `Base : ${code(base)} → merge-base ${baseTrouvee ? code(baseSha.slice(0, 10)) : '**introuvable** (repli complet)'}`,
  '',
  ...lignesPlan,
  '',
  ...sections,
  echec
    ? '> Un survivant est un changement de code que **aucun test ne remarque**. Remède : un test qui le tue. Si le mutant est réellement sans conséquence, une dérogation lisible en revue : `// Stryker disable next-line <mutateur>: <raison>`.'
    : '',
].join('\n');
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${resume}\n`);
console.log(resume);
process.exit(echec ? 1 : 0);
