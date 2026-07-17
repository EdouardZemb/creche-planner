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
      // `app.module.ts` = racine de composition DI (pur câblage NestJS,
      // couvert par smoke-stack/e2e), non testable unitairement — même
      // catégorie que main.ts/tracing.ts (fondations lot 3).
      exclude: [
        'src/main.ts',
        'src/tracing.ts',
        'src/app.module.ts',
        '**/*.spec.ts',
      ],
      // Ratchet relevé au lot 3 « fondations » (marge ~2 pts sous le plancher
      // atteint : stmts 59,7 / br 66,9 / fn 49,0 / lines 59,3 après ajout des
      // tests d'assertion propagée — `entetesAval`, interceptor, config — et
      // exclusion d'app.module de la couverture).
      // Ratchet relevé au lot 6 « fondations » (couverture des clients BFF
      // jusqu'ici à 0 % de fonctions couvertes : `planification.client.ts`,
      // `tarification.client.ts`, `notifications.client.ts` — succès, erreur
      // HTTP, timeout via `executerResilient`, assertion d'identité) — mesuré
      // 67,55 / 71,34 / 54,71 / 67,40, marge ~2 pts.
      thresholds: {
        statements: 65,
        branches: 69,
        functions: 52,
        lines: 65,
      },
    },
  },
}));
