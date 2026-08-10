# 36 — Veille sur les standards applicables au produit

> Statut : **Établi** · Version 1.0 · 2026-08-10
> Veille **informative et cadencée** sur l'évolution des standards industriels et
> réglementaires applicables à l'application. Complète la veille technique existante
> (CVE quotidiennes via `image-scan.yml`, alertes de code via `veille-alertes.yml`),
> qui ne surveille que des vulnérabilités — jamais des référentiels.

## 1. Pourquoi cette veille existe

Constat de la revue d'août 2026 (`LE-29`, [doc 34](34-registre-ameliorations.md)) :
huit revues et audits successifs ont confronté le **processus** du dépôt à l'état de
l'art (ISTQB, TMMi, DORA, SRE), jamais le **produit** aux standards externes. Résultat :
la famille RGPD entière — registre des traitements, effacement, mentions d'information —
est restée invisible alors que l'application stocke des enfants mineurs et des revenus
de foyers. Le périmètre des revues excluait le réglementaire sans que personne ne l'ait
décidé.

## 2. Ce que la veille couvre — et ne couvre pas

**Couvre** : l'écart entre l'application (code, données, exploitation) et les
référentiels du §3 — apparition d'une nouvelle version d'un standard, nouveau
référentiel applicable, écart connu dont le contexte a changé.

**Ne couvre pas** : les vulnérabilités (CVE, alertes de code — outillage dédié
existant) ; le processus de développement, revu par `/revue-processus` ; le conseil
juridique — la veille signale qu'un texte s'applique, elle ne vaut pas avis d'expert.

## 3. Référentiels suivis

| Domaine                    | Référentiels                                              | Ce qu'on surveille                                              |
| -------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| Données personnelles       | RGPD, référentiels et recommandations CNIL                | Nouvelles recommandations (mineurs, rétention), sanctions types |
| API HTTP                   | RFC 9110/9457/6585, drafts IETF (`Idempotency-Key`)       | Adoption des drafts, nouveaux codes/en-têtes                    |
| Sécurité applicative       | OWASP ASVS, Top 10, API Security Top 10, Secure Headers   | Nouvelles versions (ASVS 5.0…), nouveaux contrôles              |
| Accessibilité              | WCAG (2.2 →3.0), RGAA                                     | Passage de niveau, nouveaux critères, obligations françaises    |
| Chaîne d'approvisionnement | OpenSSF (Scorecard, SLSA), pratiques pnpm/npm             | Nouveaux niveaux SLSA, gardes gestionnaire de paquets           |
| Événements & contrats      | AsyncAPI, CloudEvents, OpenAPI                            | Versions majeures, outillage de génération/vérification         |
| Résilience & exploitation  | patterns SRE/AWS (backoff, jitter), CIS Docker, 12-factor | Évolutions de consensus, nouveaux benchmarks                    |
| Plateforme                 | Node.js LTS, NestJS, PostgreSQL (cycles de support)       | Fins de support, dépréciations annoncées                        |

## 4. Rituel

- **Cadence** : trimestrielle, inscrite au rituel du registre
  ([doc 34 §6](34-registre-ameliorations.md#6-rituel)). Un cycle = une session qui
  reparcourt le §3, vérifie ce qui a bougé, et confronte les nouveautés au code réel
  (constat négatif d'abord : lire la **sortie** des outils, pas leur intention).
- **Sortie** : des **lignes du registre** (doc 34, `/consigner`) — jamais un document
  d'audit de plus. Une piste par écart retenu, avec critère de sortie ; un écart
  volontaire se consigne aussi (`⛔` avec sa raison).
- **Entrée** : le tableau du §3 est la liste de départ, pas une limite. Un cycle qui
  découvre un référentiel manquant l'ajoute au tableau.

## 5. Journal des cycles

| Cycle | Date       | Sortie                                                                                                                                           |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | 2026-08-10 | Revue initiale (sécurité, API/observabilité, données/RGPD/frontend) : `AM-33` → `AM-51`, `LE-29` ; quick wins livrés (`AM-38`, `AM-42`, `AM-43`) |
