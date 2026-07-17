import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/api-gateway',
  test: {
    name: 'api-gateway',
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
      // inférieur, jamais abaissé — doc 03 §6). Le 100 % ne vise que les libs
      // domaine ; ici on empêche toute régression silencieuse (AQ-06).
      enabled: true,
      provider: 'v8' as const,
      reportsDirectory: './test-output/vitest/coverage',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      // `include` explicite : depuis Vitest 3, seuls les fichiers listés ici
      // sont rapportés même s'ils ne sont jamais chargés par un test.
      include: ['src/**/*.ts'],
      // Bootstrap process (main/tracing) : exécutés au boot du conteneur,
      // couverts par smoke-stack, non testables unitairement.
      exclude: ['src/main.ts', 'src/tracing.ts', '**/*.spec.ts'],
      // Ratchet relevé au lot 2 « fondations » (marge ~2 pts sous le plancher
      // atteint : stmts 58,4 / br 65,5 / fn 47,6 / lines 58,0 après ajout des
      // tests de métrique `gateway_authz_refus_total` sur `appartenance.guard`).
      thresholds: {
        statements: 56,
        branches: 63,
        functions: 45,
        lines: 56,
      },
    },
  },
}));
