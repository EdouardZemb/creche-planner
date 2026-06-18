import baseConfig from '../../eslint.config.mjs';

// La couche React (eslint-plugin-react / react-hooks / jsx-a11y) et l'exclusion
// des tests web du lint type-aware sont définies dans le root eslint.config.mjs
// (globs **/*.{jsx,tsx} et **/*.test.{ts,tsx}, propres à web), afin qu'elles
// s'appliquent aussi bien sous `nx lint web` que sous lint-staged (qui lance
// eslint depuis la racine, sans cascade par dossier du flat config).
export default [
  ...baseConfig,
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out-tsc',
      'vite.config.mts',
      'vitest.config.mts',
      'playwright.config.ts',
      '**/*.gen.ts',
    ],
  },
];
