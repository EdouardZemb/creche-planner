import { defineConfig, devices } from '@playwright/test';

// E2E « stack réelle » (Phase 15). Contrairement à l'E2E mocké (playwright.config.ts),
// ces tests s'exécutent contre la pile Docker complète (docker compose up) servie par
// le conteneur `web` sur http://localhost:4200 (nginx proxifie /api/ → api-gateway:3000).
//
// Conséquences :
//  - AUCUN mock réseau (pas de page.route) : on valide la vraie intégration back/front.
//  - PAS de `webServer` : la stack Docker fournit déjà le front (orchestrée par
//    scripts/e2e-stack.mjs). Lancer `nx serve web` ici entrerait en conflit sur le port 4200.
//  - `workers: 1` + `fullyParallel: false` : la pile est un ÉTAT PARTAGÉ unique
//    (projection NATS→tarification en cohérence éventuelle, gateway sous charge).
//    Sérialiser TOUTES les specs (un seul worker) évite les courses entre parcours
//    ET la contention sur les endpoints lents (ex. /couts/annuel agrège 12 mois et
//    frôle le repli 502 de la gateway si plusieurs specs tapent en parallèle).
export default defineConfig({
  testDir: './e2e',
  // Ne ramasse QUE les specs stack réelle (les *.e2e.spec.ts mockés restent à `nx e2e`).
  testMatch: '**/*.stack.e2e.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  // AQ-06 (doc 27) — mêmes reporters CI que playwright.config.ts, dans un dossier
  // distinct (playwright-stack) pour que les artefacts mocké/stack ne s'écrasent pas.
  reporter: process.env['CI']
    ? [
        ['line'],
        ['junit', { outputFile: 'test-output/playwright-stack/junit.xml' }],
        ['json', { outputFile: 'test-output/playwright-stack/results.json' }],
      ]
    : 'list',
  use: {
    baseURL: process.env['STACK_BASE_URL'] ?? 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
