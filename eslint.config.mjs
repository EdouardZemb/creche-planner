import nx from '@nx/eslint-plugin';

export default [
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
