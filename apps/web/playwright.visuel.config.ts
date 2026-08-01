import { defineConfig, devices } from '@playwright/test';

// Non-régression VISUELLE (`*.visuel.e2e.spec.ts`). Config séparée, sur le modèle
// de `playwright.stack.config.ts`, pour la même raison : ces specs ne doivent
// JAMAIS être ramassées par `nx e2e web`.
//
// Pourquoi hors de la CI par défaut : le balayage visite 13 routes × 2 viewports
// et mesure 37 propriétés calculées sur ~4 600 nœuds (~1 min). Sa valeur n'est pas
// d'échouer sur un seuil absolu — la page peut légitimement changer — mais de
// produire une EMPREINTE que l'on COMPARE à celle d'avant une refonte, avec
// `scripts/comparer-empreinte.mjs`. C'est un outil de revue, pas une porte de CI.
//
// Le BFF est mocké dans la spec (`page.route`) : exécution offline, sans pile
// docker. Le `webServer` ne sert que le front.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.visuel.e2e.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  // Aucun retry : un balayage est une MESURE. La rejouer masquerait une
  // instabilité de rendu, qui est précisément ce qu'on cherche à voir.
  retries: 0,
  reporter: 'list',
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
