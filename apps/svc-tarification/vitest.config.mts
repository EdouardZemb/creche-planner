import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/svc-tarification',
  test: {
    name: 'svc-tarification',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: process.env.CI
      ? [
          'default',
          ['junit', { outputFile: './test-output/vitest/junit.xml' }] as [
            'junit',
            { outputFile: string },
          ],
        ]
      : ['default'],
    // Specs unitaires (orchestration/résilience/projection) + vérification Pact
    // provider (boot du bundle + base réelle). Pas de seuil de couverture global :
    // tests d'app + intégration (le 100 % imposé porte sur les libs domaine).
    coverage: { enabled: false, provider: 'v8' as const },
    testTimeout: 60000,
    hookTimeout: 60000,
  },
}));
