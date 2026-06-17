// AQ-13 (doc 27) — mutation testing du cœur tarifaire (calculs d'argent, ROI max).
// Exécution : `pnpm nx run tarification-domain:mutation` (hors CI bloquante,
// cf. .github/workflows/mutation.yml). Seuil `break` aligné sur la cible ≥ 80 %.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  // pnpm n'hoiste pas dans les libs : le glob par défaut `@stryker-mutator/*`
  // ne scanne que le node_modules local → plugin déclaré explicitement
  // (résolution Node, remonte jusqu'au node_modules racine du workspace).
  plugins: ['@stryker-mutator/vitest-runner'],
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.mts' },
  // Mêmes exclusions que la couverture vitest : barrel + fichier de types purs
  // (aucun code exécutable, donc aucun mutant possible).
  mutate: [
    'src/lib/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/lib/core/politique-tarifaire.ts',
  ],
  thresholds: { high: 90, low: 80, break: 80 },
  reporters: ['html', 'json', 'clear-text', 'progress'],
  htmlReporter: { fileName: 'test-output/stryker/mutation.html' },
  jsonReporter: { fileName: 'test-output/stryker/mutation.json' },
  incrementalFile: 'test-output/stryker/incremental.json',
  tempDirName: '.stryker-tmp',
};

export default config;
