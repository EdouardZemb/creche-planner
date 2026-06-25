#!/usr/bin/env node
// @ts-check
/**
 * Orchestration des tests E2E « stack réelle » (Phase 15, Lot 1).
 *
 * Enchaîne, de bout en bout et sans mock réseau :
 *   1. `docker compose up -d --build --wait` — monte TOUTE la pile et attend les
 *      healthchecks (services + conteneur `web` sur :4200).
 *   2. `node scripts/seed-demo.mjs --verify` — amorce l'état connu du foyer de référence
 *      ET garde les coûts (échoue si la projection ne reproduit pas les montants).
 *   3. `pnpm exec playwright test -c apps/web/playwright.stack.config.ts` — joue les
 *      parcours contre la vraie UI servie par Docker.
 *
 * Teardown : `docker compose down -v` dans un `finally`, SAUF si KEEP_STACK est défini
 * (debug : on garde la pile et l'état debout pour inspecter).
 *
 * Zéro dépendance (Node ESM pur, comme scripts/seed-demo.mjs). Propage le code de
 * sortie de Playwright.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Racine du dépôt : scripts/ → remonter d'un niveau.
const RACINE_REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

// Dossier du front : `@playwright/test` n'est installé QUE dans apps/web (devDep),
// donc `pnpm exec playwright` doit être lancé depuis là (comme la cible `nx e2e web`).
const DIR_WEB = join(RACINE_REPO, 'apps', 'web');

// Services APPLICATIFS à monter pour l'E2E. On NE monte PAS toute la pile : leurs
// `depends_on` tirent déjà l'infra requise (4 Postgres, NATS, otel-collector→tempo),
// mais on EXCLUT volontairement les sidecars d'observabilité non essentiels
// (prometheus, grafana, nats-exporter). Raison : `--wait` échoue si UN conteneur
// sort, or `nats-exporter` peut sortir (code 2) au démarrage à froid — un défaut
// d'observabilité ne doit pas faire échouer l'E2E. Bonus : démarrage CI plus rapide.
const SERVICES = [
  'web',
  'api-gateway',
  'svc-referentiel',
  'svc-foyer',
  'svc-planification',
  'svc-tarification',
  'svc-notifications',
];

/**
 * Lance une commande en héritant des flux (stdio: 'inherit') et résout avec son
 * code de sortie. Rejette si le process ne peut pas démarrer (binaire absent…).
 * @param {string} commande
 * @param {string[]} args
 * @param {string} [cwd] répertoire d'exécution (défaut : racine du dépôt)
 * @returns {Promise<number>}
 */
function executer(commande, args, cwd = RACINE_REPO) {
  return new Promise((resoudre, rejeter) => {
    // Un shell n'est requis QUE sous Windows (résolution des shims `pnpm.cmd`,
    // `docker.exe` via le PATH) ; sous Linux/CI, spawn direct — pas de process
    // shell intermédiaire. Le nosemgrep (AQ-11) couvre le résidu Windows :
    // toutes les commandes/args de ce script sont des LITTÉRAUX (aucune entrée
    // externe, script de dev/CI), le risque d'injection visé par la règle est nul.
    // nosemgrep: javascript.lang.security.audit.spawn-shell-true
    const proc = spawn(commande, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    proc.on('error', rejeter);
    proc.on('close', (code) => resoudre(code ?? 0));
  });
}

/** Lance une étape et stoppe net si elle échoue (code ≠ 0). */
async function etape(libelle, commande, args, cwd) {
  console.log(`\n▶ ${libelle}`);
  const code = await executer(commande, args, cwd);
  if (code !== 0) {
    throw new Error(`Étape « ${libelle} » échouée (code ${code}).`);
  }
}

async function main() {
  let codePlaywright = 1;
  try {
    // 1. Pile complète. `--build` garantit des images à jour (reflète le code local) :
    //    compromis temps (rebuild) contre fiabilité — on préfère ne pas tester d'images obsolètes.
    await etape(
      'Démarrage de la pile (docker compose up --build --wait)',
      'docker',
      ['compose', 'up', '-d', '--build', '--wait', ...SERVICES],
    );

    // 2. Seed + garde des coûts (le --verify échoue si les montants ne sont pas reproduits).
    await etape('Amorçage des données de référence (seed --verify)', 'node', [
      'scripts/seed-demo.mjs',
      '--verify',
    ]);

    // 3. Playwright stack réelle, lancé DEPUIS apps/web (où vit @playwright/test) ;
    //    le chemin de config est donc relatif à ce dossier. On NE stoppe PAS sur
    //    échec : on récupère le code pour le propager APRÈS le teardown (finally).
    console.log('\n▶ Tests E2E stack réelle (Playwright)');
    codePlaywright = await executer(
      'pnpm',
      ['exec', 'playwright', 'test', '-c', 'playwright.stack.config.ts'],
      DIR_WEB,
    );
  } finally {
    // Teardown systématique, sauf debug explicite (KEEP_STACK).
    if (process.env.KEEP_STACK) {
      console.log(
        '\n⏸ KEEP_STACK défini : pile laissée debout (docker compose down -v à faire à la main).',
      );
    } else {
      console.log('\n▼ Arrêt de la pile (docker compose down -v)');
      // On ne masque pas une erreur de teardown, mais on n'écrase pas le code Playwright.
      await executer('docker', ['compose', 'down', '-v']).catch(() => {
        /* teardown best-effort : on n'écrase pas le code Playwright */
      });
    }
  }

  if (codePlaywright !== 0) {
    console.error(
      `\n❌ Tests E2E stack réelle échoués (code ${codePlaywright}).`,
    );
    process.exit(codePlaywright);
  }
  console.log('\n✅ Tests E2E stack réelle réussis.');
}

main().catch((e) => {
  console.error(`\n❌ Échec de l'orchestration E2E stack : ${e.message}`);
  process.exit(1);
});
