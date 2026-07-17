import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/svc-planification',
  test: {
    name: 'svc-planification',
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
      // Couverture mesurée + seuils RATCHET (niveau constaté arrondi à l'entier
      // inférieur, jamais abaissé — audit 2026-07 lot 1a). La vérif Pact provider
      // (bundle en process enfant) n'y contribue pas : la mesure vient des specs
      // unitaires in-process.
      enabled: true,
      provider: 'v8' as const,
      reportsDirectory: './test-output/vitest/coverage',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      // `include` explicite : depuis Vitest 3, seuls les fichiers listés ici
      // sont rapportés même s'ils ne sont jamais chargés par un test.
      include: ['src/**/*.ts'],
      // Bootstrap process (main/tracing) : exécutés au boot du conteneur,
      // couverts par smoke-stack, non testables unitairement.
      // `app.module.ts` = racine de composition DI (pur câblage NestJS,
      // couvert par smoke-stack/e2e), non testable unitairement — même
      // catégorie que main.ts/tracing.ts (fondations lot 3).
      exclude: [
        'src/main.ts',
        'src/tracing.ts',
        'src/app.module.ts',
        '**/*.spec.ts',
      ],
      // Relevés après le lot 1 « Fondations » : consumer JetStream mutualisé dans
      // nest-commons + tests ajoutés sur lireContrat/supprimerContrat pour compenser
      // la couverture partie avec le consumer. Plancher atteint 82 / 83 / 67 / 83,
      // ~2 pts de marge.
      // Ratchet relevé au lot 3 (mesuré 83,5/83,4/69,4/84,5).
      // Ratchet relevé au lot 4 « Fondations » (scoping : résolveur foyer +
      // décorateurs sur les 2 controllers + specs resolver/intégration enforce) —
      // mesuré 85,0/84,8/70,4/86,0.
      thresholds: {
        statements: 83,
        branches: 82,
        functions: 68,
        lines: 83,
      },
    },
    testTimeout: 60000,
    hookTimeout: 60000,
  },
}));
