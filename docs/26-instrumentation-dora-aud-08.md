# Instrumentation des métriques DORA (AUD-08) — design

> **Origine** : clôture de la dernière action ouverte du [plan d'audit CI/CD
> (doc 25)](25-audit-cicd-remediation.md), **AUD-08** — _métriques DORA non
> instrumentées_. Différée depuis la Session C faute de **mécanisme de déploiement
> traçable** : la prod ([doc 24](exploitation/24-plan-deploiement-serveur-ct-qdo.md))
> est déployée **à la main** (SSH `pull && up` sur le serveur de prod), sans qu'aucun
> événement ne soit émis vers GitHub.
>
> **But** : concevoir ce mécanisme traçable, puis en **dériver les 4 clés DORA**
> (deployment frequency, lead time for changes, change failure rate, MTTR), en
> tenant compte des **limites de plateforme** (dépôt privé / plan gratuit, GHAS
> indisponible) et de la **topologie réseau** réelle du serveur.
>
> Convention reprise des docs 24/25 : portes de qualité, IDs stables, critères de
> sortie vérifiables.

---

## 1. Contrainte structurante : la topologie interdit le « push SSH » naïf

L'énoncé d'AUD-08 esquissait deux pistes — _« workflow GitHub Actions de
déploiement vers `<serveur>` (via SSH/Deploy Key) »_ **ou** _« usage de GitHub
Deployments/Environments »_. La première, prise au pied de la lettre (un **runner
GitHub hébergé** qui `ssh`-erait vers le serveur), est **infaisable** ici :

| Obstacle                           | Détail                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Aucun port entrant**             | le serveur n'expose que Caddy au LAN ; l'accès public passe par **Cloudflare Tunnel**, qui est **sortant** (doc 24 §6/§11). Un runner hébergé sur Internet ne peut donc PAS joindre le serveur en SSH. |
| **La Deploy Key est git-only**     | La clé de déploiement (`~/.ssh/creche_deploy`, read-only) sert au `git clone` ; elle **ne donne aucun accès** à l'API REST (Deployments) ni à un shell serveur.                                        |
| **Parité d'artefact déjà acquise** | Depuis AUD-05, la prod **tire** les images GHCR (`docker compose pull`) ; le déploiement est **pull-based** par nature. Le forcer en push casserait ce modèle.                                         |

Conclusion : le déploiement **se produit réellement sur le serveur** (pull). La
source de vérité de l'événement « déploiement » doit donc **naître sur le serveur**,
pas sur un runner distant. Les deux pistes de l'énoncé convergent alors vers une
même réponse — **GitHub Deployments comme source DORA** — la seule question
résiduelle étant _qui_ exécute le déploiement.

---

## 2. Options évaluées

| Option                                 | Qui exécute le déploiement                            | Source DORA        | Coût / risque                                                                                  | Verdict             |
| -------------------------------------- | ----------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------- | ------------------- |
| **A. Wrapper côté serveur** _(retenu)_ | Script `scripts/deploy.mjs` lancé par l'opérateur     | API Deployments    | PAT `deployments:write` sur le serveur. Aucune infra à installer. Instrumente le geste actuel. | ✅ **Retenu**       |
| B. Runner self-hosted sur `<serveur>`  | Workflow `deploy.yml` (`environment:`) sur le serveur | Deployments natifs | Installe un runner Actions sur une machine **prod partagée** (Paperless) → surface d'attaque.  | ⏭️ Évolution future |
| C. Deployments API seule (rétro)       | Inchangé (manuel non instrumenté)                     | API Deployments    | Traçabilité partielle : le déploiement n'est pas une porte, l'enregistrement est hors-bande.   | ❌ Trop faible      |

**Choix : Option A.** Elle (1) respecte la topologie pull-based, (2) n'ajoute
**aucun** service exposé ni runner sur la machine prod, (3) transforme le
déploiement manuel existant en **porte traçable** sans le réécrire, et (4) reste
entièrement **revue-able en PR** (code + docs), sans provisionnement serveur que la
CI ne pourrait de toute façon pas valider.

> **Disponibilité plateforme.** Les **Environments** et l'**API REST Deployments**
> sont disponibles sur dépôt **privé gratuit** (contrairement à la _protection de
> branche_ et au _code scanning_ GHAS, cf. doc 25 §AUD-04/§1). Seules les
> **deployment protection rules** (reviewers requis, wait timer) restent réservées
> à Pro/Team sur dépôt privé → on ne s'en sert pas ; la porte de qualité est
> assurée par le **script** (portes doc 24), pas par une règle serveur.

---

## 3. Architecture retenue

```
                       (1) git push main
   dev ───────────────────────────────────────────────►  GitHub
                                                            │
                                                  CI (ci.yml) build+scan+sign
                                                            │ publie images GHCR :main/:<sha>
                                                            ▼
   opérateur  ──ssh──►  <serveur>                         GHCR
                          │  node scripts/deploy.mjs
                          │   (2) POST /deployments  ────────────────►  GitHub Deployment (env=production)
                          │   (3) compose pull  ◄───────────────────── GHCR
                          │   (4) up --wait + health + seed + perf  (portes doc 24)
                          │   (5) POST /deployments/{id}/statuses ───►  state=success | failure
                          ▼
                       prod en ligne

   (périodique / on-demand)
   GitHub Actions  ──►  dora.yml  ──►  dora-metrics.mjs  ──GET /deployments(+statuses,+commits)──►  GitHub
                                          │
                                          └──►  GITHUB_STEP_SUMMARY (tableau 4 clés)  [+ textfile Prometheus optionnel]
```

Deux artefacts, deux responsabilités :

1. **`scripts/deploy.mjs`** — _producteur d'événements_. Wrapper de déploiement
   côté serveur : enveloppe les **portes 1bis→3 de la doc 24** et **enregistre**
   chaque déploiement (création + statut `success`/`failure`) via l'API Deployments.
2. **`.github/workflows/scripts/dora-metrics.mjs`** + **`dora.yml`** —
   _consommateur / calcul_. Lit l'historique des Deployments et **dérive les 4
   clés**, publié dans le résumé de run (et, en option, exporté vers Prometheus
   pour un dashboard Grafana « DORA », le pipeline OTel→Prometheus étant déjà câblé,
   cf. doc 24 §10 / [observabilite.md](exploitation/observabilite.md)).

---

## 4. Mécanisme de déploiement traçable (`scripts/deploy.mjs`)

**Entrées** (variables d'environnement, lues depuis `.env.server` / l'invocation) :

| Variable                     | Rôle                                                                          | Défaut                                                              |
| ---------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GH_DEPLOYMENTS_TOKEN`       | PAT **fine-grained**, scope **Deployments: Read and write** sur le seul dépôt | _(requis ; sinon mode record-skip)_                                 |
| `GITHUB_REPOSITORY`          | `owner/repo` ciblé par l'API                                                  | `EdouardZemb/creche-planner`                                        |
| `DEPLOY_REF`                 | SHA (ou tag) **déployé** = `ref` du Deployment (clé du _lead time_)           | label `…image.revision` de l'image gateway tirée, sinon `IMAGE_TAG` |
| `IMAGE_TAG`                  | Tag d'image tiré (déjà utilisé par le compose, AUD-05)                        | `main`                                                              |
| `DEPLOY_ENVIRONMENT`         | Nom d'environnement GitHub                                                    | `production`                                                        |
| `DEPLOY_ENVIRONMENT_URL`     | URL publique consignée sur le statut                                          | `https://creche.testlens.dev`                                       |
| `DEPLOY_VERIFY_COSIGN`       | Vérifier la signature cosign (AUD-07) avant `up` (`1` pour activer)           | _off_                                                               |
| `DEPLOY_SKIP_SEED` / `_PERF` | Sauter le seed / le smoke perf (porte 3)                                      | _off_                                                               |
| `GATEWAY_URL`                | Où la porte 3 (santé/seed/perf) joint la gateway                              | `SERVER_ORIGIN`, sinon `http://localhost:3000`                      |
| `SEED_BASE_URL`              | Base API transmise au seed (porte 3)                                          | `${GATEWAY_URL}/api/v1`                                             |
| `DEPLOY_CA_CERT`             | CA à faire confiance pour le TLS « internal » de Caddy (HTTPS)                | `NODE_EXTRA_CA_CERTS`, sinon `./caddy-root.crt` s'il existe         |
| `DORA_DRY_RUN`               | N'appeler ni Docker ni l'API (validation locale du flux)                      | _off_                                                               |

> **Topologie « ports non publiés » (#31, doc 24 §6).** Depuis que la prod ne
> publie plus aucun port hôte d'`api-gateway`, la porte 3 ne peut plus viser
> `localhost:3000`. `deploy.mjs` **dérive** donc l'endpoint de `SERVER_ORIGIN`
> (origine LAN derrière Caddy, ex. `https://192.0.2.10:8443`), `SEED_BASE_URL`
> de `GATEWAY_URL`, et fait confiance au CA racine Caddy exporté en `./caddy-root.crt`
> (`curl --cacert` pour la santé, `NODE_EXTRA_CA_CERTS` pour seed/perf) — **jamais**
> `-k`. En dev (override = ports publiés, pas de `SERVER_ORIGIN` ni de `caddy-root.crt`),
> le comportement historique (`localhost:3000`, HTTP) est inchangé.

**Déroulé** (chaque porte est **bloquante** ; un échec poste `failure` puis sort ≠ 0) :

1. **Créer le Deployment** — `POST /repos/{o}/{r}/deployments` avec `ref` (SHA
   déployé), `environment=production`, `required_contexts:[]` (on déploie un SHA
   **déjà validé** par la CI → pas de re-vérification de statuts), `auto_merge:false`,
   `production_environment:true`. → mémorise `deployment.id`. Poste aussitôt
   `state=in_progress`.
2. **Porte 1bis** — `docker compose … pull` (+ `cosign verify` si `DEPLOY_VERIFY_COSIGN`).
3. **Résolution du SHA réel** — si `DEPLOY_REF` non fourni, lit
   `org.opencontainers.image.revision` sur l'image **gateway** tirée
   (`docker image inspect`) → `ref` exact même quand on déploie le rolling `:main`.
4. **Porte 2** — `docker compose … up -d --wait` (le healthcheck devient porte).
5. **Porte 3** — `curl --fail --retry … /api/health`, puis `seed-demo.mjs` et
   `perf-smoke.mjs` (sauf `DEPLOY_SKIP_*`).
6. **Statut final** — succès → `POST …/statuses {state:success, environment_url}` ;
   tout échec → `{state:failure}` puis `exit 1`.

**Principe de non-blocage télémétrie.** Les appels API sont **best-effort** : une
panne de l'API GitHub **n'avorte pas** un déploiement réel (on journalise un
avertissement). Inversement, l'échec d'une **porte** (pull/up/health) reste
**fatal** et se reflète en `failure`. La télémétrie ne doit jamais être un point de
défaillance de la prod.

> **Robustesse du statut terminal.** Un `up --wait` peut perturber brièvement la
> sortie réseau (Caddy/cloudflared redémarrent) → le POST du statut **terminal**
> pouvait se perdre (« fetch failed »), laissant le Deployment bloqué en
> `in_progress` et **invisible pour DORA**. Mitigations : `gh()` **réessaie** les
> erreurs transitoires (réseau / HTTP 5xx ; pas les 4xx permanents), et si le statut
> terminal échoue malgré tout, le script affiche la **commande de rattrapage manuel**
> (`gh api -X POST …/statuses -f state=success …`). Observé une fois au 1er
> déploiement réel (2026-06-11) → corrigé.

**Rollback (doc 24 §9).** Un rollback = un **nouveau** déploiement d'un SHA
antérieur (`IMAGE_TAG=<sha> DEPLOY_REF=<sha> node scripts/deploy.mjs`). Le
déploiement fautif garde son statut `failure` ; le rollback réussi pose un
`success` → c'est précisément ce que MTTR mesure (§5).

---

## 5. Dérivation des 4 clés DORA (`dora-metrics.mjs`)

Source unique : `GET /repos/{o}/{r}/deployments?environment=production` + leurs
`…/statuses` (+ `GET /commits/{sha}` pour l'horodatage de commit). Fenêtre glissante
`DORA_WINDOW_DAYS` (défaut 30). Aucune dépendance npm (Node pur, `fetch` natif).

| Clé DORA                      | Définition opérationnelle retenue                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Deployment frequency**      | Nombre de déploiements de statut **`success`** sur la fenêtre ÷ durée → par jour **et** par semaine.                            |
| **Lead time for changes**     | **Médiane** de `(horodatage du statut success) − (date de commit du `ref` déployé)`. Le commit est résolu via `/commits/{ref}`. |
| **Change failure rate (CFR)** | `#déploiements terminés en {failure, error}` ÷ `#déploiements terminés` sur la fenêtre.                                         |
| **MTTR (time to restore)**    | **Médiane**, pour chaque déploiement `failure`, de `(horodatage du prochain `success`) − (horodatage du `failure`)`.            |

**Classement** Elite / High / Medium / Low affiché par métrique (seuils DORA
standards) pour rendre la lecture actionnable.

**Limite assumée — faible volume.** Un mono-mainteneur déployant épisodiquement
produit des **échantillons fins** : ces métriques sont **indicatives de tendance**,
pas statistiquement robustes. Documenté ici et dans le résumé de run (pas de
sur-interprétation d'une fenêtre à 1-2 déploiements).

**Enrichissement optionnel (incidents).** CFR/MTTR « pures déploiement » ne
capturent pas un incident **post-déploiement** (un déploiement `success` qui dégrade
le service plus tard). Le script lit donc, **en best-effort** (`try/catch`, jamais
bloquant), les issues étiquetées **`incident`** : si présentes, il affiche un MTTR
« incident » (`closed − created`) en complément. Discipline requise : ouvrir une
issue `incident` lors d'une dégradation, la fermer à la restauration.

**Sortie.** Tableau Markdown dans `GITHUB_STEP_SUMMARY` + stdout. Si
`DORA_PROM_TEXTFILE` est défini, écrit aussi un fichier au format
_Prometheus textfile collector_ (`dora_*` gauges) → cible Grafana via le node-exporter
de la pile d'observabilité (évolution, non câblée par cette PR).

---

## 6. Workflow `dora.yml`

- **Déclencheurs** : `schedule` (hebdomadaire) + `workflow_dispatch` (input
  `window_days`). Pas de couplage au déploiement : le calcul lit l'historique, il
  n'a pas à courir à chaque `up`.
- **Permissions** : `deployments: read`, `contents: read`, `issues: read`
  (enrichissement). Le `GITHUB_TOKEN` par défaut suffit (lecture) — **aucun PAT**
  côté CI ; le PAT n'existe que **sur le serveur** pour l'écriture.
- Actions **épinglées par SHA** (AUD-02) ; `node-version-file: .nvmrc` (AUD-10) ;
  `timeout-minutes` (AUD-03) ; bloc `concurrency` (AUD-14). Pas de `pnpm install`
  (script sans dépendance).

---

## 7. Écart CT-QDO traité

La doc 24 §10 listait **« Métriques DORA ⟵ écart connu : Non instrumenté »**. Cette
PR le fait passer à **instrumenté** : la ligne renvoie désormais vers le présent
document et `dora-metrics.mjs`.

**Écart résiduel honnête** (consigné, non masqué) :

1. **Discipline opérateur** — le déploiement reste **manuel** ; les métriques ne
   valent que si l'opérateur passe par `deploy.mjs` (et non un `up` à la main hors
   wrapper). L'option B (runner self-hosted) supprimerait cette dépendance
   humaine — évolution documentée, non retenue pour la surface d'attaque.
2. **Volume faible** → métriques indicatives (§5).
3. **CFR/MTTR incidents** dépendent de la discipline d'étiquetage `incident` (§5).
4. **Pas de dashboard Grafana DORA** câblé dans cette PR (export Prometheus
   prévu mais optionnel) — la source de vérité reste l'API Deployments.

---

## 8. Critères de sortie (acceptation AUD-08)

- [ ] `scripts/deploy.mjs` : un déploiement réel crée un **GitHub Deployment**
      `production` + un **statut** `success`/`failure` (visible dans l'onglet
      _Environments_ / via `gh api .../deployments`).
- [ ] `dora-metrics.mjs` calcule les **4 clés** depuis l'API et les publie dans
      `GITHUB_STEP_SUMMARY` (workflow `dora.yml` vert sur `workflow_dispatch`).
- [ ] Doc 24 §10 : ligne DORA passée de **« non instrumenté »** à
      **« instrumenté »** (renvoi vers ce doc).
- [ ] Doc 25 §1/§3/§5 : **AUD-08** coché ✅ + journal.
- [ ] `.env.server.example` documente `GH_DEPLOYMENTS_TOKEN` (+ comment créer le PAT
      fine-grained `Deployments: write`).

> **Validation réelle** : comme pour AUD-05/06/07, le chemin n'est pleinement
> exercé qu'au **prochain déploiement serveur** via le wrapper (création effective
> du premier Deployment). La logique de `dora-metrics.mjs` est, elle, vérifiable
> hors-ligne (`node --check`, jeu de données simulé) et par un `workflow_dispatch`.

---

_Créé le 2026-06-11 pour clore AUD-08 (dernière action du plan doc 25)._
