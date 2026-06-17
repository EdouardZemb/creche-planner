# 23 — Smoke de performance (`/api/v1/couts/annuel`)

> Statut : **Établi** · Version 1.0 · 2026-06-07
> Définit le **SLO de latence** de l'agrégation annuelle et le **smoke de performance**
> qui en fait une régression détectable en CI. Donne suite à l'action **P2-6**
> ([doc 18](18-audit-gestion-tests-ctal-tm-tmmi.md) §8 ; axe E.8/F.3, PA TMMi 3.4).

---

## 1. Pourquoi cette route

`GET /api/v1/couts/annuel` est la route **la plus coûteuse** du produit : elle agrège les
**12 mois** d'un foyer. Un défaut de sérialisation y avait fait passer la latence de **~0,93 s**
à **~7 s / 502** sous concurrence ([doc 06](06-etat-davancement.md) §19.7, corrigé par
parallélisation + single-flight). Sans garde, cette classe de régression est **invisible** jusqu'à
l'usage réel — d'où ce smoke (risque **RT-05** du [registre de risque](19-registre-risque-produit.md)).

## 2. SLO & seuils

| Seuil                         | Valeur                           | Rôle                                                                              |
| ----------------------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| **SLO produit cible (p95)**   | **≈ 1 000 ms**                   | Objectif (≈ 0,93 s mesuré, doc 06 §19.7). Dépassement → ⚠️ non bloquant           |
| **Plafond CI bloquant (p95)** | **3 000 ms** (`PERF_SLO_P95_MS`) | Garde-fou anti-régression, **bloquant** ; tolère la variance des runners partagés |

> **Deux seuils volontairement distincts.** Le SLO produit (~1 s) est l'**objectif** ; le plafond CI
> (3 s) est un **garde-fou** calibré pour échouer sur la **classe de régression multi-secondes** (le
> bug d'origine ~7 s) **sans** rougir `main` sur du bruit de ±200 ms propre aux runners GitHub
> partagés (plus lents que le poste local). Tout dépassement du SLO cible mais sous le plafond est
> **journalisé** (⚠️) sans bloquer.

## 3. Méthode

- Script : [`scripts/perf-smoke.mjs`](../scripts/perf-smoke.mjs) — **zéro dépendance** (Node ESM pur,
  même esprit que `seed-demo.mjs` / `e2e-stack.mjs`).
- Charge : `PERF_REQUESTS` requêtes (défaut **30**) par vagues de `PERF_CONCURRENCY` simultanées
  (défaut **12** — reproduit le scénario réel des polls navigateur / E2E concurrents de la doc 06 §19.7).
- Eventual consistency NATS : attente active (200) avant mesure (jusqu'à 20 tentatives × 1 s).
- Mesure : p50 / **p95** / p99 / max ; **échec** si une requête n'est pas 200 ou si p95 > plafond CI.
- Sortie : résumé Markdown dans `GITHUB_STEP_SUMMARY`.

### Variables d'environnement

| Variable           | Défaut                  | Effet                          |
| ------------------ | ----------------------- | ------------------------------ |
| `GATEWAY_URL`      | `http://localhost:3000` | Base de la gateway             |
| `PERF_ANNEE`       | `2026`                  | Année interrogée               |
| `PERF_REQUESTS`    | `30`                    | Nombre total de requêtes       |
| `PERF_CONCURRENCY` | `12`                    | Requêtes simultanées par vague |
| `PERF_SLO_P95_MS`  | `3000`                  | Plafond CI bloquant (p95)      |

## 4. Intégration CI

Branché dans le job **`smoke-stack`** ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) :
la pile y est **déjà montée et amorcée** (seed), donc le smoke perf **réutilise** cet état (pas de
second démarrage de pile). Comme `smoke-stack` (P2-7), il ne s'exécute que si un projet **déployable**
est affecté.

## 5. Exécution locale

```bash
# Pile déjà montée + seedée (ex. via une partie de `pnpm e2e:stack` avec KEEP_STACK)
node scripts/perf-smoke.mjs
# Ajuster la charge / le plafond :
PERF_REQUESTS=60 PERF_CONCURRENCY=20 PERF_SLO_P95_MS=2000 node scripts/perf-smoke.mjs
```

## 6. Liens

- Latence d'origine & correctif : [doc 06](06-etat-davancement.md) §19.7
- Risque RT-05 : [registre de risque](19-registre-risque-produit.md) §2.2
- Niveau « Performance (smoke) » : [stratégie de test](21-politique-strategie-test.md) §2
