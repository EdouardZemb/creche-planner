# Migrations différées — svc-planification

Ce dossier contient des migrations **volontairement non appliquées** : elles
dépendent d'une **opération de données préalable** et casseraient le démarrage du
service si elles tournaient trop tôt.

> ⚠️ Le dossier est **sœur** de `migrations/` et **n'est pas** inclus dans les
> assets webpack (`webpack.config.js` ne bundle que `src/database/migrations`).
> Rien ici n'est embarqué dans l'image ni appliqué au boot par le `MigrationService`
> (qui ne joue que les migrations **journalisées** de `migrations/meta/_journal.json`).

## `0004_contrat_etablissement_not_null.sql`

Verrou final de la **Phase 5** (« établissements en entité libre ») : passe
`contrat.etablissement_id` de NULLABLE (posé en P2) à **NOT NULL**.

**Pré-requis impératif** : tous les contrats de production doivent d'abord avoir un
établissement rattaché via le back-fill — sinon l'`ALTER … SET NOT NULL` échoue.

### Procédure de promotion (geste humain, après bascule confirmée)

1. **Back-fill** : exécuter `scripts/backfill-etablissements.mjs` en `--apply`
   (cf. runbook **doc 06 §25**). La vérification post-run doit afficher
   **`0 contrat(s) … encore sans établissement`**.
2. **Promotion via Drizzle (voie recommandée — release standard)** :
   - ajouter `.notNull()` à `etablissementId` dans
     [`schema.ts`](../schema.ts) (table `contrat`) ;
   - régénérer la migration : `pnpm exec drizzle-kit generate` (config
     `apps/svc-planification/drizzle.config.ts`). Drizzle produit un
     `migrations/0004_*.sql` **identique** au SQL de ce dossier, **plus** l'entrée
     `meta/_journal.json` et le snapshot — appliqué au prochain déploiement par le
     `MigrationService` ;
   - supprimer ce fichier différé (remplacé par la vraie migration journalisée).
3. **Alternative one-shot (hors cycle de release)** : appliquer le DDL à la main
   sur la base de production (`psql … -f 0004_contrat_etablissement_not_null.sql`),
   puis aligner le schéma à la release suivante. À réserver aux cas d'urgence.

Tant que cette promotion n'a pas eu lieu, la colonne **reste NULLABLE** et le code
tolère un `etablissement_id` nul (rétro-compatibilité P2).
