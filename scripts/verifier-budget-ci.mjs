#!/usr/bin/env node
// @ts-check
/**
 * Porte « BUDGET DE TEMPS DE LA CI DE PR » — `pnpm budget-ci`.
 *
 * La règle, décidée le 2026-09-30 (docs/exploitation/proposition-ci-mutation-delta.md) :
 * **un job ajouté à la CI de PR tourne EN PARALLÈLE de `ci`, jamais derrière lui.**
 * Le chemin critique d'une PR est `ci` puis les jobs qui l'attendent ; tout job qui
 * s'y inscrit allonge TOUTES les PR concernées, sans que personne l'ait décidé.
 *
 * Ce que la porte refuse, en lisant `.github/workflows/ci.yml` :
 *   1. un job qui dépend de `ci` (directement ou par transitivité) sans figurer
 *      dans `CHAINE` — la liste des jobs admis sur le chemin critique, chacun avec
 *      sa raison. L'allonger est possible, mais c'est un diff visible ici ;
 *   2. un job de `CHAINE` qui n'existe plus (liste périmée) ;
 *   3. l'absence, ou le retour sur la chaîne, des gates que le rééquilibrage a
 *      sortis en parallèle (`PARALLELES`) : les y remettre annulerait le gain
 *      sans bruit.
 *
 * Ce qu'elle ne mesure PAS : les durées. La mesure est faite chaque semaine par
 * `.github/workflows/budget-ci.yml` (p90 réel des PR contre les plafonds).
 *
 * Zéro dépendance (lecture ligne à ligne, pas de parseur YAML) : comme les autres
 * portes, elle tourne sans `node_modules`.
 *
 * Usage : pnpm budget-ci           # ou : node scripts/verifier-budget-ci.mjs
 *         pnpm budget-ci --autotest # rejoue les sondes négatives
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');
const CI = '.github/workflows/ci.yml';

/** Jobs admis derrière `ci`, avec leur raison. */
const CHAINE = {
  'e2e-web': 'parcours web contre un BFF mocké : exige le build de `ci`',
  'pact-can-i-deploy':
    'garde de déploiement des contrats : exige les vérifications provider de `ci`',
  'affected-images': 'calcule les images à construire après les portes de `ci`',
  'build-images': 'construit les images des projets affectés',
  'e2e-stack':
    'pile réelle + seed + Playwright + smokes santé, coûts et performance',
};

/** Gates sortis de la chaîne par le rééquilibrage : ils doivent exister, en parallèle. */
const PARALLELES = ['lint-ratchet', 'mutation-delta'];

/**
 * Lit les jobs et leurs `needs` (forme scalaire, liste en ligne ou liste en bloc).
 * @param {string} texte
 * @returns {Map<string, string[]>}
 */
export function lireJobs(texte) {
  /** @type {Map<string, string[]>} */
  const jobs = new Map();
  let dansJobs = false;
  let courant = null;
  let dansNeeds = false;
  for (const ligne of texte.split(/\r?\n/)) {
    if (/^jobs:\s*$/.test(ligne)) {
      dansJobs = true;
      continue;
    }
    if (!dansJobs) continue;
    if (/^\S/.test(ligne)) break;
    const job = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(ligne);
    if (job) {
      courant = job[1];
      jobs.set(courant, []);
      dansNeeds = false;
      continue;
    }
    if (courant === null) continue;
    const needs = /^ {4}needs:\s*(.*)$/.exec(ligne);
    if (needs) {
      const valeur = needs[1].replace(/\s+#.*$/, '').trim();
      if (valeur === '') {
        dansNeeds = true;
      } else {
        dansNeeds = false;
        jobs.set(
          courant,
          valeur
            .replace(/^\[|\]$/g, '')
            .split(',')
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean),
        );
      }
      continue;
    }
    const element = /^ {6}-\s*['"]?([A-Za-z0-9_-]+)['"]?\s*$/.exec(ligne);
    if (dansNeeds && element) {
      jobs.get(courant)?.push(element[1]);
      continue;
    }
    if (/^ {4}\S/.test(ligne)) dansNeeds = false;
  }
  return jobs;
}

/**
 * @param {Map<string, string[]>} jobs
 * @param {string} job
 * @param {Set<string>} [vus]
 */
function attendCi(jobs, job, vus = new Set()) {
  if (vus.has(job)) return false;
  vus.add(job);
  for (const n of jobs.get(job) ?? []) {
    if (n === 'ci' || attendCi(jobs, n, vus)) return true;
  }
  return false;
}

/** @param {string} texte */
export function verifier(texte) {
  /** @type {string[]} */
  const constats = [];
  const jobs = lireJobs(texte);
  if (!jobs.has('ci')) {
    constats.push(
      'aucun job `ci` lu dans le workflow : la porte ne sait plus où est le chemin critique (forme du fichier changée ?).',
    );
    return constats;
  }
  for (const job of jobs.keys()) {
    if (job !== 'ci' && attendCi(jobs, job) && !(job in CHAINE)) {
      constats.push(
        `\`${job}\` attend \`ci\` : il allonge le chemin critique de chaque PR. Un job ajouté tourne en parallèle de \`ci\` ; sinon, l'inscrire dans CHAINE avec sa raison.`,
      );
    }
  }
  for (const job of Object.keys(CHAINE)) {
    if (!jobs.has(job))
      constats.push(
        `\`${job}\` est déclaré sur la chaîne mais n'existe plus : liste CHAINE périmée.`,
      );
  }
  for (const job of PARALLELES) {
    if (!jobs.has(job))
      constats.push(`le gate parallèle \`${job}\` a disparu du workflow.`);
    else if (attendCi(jobs, job))
      constats.push(
        `le gate \`${job}\` est revenu derrière \`ci\` : il doit tourner en parallèle.`,
      );
  }
  return constats;
}

function autotest(texte) {
  /** @param {(t: string) => string} f @param {string} nom */
  const muter = (f, nom) => {
    const m = f(texte);
    if (m === texte)
      throw new Error(
        `sonde « ${nom} » : la mutation n'a RIEN changé — sonde périmée, pas la porte.`,
      );
    return m;
  };
  const sondes = [
    {
      nom: 'job ajouté derrière ci',
      texte: muter(
        (t) =>
          t.replace(
            /^jobs:\s*$/m,
            'jobs:\n  nouveau-job:\n    needs: [ci]\n    runs-on: ubuntu-latest',
          ),
        'ajout',
      ),
      attendu: '`nouveau-job` attend `ci`',
    },
    {
      nom: 'job ajouté derrière un job de la chaîne (transitivité)',
      texte: muter(
        (t) =>
          t.replace(
            /^jobs:\s*$/m,
            'jobs:\n  indirect:\n    needs:\n      - e2e-web\n    runs-on: ubuntu-latest',
          ),
        'transitif',
      ),
      attendu: '`indirect` attend `ci`',
    },
    {
      nom: 'gate parallèle remis derrière ci',
      texte: muter(
        (t) =>
          t.replace(/^( {2}mutation-delta:\s*\r?\n)/m, '$1    needs: [ci]\n'),
        'retour',
      ),
      attendu: '`mutation-delta` est revenu derrière `ci`',
    },
    {
      nom: 'gate parallèle supprimé',
      texte: muter(
        (t) => t.replace(/^ {2}lint-ratchet:\s*$/m, '  lint-ratchet-renomme:'),
        'suppression',
      ),
      attendu: '`lint-ratchet` a disparu',
    },
  ];
  let echecs = 0;
  for (const s of sondes) {
    const mord = verifier(s.texte).some((c) => c.includes(s.attendu));
    console.log(
      `Sonde « ${s.nom} » : ${mord ? 'la porte mord. ✅' : 'la porte NE MORD PAS. ❌'}`,
    );
    if (!mord) echecs += 1;
  }
  const temoin = verifier(texte);
  if (temoin.length > 0) {
    console.log(
      `❌ témoin : le workflow réel lève déjà ${temoin.length} constat(s) — les sondes ne prouveraient rien.`,
    );
    echecs += 1;
  }
  return echecs;
}

let texte;
try {
  texte = fs.readFileSync(path.join(RACINE, CI), 'utf8');
} catch (e) {
  console.error(`${CI} illisible : ${/** @type {Error} */ (e).message}`);
  process.exit(1);
}

if (process.argv.includes('--autotest')) {
  process.exit(autotest(texte) === 0 ? 0 : 1);
}

console.log('Budget de temps de la CI de PR');
const constats = verifier(texte);
for (const c of constats) console.log(`  ERREUR [${CI}] ${c}`);
console.log(
  constats.length === 0
    ? `  ${Object.keys(CHAINE).length} job(s) admis derrière \`ci\`, ${PARALLELES.length} gate(s) parallèle(s) présents.\n\n  0 erreur(s).`
    : `\n  ${constats.length} erreur(s).`,
);
process.exit(constats.length === 0 ? 0 : 1);
