import nx from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
  // Racine de résolution des tsconfig, fixée globalement : typescript-eslint v8
  // exige un tsconfigRootDir non ambigu dès qu'un projet a plusieurs tsconfig.
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  ...nx.configs['flat/base'],
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            {
              sourceTag: 'type:domain',
              onlyDependOnLibsWithTags: ['type:domain'],
            },
            {
              sourceTag: 'type:infrastructure',
              onlyDependOnLibsWithTags: [
                'type:infrastructure',
                'type:domain',
                'type:contracts',
              ],
            },
            {
              sourceTag: 'type:contracts',
              onlyDependOnLibsWithTags: ['type:contracts'],
            },
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:app',
                'type:infrastructure',
                'type:domain',
                'type:contracts',
              ],
            },
            {
              sourceTag: 'context:shared',
              onlyDependOnLibsWithTags: ['context:shared'],
            },
            {
              sourceTag: 'context:referentiel',
              onlyDependOnLibsWithTags: [
                'context:referentiel',
                'context:shared',
              ],
            },
            {
              sourceTag: 'context:foyer',
              onlyDependOnLibsWithTags: ['context:foyer', 'context:shared'],
            },
            {
              sourceTag: 'context:planification',
              onlyDependOnLibsWithTags: [
                'context:planification',
                'context:shared',
              ],
            },
            {
              sourceTag: 'context:tarification',
              onlyDependOnLibsWithTags: [
                'context:tarification',
                'context:shared',
                'context:foyer',
                'context:referentiel',
                'context:planification',
              ],
            },
            {
              sourceTag: 'context:gateway',
              onlyDependOnLibsWithTags: ['context:gateway', 'context:shared'],
            },
            {
              sourceTag: 'context:web',
              onlyDependOnLibsWithTags: ['context:web', 'context:shared'],
            },
          ],
        },
      ],
    },
  },
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  // Couche type-aware (typescript-eslint v8) : la plus exigeante. Activée sur les
  // seuls fichiers TS inclus dans un tsconfig (projectService résout le bon
  // tsconfig.app/lib/spec par fichier). Les fichiers JS/MJS/config en sont exclus
  // plus bas car hors programme TypeScript.
  ...tseslint.config({
    files: ['**/*.ts', '**/*.tsx', '**/*.cts', '**/*.mts'],
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // === Anti-bug : ERREUR dès maintenant (haute valeur, code déjà conforme). ===
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      // NB : toutes les autres règles strictTypeChecked/stylisticTypeChecked
      // auto-corrigeables (array-type, no-unnecessary-type-assertion,
      // no-confusing-void-expression, consistent-type-*, etc.) restent en ERREUR
      // par défaut — le code a été corrigé via `eslint --fix`.
      //
      // === Ratchet (warn → error progressif). TODO ratchet : remonter lib par lib. ===
      // 1) Code tiers non typé (NestJS DI, libs sans types) :
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/restrict-plus-operands': 'warn',
      // 2) Patterns légitimes du projet (faux positifs) :
      //    - constructeurs qui élargissent la visibilité protected→public (erreurs de domaine)
      '@typescript-eslint/no-useless-constructor': 'warn',
      //    - classes à membres statiques (modules NestJS / namespaces utilitaires)
      '@typescript-eslint/no-extraneous-class': 'warn',
      //    - conditions « défensives » rendues redondantes par noUncheckedIndexedAccess
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/no-unnecessary-type-parameters': 'warn',
      //    - méthodes passées en callback (NestJS, tests) sans usage de `this`
      '@typescript-eslint/unbound-method': 'warn',
      // 3) Signaux informatifs / intentionnels :
      //    - no-unnecessary-type-assertion : non fiable sur les tests web (le
      //      projectService résout mal les types DOM/Testing-Library dans le
      //      tsconfig « solution »), avec des autofixes destructifs. En warn.
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/no-deprecated': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-dynamic-delete': 'warn',
      '@typescript-eslint/no-invalid-void-type': 'warn',
      '@typescript-eslint/no-unnecessary-type-conversion': 'warn',
      '@typescript-eslint/prefer-optional-chain': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      // no-unused-vars : on conserve le niveau « warn » historique de la base Nx.
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  }),
  // Fichiers hors programme TS (config, scripts, JS) : on neutralise les règles
  // type-aware qui exigeraient des informations de types.
  ...tseslint.config({
    files: ['**/*.js', '**/*.cjs', '**/*.mjs', '**/*.jsx'],
    extends: [tseslint.configs.disableTypeChecked],
  }),
  // Fichiers TS hors tsconfig (specs e2e Playwright, *.config.ts, helpers e2e) :
  // pas inclus dans un programme TS → on les lint sans projectService (sinon
  // « not found by the project service ») et sans règles type-aware.
  ...tseslint.config({
    files: ['**/e2e/**/*.ts', '**/*.config.ts', '**/*.config.mts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: { projectService: false, project: null },
    },
  }),
  // Tests web (jsdom + Testing Library) — `*.test.ts(x)` n'est utilisé QUE par
  // apps/web (les services/libs utilisent `*.spec.ts`). Le projectService résout
  // mal les types DOM dans le tsconfig « solution » de web (autofixes destructifs
  // sur les casts HTMLInputElement) ; on les lint sans type-info, `tsc -p
  // tsconfig.spec.json` couvrant déjà leur typage. Déclaré au root (et non dans
  // apps/web/eslint.config.mjs) pour s'appliquer aussi sous lint-staged, qui
  // lance eslint depuis la racine sans cascade par dossier (flat config).
  ...tseslint.config({
    files: ['**/*.test.ts', '**/*.test.tsx'],
    extends: [tseslint.configs.disableTypeChecked],
  }),
  // --- Couche React (apps/web — seul projet avec du JSX/TSX) ----------------
  // Au root pour les mêmes raisons (lint-staged + résolution des directives
  // eslint-disable jsx-a11y/react-*). Les globs **/*.{jsx,tsx} ne matchent que
  // web et fonctionnent sous les deux cwd (nx par-projet et lint-staged racine).
  { ...react.configs.flat.recommended, files: ['**/*.jsx', '**/*.tsx'] },
  { ...react.configs.flat['jsx-runtime'], files: ['**/*.jsx', '**/*.tsx'] },
  {
    ...reactHooks.configs['recommended-latest'],
    files: ['**/*.jsx', '**/*.tsx'],
  },
  { ...jsxA11y.flatConfigs.recommended, files: ['**/*.jsx', '**/*.tsx'] },
  {
    files: ['**/*.jsx', '**/*.tsx'],
    settings: { react: { version: 'detect' } },
    rules: {
      // rules-of-hooks reste en erreur (critique). exhaustive-deps en « warn »
      // (recommandation React : autofix risqué). TODO ratchet.
      'react-hooks/exhaustive-deps': 'warn',
      'react/jsx-no-useless-fragment': 'error',
      'react/self-closing-comp': 'error',
      'react/jsx-boolean-value': ['error', 'never'],
    },
  },
  {
    ignores: [
      '**/node_modules',
      'dist',
      '**/dist',
      'coverage',
      '**/coverage',
      '.nx',
      'tmp',
      '**/vitest.config.*.timestamp*',
      '**/vite.config.*.timestamp*',
      '.stryker-tmp',
      '**/.stryker-tmp',
    ],
  },
];
