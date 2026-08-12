import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/nest-commons',
  test: {
    name: 'nest-commons',
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
    // Lot D2 : la couverture était DÉSACTIVÉE ici — donc ni seuil local, ni
    // `coverage-summary.json`, donc invisible au ratchet CI (AQ-06) qui compare
    // à la baseline. C'est l'infra la plus critique du dépôt (outbox, sécurité,
    // migrations) : elle est désormais mesurée ET plancher-nnée.
    //
    // Les seuils valent le niveau MESURÉ arrondi vers le bas — un plancher
    // anti-régression, pas un objectif. On les remonte quand la couverture
    // monte ; on ne les baisse jamais (c'est le ratchet).
    //
    // Ce qui reste non couvert est assumé : les `*.module.ts` (câblage DI sans
    // logique), les fabriques d'options, et `nats.service.ts` (connexion NATS
    // réelle — du ressort des tests d'intégration, pas de l'unitaire).
    coverage: {
      enabled: true,
      provider: 'v8' as const,
      reportsDirectory: './test-output/vitest/coverage',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['src/lib/**/*.ts'],
      exclude: ['src/index.ts', '**/*.spec.ts'],
      thresholds: { statements: 84, branches: 81, functions: 76, lines: 84 },
    },
  },
}));
