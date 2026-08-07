import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/libs/contracts/referentiel',
  test: {
    name: 'contracts-referentiel',
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
      // Lot D8 — cette lib déclarait un `reportsDirectory` mais JAMAIS
      // `enabled` : la couverture n'était donc pas calculée, et la CI lance
      // `nx affected -t lint typecheck test build` SANS `--coverage`. Aucun
      // `coverage-summary.json` n'était émis — or c'est le seul glob que lit
      // `coverage-compare.mjs` (ratchet AQ-06). Le projet n'était pas « mal
      // couvert », il était INVISIBLE : même angle mort qu'en D2
      // (`nest-commons`, `observability`), cinq projets plus loin.
      enabled: true,
      provider: 'v8' as const,
      reportsDirectory: './test-output/vitest/coverage',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      // `include` explicite : depuis Vitest 3, les fichiers jamais chargés par
      // un test sont tout de même rapportés (vérifié fichier par fichier — le
      // dénominateur couvre bien tout `src/lib`). Barrel `src/index.ts` exclu
      // comme pour `resilience`/`observability` : réexports sans code exécutable.
      include: ['src/lib/**/*.ts'],
      exclude: ['src/index.ts', '**/*.spec.ts'],
      // Mesuré 100 % (17/17 lignes) : le contrat d'événements est un jeu de
      // schémas zod, tous instanciés par la spec. Seuil posé au mesuré, comme
      // les autres briques partagées (doc 03 §6).
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
}));
