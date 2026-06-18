import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/svc-referentiel',
  test: {
    name: 'svc-referentiel',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: process.env['CI']
      ? [
          'default',
          ['junit', { outputFile: './test-output/vitest/junit.xml' }] as [
            'junit',
            { outputFile: string },
          ],
        ]
      : ['default'],
    // Vérification de contrat Pact (provider) : boot du bundle + base réelle.
    // Pas de seuil de couverture (test d'intégration, pas unitaire).
    coverage: { enabled: false, provider: 'v8' as const },
    testTimeout: 60000,
    hookTimeout: 60000,
  },
}));
