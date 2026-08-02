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
              // svc-foyer consomme le stream REFERENTIEL (barème de tranches
              // versionné, SFD 30 D2) → dépendance aux contrats du référentiel.
              onlyDependOnLibsWithTags: [
                'context:foyer',
                'context:shared',
                'context:referentiel',
              ],
            },
            {
              sourceTag: 'context:planification',
              onlyDependOnLibsWithTags: [
                'context:planification',
                'context:shared',
                // Consommateur des ÉVÉNEMENTS foyer (contracts-foyer) : la
                // projection `foyer.EnfantModifie` rafraîchit la dénormalisation
                // `contrat.enfant` (prénom). Couplage par contrats d'événements
                // uniquement — même schéma que tarification/notifications.
                'context:foyer',
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
      // === Ratchet relancé au lot D3 (chantier « consolidation », 2026-08-02). ===
      //
      // MÉTHODE — une règle passe en `error` quand le dépôt est à ZÉRO occurrence,
      // jamais avant : un `error` avec de la dette restante bloquerait la CI ou
      // ferait fleurir les `eslint-disable`. Le compteur de warnings de la CI
      // (`.github/workflows/scripts/lint-warnings.mjs` + `lint-baseline.json`)
      // interdit désormais toute REMONTÉE du reste. Pour promouvoir une règle :
      // solder ses occurrences, la déplacer dans le bloc « acquis », baisser la
      // baseline d'autant.
      //
      // ACQUIS (0 occurrence, verrouillé en `error`) — 10 règles au lot D3 :
      //  - déjà propres avant le lot (le ratchet était en panne, pas le code) :
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/restrict-plus-operands': 'error',
      '@typescript-eslint/no-unnecessary-type-conversion': 'error',
      //  - soldées PAR le lot D3 :
      '@typescript-eslint/no-dynamic-delete': 'error', // 7 → 0 (omission par déstructuration)
      '@typescript-eslint/prefer-optional-chain': 'error', // 3 → 0
      '@typescript-eslint/no-unused-expressions': 'error', // 1 → 0
      '@typescript-eslint/no-unnecessary-type-parameters': 'error', // 3 → 0
      //
      // RESTE EN `warn` — dette réelle, chacune avec son motif :
      // 1) Code tiers non typé (NestJS DI, libs sans types) :
      '@typescript-eslint/no-unsafe-assignment': 'warn', // 27
      '@typescript-eslint/no-unsafe-argument': 'warn', // 1, même famille
      '@typescript-eslint/no-non-null-assertion': 'warn', // 75
      '@typescript-eslint/restrict-template-expressions': 'warn', // 96
      // 2) Patterns légitimes du projet (faux positifs) :
      //    - constructeurs qui élargissent la visibilité protected→public (erreurs de domaine)
      '@typescript-eslint/no-useless-constructor': 'warn', // 27
      //    - classes à membres statiques (modules NestJS / namespaces utilitaires)
      '@typescript-eslint/no-extraneous-class': 'warn', // 45
      //    - conditions « défensives » rendues redondantes par noUncheckedIndexedAccess.
      //      D3 a soldé les 8 occurrences de specs (des `as` qui MENTAIENT en
      //      masquant un `| undefined`) ; les 7 restantes sont dans les composants
      //      web et portent du comportement (props optimistes, branche morte) —
      //      elles se traitent avec le lot C5, qui rouvre ces fichiers.
      '@typescript-eslint/no-unnecessary-condition': 'warn', // 15 → 8
      //    - méthodes passées en callback (NestJS, tests) sans usage de `this`
      '@typescript-eslint/unbound-method': 'warn', // 97
      // 3) Signaux informatifs / intentionnels :
      //    - no-unnecessary-type-assertion : non fiable sur les tests web (le
      //      projectService résout mal les types DOM/Testing-Library dans le
      //      tsconfig « solution »), avec des autofixes destructifs. En warn.
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/no-deprecated': 'warn', // 61
      //    - require-await : 196 occurrences, presque toutes des `async () => {}`
      //      de specs. Volume trop élevé pour ce lot ; candidat n°1 du suivant.
      '@typescript-eslint/require-await': 'warn',
      //    - no-invalid-void-type : 7 occurrences, TOUTES dans `web/src/api/client.ts`
      //      (`lire<void>(r)` pour les réponses 204). Les solder demande de
      //      scinder `lire<T>` en deux fonctions — refonte du client web, hors lot.
      '@typescript-eslint/no-invalid-void-type': 'warn',
      // no-unused-vars : on conserve le niveau « warn » historique de la base Nx,
      // mais on CODIFIE la convention déjà employée dans le dépôt (`_url`, `_init`,
      // `_strength`…) : un identifiant préfixé d'un souligné est délibérément
      // inutilisé. Indispensable depuis D3, où le retrait d'une clé s'écrit
      // `const { [k]: _retire, ...reste } = obj` (cf. no-dynamic-delete).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
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
    // react-hooks v7 (format flat) : inclut les règles du React Compiler
    // (purity, immutability, static-components, set-state-in-render, refs…) qui
    // signalent le code non compilable / non sûr pour la mémoïsation auto.
    ...reactHooks.configs.flat['recommended-latest'],
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
      // Diagnostics React Compiler signalant des anti-patterns sur du code
      // existant qui fonctionne (tests verts, build OK) : consultatifs, ratchetés
      // en « warn » le temps de les traiter sans risque de régression. Les autres
      // règles compiler (rules-of-hooks, static-components, use-memo, purity,
      // set-state-in-render…) restent en ERREUR. TODO ratchet.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/immutability': 'warn',
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
      // Déclarations émises par `tsc --build` (cible `typecheck`). Chaque config
      // ESLint de projet les ignore déjà ; sans cette ligne, un `eslint .` LANCÉ
      // À LA RACINE — ce que fait le compteur de warnings, `scripts/lint-warnings.mjs`
      // — sort des centaines d'erreurs de parsing « not found by the project service ».
      'out-tsc',
      '**/out-tsc',
      '.nx',
      'tmp',
      '**/vitest.config.*.timestamp*',
      '**/vite.config.*.timestamp*',
      '.stryker-tmp',
      '**/.stryker-tmp',
      // Fichiers GÉNÉRÉS (openapi-typescript, AQ-10) : sortie déterministe
      // comparée à l'octet près en CI (job openapi-types-drift). Aucun
      // formateur/linter ne doit y toucher — sinon lint-staged (qui tourne avec
      // CETTE config racine) réécrit le fichier (ex. consistent-indexed-object-style)
      // et fait diverger le diff. Miroir de `.prettierignore` et de la config
      // ESLint web-locale (apps/web/eslint.config.mjs).
      '**/*.gen.ts',
    ],
  },
];
