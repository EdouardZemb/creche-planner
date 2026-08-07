import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/libs/contracts/kernel',
  test: {
    name: 'contracts-kernel',
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
      // Mesuré 100 % (8/8 lignes) — mais LIRE CE CHIFFRE AVEC PRUDENCE, il ne
      // dit pas ce qu'on croit. `openapi/gateway.openapi.ts` fait 2810 lignes
      // et ne pèse qu'UNE ligne au rapport v8 : c'est un unique `export const`
      // dont le littéral entier compte pour une seule instruction. Un seuil à
      // 100 % sur ce projet prouve donc que le module est IMPORTÉ, rien de
      // plus — le contenu du contrat, lui, est gardé par la spec de D6 (graphe
      // de modules Nest vs document) et par `verifier-frontieres.mjs` (D4).
      // Le seuil reste utile : il rattrape tout nouveau fichier de `src/lib`
      // ajouté sans test. Il ne remplace pas les deux gardes ci-dessus.
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
}));
