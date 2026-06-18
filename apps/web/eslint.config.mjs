import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    // Override or add rules here
    rules: {},
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    // Override or add rules here
    rules: {},
  },
  {
    files: ['**/*.js', '**/*.jsx'],
    // Override or add rules here
    rules: {},
  },
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
