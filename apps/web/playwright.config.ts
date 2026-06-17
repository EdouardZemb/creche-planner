import { defineConfig, devices } from '@playwright/test';

// E2E Phase 8 (DoD : « planifier un mois → lire le coût consolidé »). Le BFF est
// mocké par interception réseau (page.route) dans les specs → exécution offline,
// déterministe, sans pile docker. Le webServer ne sert que le front (vite dev).
export default defineConfig({
  testDir: './e2e',
  // Les specs « stack réelle » (*.stack.e2e.spec.ts) ont leur propre config
  // (playwright.stack.config.ts) : `nx e2e web` (mocké) ne doit JAMAIS les embarquer.
  testIgnore: '**/*.stack.e2e.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  // AQ-06 (doc 27) — en CI, JUnit + JSON archivés en artefacts (métriques
  // historisées). Le JSON porte l'outcome par test — « flaky » = passé après
  // retry — compté dans le summary par e2e-summary.mjs. Chemins relatifs à
  // apps/web (cwd des cibles nx e2e et de scripts/e2e-stack.mjs).
  reporter: process.env['CI']
    ? [
        ['line'],
        ['junit', { outputFile: 'test-output/playwright/junit.xml' }],
        ['json', { outputFile: 'test-output/playwright/results.json' }],
      ]
    : 'list',
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm nx serve web',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
