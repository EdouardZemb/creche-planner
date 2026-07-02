import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tests de composants (jsdom + Testing Library). Le 100 % ne vise que les libs
// domaine (doc 06 §5/§6) ; ici, seuils RATCHET au niveau constaté (audit 2026-07
// lot 1a) pour bloquer toute régression silencieuse.
export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/web-test',
  plugins: [react()],
  test: {
    name: 'web',
    watch: false,
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
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
      enabled: true,
      provider: 'v8' as const,
      reportsDirectory: './test-output/vitest/coverage',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      // `include` explicite : depuis Vitest 3, seuls les fichiers listés ici
      // sont rapportés même s'ils ne sont jamais chargés par un test.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        // Bootstrap (montage React), setup de test, types générés depuis le
        // contrat OpenAPI (aucun code exécutable) — hors périmètre.
        'src/main.tsx',
        'src/test-setup.ts',
        'src/api/openapi-types.gen.ts',
        'src/**/*.{test,spec}.{ts,tsx}',
      ],
      thresholds: {
        statements: 83,
        branches: 75,
        functions: 72,
        lines: 85,
      },
    },
  },
});
