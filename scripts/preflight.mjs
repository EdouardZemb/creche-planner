#!/usr/bin/env node
// @ts-check
/**
 * Préflight de session — encode en vérifications ce que ~15 plans re-documentent
 * en prose (lot B1 du chantier « Consolidation UI & qualité »).
 *
 * L'objectif n'est pas de remplacer la CI : c'est d'attraper, en quelques
 * secondes et AVANT de coder, les états d'environnement qui produisent un
 * « faux vert » ou une cascade d'erreurs incompréhensibles — les mêmes à chaque
 * fois : mauvais pnpm, mauvais arbre de travail, symlinks de workspace cassés,
 * shims `.bin` périmés, paquets Nx désalignés, hooks git non installés.
 *
 * ## Usage
 *   pnpm preflight            # rapport complet
 *   pnpm preflight --strict   # les avertissements deviennent bloquants
 *
 * ⚠️ Le script s'appelle « preflight » et NON « doctor » : `pnpm doctor` est une
 * sous-commande NATIVE de pnpm (vérification du store) — elle masquerait ce
 * script sans le moindre message.
 *
 * ## Contraintes de conception
 *  - ZÉRO appel réseau (un `pnpm audit` en préflight avait déjà fait échouer la
 *    CI sur un 410 Gone) et zéro build : lectures `fs` + `git` uniquement.
 *  - Portable Windows (Git Bash) et Linux.
 *  - Aucun faux positif : un dépôt sain doit sortir 0 erreur, 0 avertissement.
 *    Une vérification qui ne peut pas conclure rend « ignoré », pas « échec ».
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RACINE = path.resolve(import.meta.dirname, '..');

/** @typedef {'ok' | 'avertissement' | 'erreur' | 'ignore'} Niveau */
/** @type {{ titre: string, niveau: Niveau, message: string, remede?: string }[]} */
const resultats = [];

/**
 * @param {string} titre
 * @param {Niveau} niveau
 * @param {string} message
 * @param {string} [remede]
 */
function noter(titre, niveau, message, remede) {
  resultats.push(
    remede === undefined
      ? { titre, niveau, message }
      : { titre, niveau, message, remede },
  );
}

/** Exécute une commande git et rend sa sortie, ou `null` si elle échoue. */
function git(...args) {
  try {
    return execFileSync('git', args, {
      cwd: RACINE,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** Lit un JSON, ou rend `null` s'il est absent/illisible. */
function lireJson(fichier) {
  try {
    return JSON.parse(fs.readFileSync(fichier, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Lit un fichier texte, ou rend `null` s'il est absent/illisible.
 *
 * Toutes les lectures du script passent par ici plutôt que par un
 * `existsSync()` suivi d'un `readFileSync()` : ce couple « on vérifie puis on
 * lit » est une fenêtre TOCTOU (le fichier peut changer entre les deux appels),
 * signalée par CodeQL. Tenter la lecture et rattraper l'échec dit la même chose
 * en un seul accès.
 */
function lireTexte(fichier) {
  try {
    return fs.readFileSync(fichier, 'utf8');
  } catch {
    return null;
  }
}

const pkgRacine = lireJson(path.join(RACINE, 'package.json')) ?? {};

// ---------------------------------------------------------------------------
// 1. pnpm : la version qui tourne vs celle imposée par `packageManager`
// ---------------------------------------------------------------------------
// Un `pnpm` global 8.x réécrit le lockfile dans un format que la CI
// (`--frozen-lockfile`, pnpm 10) refuse : l'install semble marcher, la CI casse.
function verifierPnpm() {
  const attendu = String(pkgRacine.packageManager ?? '');
  const majeureAttendue = /^pnpm@(\d+)\./.exec(attendu)?.[1];
  if (majeureAttendue === undefined) {
    noter('pnpm', 'ignore', 'aucun champ `packageManager` dans package.json');
    return;
  }
  // `npm_config_user_agent` n'existe que si le script est lancé PAR pnpm/npm.
  const agent = process.env['npm_config_user_agent'] ?? '';
  const versionCourante = /pnpm\/(\d+\.\d+\.\d+)/.exec(agent)?.[1];
  if (versionCourante === undefined) {
    noter(
      'pnpm',
      'ignore',
      `lancé hors d'un gestionnaire de paquets (attendu : ${attendu})`,
      `lancer via \`corepack ${attendu} preflight\``,
    );
    return;
  }
  const majeureCourante = versionCourante.split('.')[0];
  if (majeureCourante !== majeureAttendue) {
    noter(
      'pnpm',
      'erreur',
      `pnpm ${versionCourante} en cours d'exécution, ${attendu} attendu`,
      `toujours passer par \`corepack ${attendu} …\` — un pnpm global d'une autre majeure réécrit pnpm-lock.yaml`,
    );
    return;
  }
  noter('pnpm', 'ok', `pnpm ${versionCourante} (conforme à ${attendu})`);
}

// ---------------------------------------------------------------------------
// 2. Node : version courante vs `.nvmrc` et `engines.node`
// ---------------------------------------------------------------------------
function verifierNode() {
  const courante = process.version.replace(/^v/, '');
  const majeureCourante = Number(courante.split('.')[0]);
  const nvmrc = lireTexte(path.join(RACINE, '.nvmrc'))?.trim() ?? null;
  const engines = String(pkgRacine.engines?.node ?? '');
  const majeureMin = Number(/(\d+)/.exec(engines)?.[1] ?? NaN);

  if (!Number.isNaN(majeureMin) && majeureCourante < majeureMin) {
    noter(
      'node',
      'erreur',
      `Node ${courante} < engines.node ${engines}`,
      nvmrc !== null ? `installer Node ${nvmrc} (\`.nvmrc\`)` : undefined,
    );
    return;
  }
  if (nvmrc !== null && nvmrc !== courante) {
    // Majeure conforme mais mineure différente : la CI lit `.nvmrc`, un écart
    // n'est pas bloquant mais explique des divergences local/CI.
    noter(
      'node',
      'avertissement',
      `Node ${courante} en local, ${nvmrc} en CI (\`.nvmrc\`)`,
      `\`nvm use\` pour s'aligner sur la CI`,
    );
    return;
  }
  noter('node', 'ok', `Node ${courante}`);
}

// ---------------------------------------------------------------------------
// 3. Arbre de travail : clone principal ou worktree ?
// ---------------------------------------------------------------------------
// Le « worktree faux vert » (12 plans le documentent) : on croit tester la
// branche du worktree alors qu'on est dans le clone principal, ou l'inverse.
// `git-dir` ≠ `git-common-dir` ⇔ on est dans un worktree lié.
function verifierArbreDeTravail() {
  const gitDir = git('rev-parse', '--absolute-git-dir');
  const commonDir = git(
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  );
  const toplevel = git('rev-parse', '--show-toplevel');
  if (gitDir === null || commonDir === null || toplevel === null) {
    noter('arbre de travail', 'ignore', 'dépôt git introuvable');
    return;
  }
  const estWorktree = path.resolve(gitDir) !== path.resolve(commonDir);
  const branche = git('rev-parse', '--abbrev-ref', 'HEAD') ?? '(détachée)';
  const emplacement = estWorktree
    ? `worktree « ${path.basename(gitDir)} » (clone principal : ${path.dirname(commonDir)})`
    : 'clone principal';
  noter(
    'arbre de travail',
    'ok',
    `${emplacement}, branche ${branche}\n    ${toplevel}`,
  );

  // Worktrees enregistrés mais sans `node_modules` : y lancer un test échoue de
  // façon obscure. Ceux dont la branche est déjà fusionnée sont des reliquats.
  const liste = git('worktree', 'list', '--porcelain');
  if (liste === null) return;
  const chemins = [...liste.matchAll(/^worktree (.+)$/gm)].map((m) => m[1]);
  const sansModules = chemins.filter(
    (c) =>
      path.resolve(c) !== path.resolve(commonDir, '..') &&
      !fs.existsSync(path.join(c, 'node_modules')),
  );
  if (sansModules.length > 0) {
    noter(
      'worktrees',
      'avertissement',
      `${sansModules.length} worktree(s) sans node_modules : ${sansModules.map((c) => path.basename(c)).join(', ')}`,
      "y lancer `corepack pnpm@10.34.2 install` avant tout test, ou `git worktree remove` s'ils sont morts",
    );
  } else if (chemins.length > 1) {
    noter(
      'worktrees',
      'ok',
      `${chemins.length - 1} worktree(s) lié(s), tous installés`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Symlinks de workspace `@creche-planner/*`
// ---------------------------------------------------------------------------
// Ils ne vivent PAS à la racine : pnpm les pose dans le `node_modules` de CHAQUE
// projet qui déclare la dépendance en `workspace:*`. Un lien mort (ou pointant
// vers un AUTRE clone) donne des imports non résolus ou du code d'un autre
// arbre — le pire des faux verts.
function verifierSymlinksWorkspace() {
  const toplevel = git('rev-parse', '--show-toplevel');
  if (toplevel === null) {
    noter('symlinks workspace', 'ignore', 'dépôt git introuvable');
    return;
  }
  const racineReelle = fs.realpathSync(RACINE);
  const problemes = [];
  let verifies = 0;

  for (const dossier of ['apps', 'libs']) {
    for (const projet of listerProjets(path.join(RACINE, dossier))) {
      const pkg = lireJson(path.join(projet, 'package.json'));
      if (pkg === null) continue;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [nom, plage] of Object.entries(deps)) {
        if (typeof plage !== 'string' || !plage.startsWith('workspace:'))
          continue;
        const lien = path.join(projet, 'node_modules', ...nom.split('/'));
        const relatif = path.relative(RACINE, lien).split(path.sep).join('/');
        verifies += 1;
        // Résolution directe, sans `lstat` préalable : absent et lien mort se
        // corrigent de la même façon (réinstaller), la distinction ne vaut pas
        // un second accès au système de fichiers.
        let cible;
        try {
          cible = fs.realpathSync(lien);
        } catch {
          problemes.push(`${relatif} : absent ou lien mort`);
          continue;
        }
        if (!cible.startsWith(racineReelle)) {
          // Cas le plus dangereux : on compile le code d'un AUTRE clone.
          problemes.push(`${relatif} → ${cible} (hors de ce dépôt)`);
        }
      }
    }
  }

  if (problemes.length > 0) {
    noter(
      'symlinks workspace',
      'erreur',
      `${problemes.length}/${verifies} lien(s) en défaut :\n    ${problemes.join('\n    ')}`,
      'relancer `corepack pnpm@10.34.2 install` (depuis PowerShell sous Windows)',
    );
    return;
  }
  noter(
    'symlinks workspace',
    'ok',
    `${verifies} lien(s) \`workspace:*\` résolus dans ce dépôt`,
  );
}

/** Répertoires de projet (contenant un package.json) sous `base`, profondeur ≤ 3. */
function listerProjets(base, profondeur = 0) {
  if (profondeur > 3) return [];
  let entrees;
  try {
    entrees = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return []; // dossier absent : rien à parcourir.
  }
  const trouves = [];
  for (const entree of entrees) {
    if (
      !entree.isDirectory() ||
      entree.name === 'node_modules' ||
      entree.name.startsWith('.')
    ) {
      continue;
    }
    const chemin = path.join(base, entree.name);
    if (lireJson(path.join(chemin, 'package.json')) !== null) {
      trouves.push(chemin);
    }
    trouves.push(...listerProjets(chemin, profondeur + 1));
  }
  return trouves;
}

// ---------------------------------------------------------------------------
// 5. Shims `.bin` : la cible `.pnpm/<paquet>@<version>` existe-t-elle encore ?
// ---------------------------------------------------------------------------
// Après un `pnpm install` qui change une version, les shims Windows (.CMD/.ps1)
// peuvent rester sur l'ancien hash `.pnpm` → « Cannot find module …\.pnpm\… ».
// Le remède connu : supprimer le `.bin` du projet et réinstaller.
function verifierShims() {
  const dossiers = [path.join(RACINE, 'node_modules', '.bin')];
  for (const d of ['apps', 'libs']) {
    for (const projet of listerProjets(path.join(RACINE, d))) {
      dossiers.push(path.join(projet, 'node_modules', '.bin'));
    }
  }
  const casses = [];
  let examines = 0;

  for (const dossier of dossiers) {
    let entrees;
    try {
      // `withFileTypes` porte déjà le type : pas de `lstat` supplémentaire sur
      // le chemin, donc pas de fenêtre « vérifié puis relu » (TOCTOU) — c'est
      // aussi une syscall de moins par shim, sur ~200 shims.
      entrees = fs.readdirSync(dossier, { withFileTypes: true });
    } catch {
      continue; // `.bin` absent : ce projet n'expose aucun binaire.
    }
    for (const entree of entrees) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isSymbolicLink()) {
        // Shim POSIX : c'est un lien, sa validité se teste par realpath.
        examines += 1;
        try {
          fs.realpathSync(chemin);
        } catch {
          casses.push(`${path.relative(RACINE, chemin)} : lien mort`);
        }
        continue;
      }
      if (!entree.isFile()) continue;
      // Les shims Windows (.CMD/.ps1) portent le chemin `.pnpm` en clair, les
      // shims sh aussi. On ne lit que des fichiers, jamais les binaires réels.
      let contenu;
      try {
        contenu = fs.readFileSync(chemin, 'utf8');
      } catch {
        continue;
      }
      const cible = /[\\/]\.pnpm[\\/]([^\\/'"\s]+)/.exec(contenu)?.[1];
      if (cible === undefined) continue;
      examines += 1;
      // La racine du store est celle du `node_modules` qui héberge le shim.
      const store = path.resolve(dossier, '..', '.pnpm', cible);
      const storeRacine = path.join(RACINE, 'node_modules', '.pnpm', cible);
      if (!fs.existsSync(store) && !fs.existsSync(storeRacine)) {
        casses.push(
          `${path.relative(RACINE, chemin)} → .pnpm/${cible} (absent)`,
        );
      }
    }
  }

  if (casses.length > 0) {
    noter(
      'shims .bin',
      'erreur',
      `${casses.length}/${examines} shim(s) pointent dans le vide :\n    ${casses.slice(0, 8).join('\n    ')}`,
      'supprimer le `node_modules/.bin` fautif puis `corepack pnpm@10.34.2 install`',
    );
    return;
  }
  noter('shims .bin', 'ok', `${examines} shim(s) vérifiés`);
}

// ---------------------------------------------------------------------------
// 6. Chaîne Nx alignée
// ---------------------------------------------------------------------------
// Un bump partiel (`@nx/js` en 23, le reste en 22) casse le graphe de projets
// de façon cryptique. Le split 22→23 a coûté un chantier entier : voir
// `docs/runbook-nx-migrate.md`.
function verifierNx() {
  const deps = { ...pkgRacine.dependencies, ...pkgRacine.devDependencies };
  const paquets = Object.keys(deps).filter(
    (n) => n === 'nx' || n.startsWith('@nx/'),
  );
  if (paquets.length === 0) {
    noter('chaîne Nx', 'ignore', 'aucun paquet Nx déclaré');
    return;
  }
  /** @type {Map<string, string[]>} */
  const parVersion = new Map();
  const introuvables = [];
  for (const nom of paquets) {
    const pkg = lireJson(
      path.join(RACINE, 'node_modules', ...nom.split('/'), 'package.json'),
    );
    if (pkg === null) {
      introuvables.push(nom);
      continue;
    }
    const liste = parVersion.get(pkg.version) ?? [];
    liste.push(nom);
    parVersion.set(pkg.version, liste);
  }
  if (introuvables.length > 0) {
    noter(
      'chaîne Nx',
      'erreur',
      `paquet(s) déclaré(s) mais non installé(s) : ${introuvables.join(', ')}`,
      'lancer `corepack pnpm@10.34.2 install`',
    );
    return;
  }
  if (parVersion.size > 1) {
    const detail = [...parVersion.entries()]
      .map(([v, noms]) => `${v} : ${noms.join(', ')}`)
      .join('\n    ');
    noter(
      'chaîne Nx',
      'erreur',
      `versions désalignées :\n    ${detail}`,
      'réaligner via `docs/runbook-nx-migrate.md` (jamais paquet par paquet)',
    );
    return;
  }
  noter(
    'chaîne Nx',
    'ok',
    `${paquets.length} paquets tous en ${[...parVersion.keys()][0]}`,
  );
}

// NB — pas de vérification « `dist/` des libs en retard sur `src/` » ici, bien
// que ce soit le piège le plus recopié dans les plans. Deux raisons :
//  1. depuis le lot B2, `test` et `typecheck` dépendent de `^build` : Nx
//     garantit lui-même la fraîcheur, par HACHAGE DE CONTENU ;
//  2. une heuristique de mtime produit des faux positifs massifs — sur un cache
//     hit Nx affiche « existing outputs match the cache, left as is » et ne
//     touche pas `dist/`, si bien qu'un simple `git checkout` (qui réécrit les
//     mtimes des sources) ferait crier toutes les libs. Mesuré, pas supposé.

// ---------------------------------------------------------------------------
// 7. Hooks git (husky) réellement installés
// ---------------------------------------------------------------------------
// Sans eux, lint-staged et commitlint ne tournent pas : un commit part non
// formaté avec un message non conventionnel, et n'est rattrapé qu'en CI.
function verifierHooks() {
  const hooksPath = git('config', 'core.hooksPath');
  if (hooksPath === null) {
    noter(
      'hooks git',
      'erreur',
      '`core.hooksPath` non positionné : lint-staged et commitlint ne tourneront pas',
      'lancer `corepack pnpm@10.34.2 install` (script `prepare` → husky)',
    );
    return;
  }
  const absolu = path.isAbsolute(hooksPath)
    ? hooksPath
    : path.join(RACINE, hooksPath);
  const manquants = ['pre-commit', 'commit-msg'].filter(
    (h) => !fs.existsSync(path.join(absolu, h)),
  );
  if (manquants.length > 0) {
    noter(
      'hooks git',
      'avertissement',
      `hooks absents dans ${hooksPath} : ${manquants.join(', ')}`,
      'lancer `corepack pnpm@10.34.2 install`',
    );
    return;
  }
  noter('hooks git', 'ok', `pre-commit et commit-msg présents (${hooksPath})`);
}

// ---------------------------------------------------------------------------
// 8. Ports des providers Pact libres
// ---------------------------------------------------------------------------
// Chaque `*.provider.pact.spec.ts` démarre un Nest éphémère sur un port fixe
// (3995 notifications, 3996 référentiel, 3997 planification, 3998 tarification,
// 3999 foyer). Un process fantôme qui squatte l'un d'eux fait échouer le test
// sur « provider non prêt après 40000 ms » — 40 s de suspense par service, sans
// jamais nommer la vraie cause. Cas réel : un `mock-gateway.mjs` orphelin d'une
// session morte tenait 3999 depuis QUATRE jours.
const PORTS_PACT = [3995, 3996, 3997, 3998, 3999];

async function verifierPortsPact() {
  const { createServer } = await import('node:net');
  /** Tente d'écouter sur `port` ; rend `true` s'il est libre. */
  const libre = (port) =>
    new Promise((resolve) => {
      const serveur = createServer();
      serveur.once('error', () => {
        resolve(false);
      });
      serveur.once('listening', () => {
        serveur.close(() => {
          resolve(true);
        });
      });
      serveur.listen(port, '0.0.0.0');
    });

  const occupes = [];
  for (const port of PORTS_PACT) {
    if (!(await libre(port))) occupes.push(port);
  }
  if (occupes.length > 0) {
    noter(
      'ports Pact',
      'erreur',
      `port(s) déjà occupé(s) : ${occupes.join(', ')} — les tests provider échoueront sur « provider non prêt »`,
      process.platform === 'win32'
        ? `identifier le squatteur : \`netstat -ano | findstr :${occupes[0]}\` puis \`taskkill /PID <pid> /F\``
        : `identifier le squatteur : \`lsof -i :${occupes[0]}\` puis \`kill <pid>\``,
    );
    return;
  }
  noter('ports Pact', 'ok', `${PORTS_PACT.length} ports de test libres`);
}

// ---------------------------------------------------------------------------
// 9. `node_modules` postérieur au lockfile
// ---------------------------------------------------------------------------
function verifierInstallAJour() {
  const lock = path.join(RACINE, 'pnpm-lock.yaml');
  const modules = path.join(RACINE, 'node_modules', '.modules.yaml');
  let mtimeLock;
  let mtimeModules;
  try {
    mtimeLock = fs.statSync(lock).mtimeMs;
    mtimeModules = fs.statSync(modules).mtimeMs;
  } catch {
    noter(
      'install',
      'ignore',
      'pnpm-lock.yaml ou node_modules/.modules.yaml absent',
    );
    return;
  }
  if (mtimeLock > mtimeModules) {
    noter(
      'install',
      'avertissement',
      'pnpm-lock.yaml est plus récent que node_modules (pull ou changement de branche ?)',
      'lancer `corepack pnpm@10.34.2 install`',
    );
    return;
  }
  noter('install', 'ok', 'node_modules postérieur au lockfile');
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------
const SYMBOLES = {
  ok: '  OK  ',
  avertissement: ' WARN ',
  erreur: 'ERREUR',
  ignore: 'ignoré',
};

async function main() {
  const strict = process.argv.includes('--strict');

  verifierPnpm();
  verifierNode();
  verifierArbreDeTravail();
  verifierInstallAJour();
  verifierSymlinksWorkspace();
  verifierShims();
  verifierNx();
  await verifierPortsPact();
  verifierHooks();

  console.log('\nPréflight — environnement de développement\n');
  for (const r of resultats) {
    console.log(`[${SYMBOLES[r.niveau]}] ${r.titre} : ${r.message}`);
    if (r.remede !== undefined && r.niveau !== 'ok') {
      console.log(`           → ${r.remede}`);
    }
  }

  const erreurs = resultats.filter((r) => r.niveau === 'erreur').length;
  const avertissements = resultats.filter(
    (r) => r.niveau === 'avertissement',
  ).length;
  console.log(
    `\n${resultats.length} vérifications — ${erreurs} erreur(s), ${avertissements} avertissement(s).\n`,
  );

  if (erreurs > 0 || (strict && avertissements > 0)) process.exit(1);
}

await main();
