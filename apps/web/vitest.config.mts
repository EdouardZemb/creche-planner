import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tests de composants (jsdom + Testing Library). Pas de seuil de couverture sur
// une app (la règle 100 % ne vise que les libs domaine — doc 06 §5/§6).
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
    coverage: { enabled: false, provider: 'v8' as const },
  },
});
