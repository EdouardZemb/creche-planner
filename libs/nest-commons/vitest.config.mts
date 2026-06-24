import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/nest-commons',
  test: {
    name: 'nest-commons',
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
    // Lib d'infrastructure (wrappers Nest) : specs unitaires ciblées, pas de
    // seuil de couverture global (le 100 % imposé porte sur les libs domaine).
    coverage: { enabled: false, provider: 'v8' as const },
  },
}));
