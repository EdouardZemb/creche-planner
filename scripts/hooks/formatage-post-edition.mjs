#!/usr/bin/env node
// @ts-check
/**
 * Hook PostToolUse (Edit|Write) de Claude Code : formate le fichier édité avec
 * prettier, tout de suite plutôt qu'au commit.
 *
 * Pourquoi ce hook alors que lint-staged fait déjà `prettier --write` au
 * commit : (1) il formate AVANT que le diff soit relu, donc le diff montré en
 * cours de session est le diff final ; (2) il fait DEUX passes — lint-staged
 * n'en fait qu'une, or un `.md` où un code span inline se poursuit sur la
 * ligne suivante ne converge qu'à la seconde passe (cas réel : PR #276, CI
 * cassée par `nx format:check` sur un fichier que le hook venait de formater).
 *
 * Ce que ce hook ne fait PAS, à dessein :
 *  - pas d'ESLint : la config est type-aware, chaque invocation recharge le
 *    project service TypeScript (dizaines de secondes par fichier) — un coût
 *    par édition disproportionné quand le ratchet `lint-warnings.mjs` borne
 *    déjà le total en CI et que `pnpm check` le rejoue avant de pousser ;
 *  - pas de `prettier --check` : sous Windows (autocrlf) il signale TOUS les
 *    fichiers comme non conformes — on écrit, on ne juge pas ;
 *  - pas d'échec bloquant : un fichier que prettier ne sait pas parser est
 *    signalé sur stderr (code 2, visible de l'agent), tout le reste sort en 0.
 *
 * Contraintes reprises du reste de `scripts/` : zéro réseau, lectures en
 * try/catch (jamais `existsSync` puis lecture — fenêtre TOCTOU, CodeQL),
 * portable Windows (Git Bash) et Linux. prettier est invoqué via son point
 * d'entrée `node_modules` (pas de shim `.bin`, pas de `pnpm exec` : ~1 s de
 * moins par édition) ; s'il n'est pas installé (clone frais), on sort sans
 * bruit — lint-staged rattrapera au commit.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RACINE = path.resolve(import.meta.dirname, '..', '..');

/** Lit tout stdin (l'événement JSON du hook), ou rend `null`. */
function lireStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return null;
  }
}

const brut = lireStdin();
if (brut === null || brut === '') process.exit(0);

let evenement;
try {
  evenement = JSON.parse(brut);
} catch {
  process.exit(0);
}

const fichier = evenement?.tool_input?.file_path;
if (typeof fichier !== 'string' || fichier === '') process.exit(0);

// Ne toucher qu'aux fichiers du dépôt ; laisser tranquilles node_modules,
// caches Nx et sorties de build (prettier lit aussi .prettierignore, qui
// couvre notamment /pacts — des octets qui comptent).
const relatif = path.relative(RACINE, path.resolve(fichier));
if (
  relatif.startsWith('..') ||
  /(^|[\\/])(node_modules|\.nx|dist|out-tsc|coverage)([\\/]|$)/.test(relatif)
) {
  process.exit(0);
}

let prettier;
try {
  prettier = fs.realpathSync(
    path.join(RACINE, 'node_modules', 'prettier', 'bin', 'prettier.cjs'),
  );
} catch {
  process.exit(0); // pas installé (clone frais) : lint-staged rattrapera.
}

// Deux passes : voir l'en-tête. `--ignore-unknown` laisse passer les
// extensions que prettier ne gère pas sans en faire une erreur.
for (const passe of [1, 2]) {
  try {
    execFileSync(
      process.execPath,
      [prettier, '--write', '--ignore-unknown', relatif],
      { cwd: RACINE, stdio: ['ignore', 'ignore', 'pipe'] },
    );
  } catch (erreur) {
    const detail =
      erreur instanceof Error && 'stderr' in erreur
        ? String(erreur.stderr).trim()
        : String(erreur);
    // Code 2 : le message remonte à l'agent — un refus de parser signale en
    // général une vraie erreur de syntaxe dans le fichier tout juste écrit.
    console.error(
      `prettier n'a pas pu formater ${relatif} (passe ${passe}) : ${detail}`,
    );
    process.exit(2);
  }
}
process.exit(0);
