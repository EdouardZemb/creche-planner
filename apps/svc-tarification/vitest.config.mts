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
      // inférieur, jamais abaissé — audit 2026-07 lot 1a ; le 100 % imposé reste
      // réservé aux libs domaine). La vérif Pact provider (bundle en process
      // enfant) n'y contribue pas : la mesure vient des specs unitaires in-process.
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
      // Relevés après le lot 1 « Fondations » : le consumer JetStream (0 % couvert)
      // quitte ce service pour nest-commons, le plancher atteint monte à
      // 76 / 75 / 73 / 75. On garde une marge volontairement large (~4-5 pts) car
      // les specs de résilience sont sensibles au timing (cf. historique branches).
      thresholds: {
        statements: 72,
        branches: 70,
        functions: 68,
        lines: 72,
      },
    },
    testTimeout: 60000,
    hookTimeout: 60000,
  },
}));
