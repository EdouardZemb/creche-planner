import { defineConfig } from 'drizzle-kit';

// Configuration des migrations Drizzle du Référentiel (base dédiée).
// Phase 1 : schéma vide → migration vide. `pnpm drizzle-kit generate` (re)génère
// le SQL ; `migrate` l'applique (exécuté au boot ou via une tâche d'init).
export default defineConfig({
  schema: './src/database/schema.ts',
  out: './src/database/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env['DATABASE_URL'] ??
      'postgres://referentiel:referentiel@localhost:5433/referentiel',
  },
});
