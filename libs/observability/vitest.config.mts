import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/observability',
  test: {
    name: 'observability',
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
    coverage: {
      // Brique d'infrastructure partagée : couverture complète exigée comme les
      // libs cœur (doc 03 §6). Les fichiers purement types (index barrel) sont
      // exclus car sans code exécutable.
      //
      // Lot D2 : la lib n'avait AUCUN test ni cible `test`. Les deux modules
      // (`logging`, `tracing`) sont petits et intégralement couverts, donc le
      // seuil est posé d'emblée à 100 % comme pour `resilience` — un plancher
      // plus bas laisserait passer une régression sans rien exiger de plus.
      enabled: true,
      provider: 'v8' as const,
      reportsDirectory: './test-output/vitest/coverage',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['src/lib/**/*.ts'],
      exclude: ['src/index.ts', '**/*.spec.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
}));
