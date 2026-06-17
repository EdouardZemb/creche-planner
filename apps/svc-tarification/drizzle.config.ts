import { defineConfig } from 'drizzle-kit';

// Configuration des migrations Drizzle du service Tarification (base dédiée).
// `pnpm drizzle-kit generate` (re)génère le SQL depuis `schema.ts` ; `migrate`
// l'applique (exécuté au boot via MigrationService ou manuellement).
export default defineConfig({
  schema: './src/database/schema.ts',
  out: './src/database/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env['DATABASE_URL'] ??
      'postgres://tarification:tarification@localhost:5436/tarification',
  },
});
