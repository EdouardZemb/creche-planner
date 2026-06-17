# Migrations Drizzle — svc-referentiel

Phase 4 : catalogue tarifaire versionné. La migration `0000_referentiel_initial`
crée `grille_abcm`, `bareme_psu`, `frais_fixes_abcm`, `jour_non_facturable` et
`outbox`. Elle est appliquée **au boot** par `MigrationService` (assets webpack →
`dist/database/migrations`), comme pour `svc-foyer`.

Régénérer après une évolution de `../schema.ts` :

```bash
pnpm drizzle-kit generate --config=apps/svc-referentiel/drizzle.config.ts   # génère le SQL
pnpm drizzle-kit migrate  --config=apps/svc-referentiel/drizzle.config.ts   # applique sur la base dédiée
```
