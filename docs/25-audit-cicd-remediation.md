# Audit CI/CD & plan de remédiation

> **Origine** : audit de la pipeline CI/CD et de sa documentation (session du 2026-06-09),
> mené selon OWASP CI/CD Security Top 10, OpenSSF Scorecard / SLSA, NIST SSDF,
> DORA Four Keys et le syllabus ISTQB **CT-QDO** déjà revendiqué par le projet
> ([doc 24](exploitation/24-plan-deploiement-serveur-ct-qdo.md)).
>
> **But de ce document** : transformer les constats en **actions traçables et
> exécutables dans de futures sessions**, sans avoir à re-dériver le diagnostic.
> Chaque action porte un **ID stable**, une **priorité**, les **fichiers concernés**,
> un **critère de sortie** vérifiable et une esquisse d'implémentation.
>
> Convention reprise de la [doc 18](18-audit-gestion-tests-ctal-tm-tmmi.md) (actions P1/P2)
> et de la [doc 22](22-registre-anomalies.md) (registre).

---

## 0. État de la pipeline au moment de l'audit

**Note globale : B+ (solide).** Forces : `nx affected` partout, portes qualité
bloquantes étagées (format → lint/typecheck/test/build → `pact-can-i-deploy` →
smoke pile réelle → smoke perf → E2E stack), gate de couverture **100 %** sur les
libs domaine, sécurité multi-couche (SCA `pnpm audit --prod` bloquant, SAST CodeQL,
Dependabot deps+actions), métriques de test publiées, documentation interne
exemplaire.

**Faiblesses structurantes** : il n'existe **pas de CD réel** (images construites
puis jetées, prod reconstruite sur le serveur → rupture de parité d'artefact) et la
**chaîne d'approvisionnement des images** n'est ni scannée, ni attestée, ni signée.

---

## 1. Registre d'actions (synthèse)

| ID            | Priorité | Constat                                                                         | Critère de sortie                                                 | Fichiers                                        |
| ------------- | -------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| ✅ **AUD-01** | P1       | Smoke « Santé gateway » teste `/health` (404) au lieu de `/api/health`          | `smoke-stack` exécuté, step santé vert sur la vraie route         | `.github/workflows/ci.yml:229`                  |
| ✅ **AUD-02** | P1       | Actions GitHub épinglées par tag mutable (`@v4`)                                | Toutes les `uses:` épinglées par **SHA** + commentaire de version | `.github/workflows/*.yml`                       |
| ✅ **AUD-03** | P1       | Pas de `timeout-minutes` sur `ci`, `security`, `e2e-web`, `build-images`        | Chaque job a un timeout borné                                     | `.github/workflows/ci.yml`                      |
| ✅ **AUD-04** | P1       | Pas de `CODEOWNERS`, pas de `SECURITY.md`, protection de branche non documentée | Fichiers présents + protection `main` documentée/vérifiée         | `.github/`, racine                              |
| ✅ **AUD-05** | P2       | **Pas de CD** : `build-images` en `push:false`, prod reconstruit ses images     | Images publiées sur GHCR taggées par SHA, **consommées** par prod | `ci.yml`, `docker-compose.server.yml`           |
| ✅ **AUD-06** | P2       | Aucun scan CVE des images construites                                           | Scan Trivy/Grype bloquant HIGH/CRITICAL sur les images publiées   | `ci.yml`                                        |
| ✅ **AUD-07** | P2       | Pas de SBOM, ni provenance, ni signature d'image                                | `provenance:true` + `sbom:true` + signature cosign keyless        | `ci.yml`                                        |
| ✅ **AUD-08** | P2       | Métriques **DORA** non instrumentées (écart auto-déclaré)                       | Deployments GitHub tracés → 4 métriques calculables               | `scripts/deploy.mjs`, `dora.yml`, doc 26        |
| ✅ **AUD-09** | P2       | Pas de secret scanning dans la pipeline                                         | Job gitleaks/trufflehog + Push Protection activée                 | `.github/workflows/`, réglages repo             |
| ✅ **AUD-10** | P3       | Incohérence Node : CI `24`, `engines >=22`, `@types/node 20.x`                  | Une seule version LTS figée (`.nvmrc`) + types accordés           | `package.json`, `.github/workflows/*`, `.nvmrc` |
| ✅ **AUD-11** | P3       | pnpm 8.15.1 (ancien) avec Node 24                                               | Montée pnpm 9/10, lockfile régénéré, CI verte                     | `package.json`                                  |
| ✅ **AUD-12** | P3       | `build-images` redondant tant qu'AUD-05 non fait (images jetées)                | Fusionné dans le job de publication GHCR **ou** supprimé          | `ci.yml`                                        |
| ✅ **AUD-13** | P3       | Pas de cache Nx distant (`affected` recalcule à froid)                          | `.nx/cache` mis en cache (actions/cache) ou Nx Cloud              | `.github/workflows/ci.yml`                      |
| ✅ **AUD-14** | P3       | `codeql.yml` sans `concurrency`                                                 | Groupe de concurrence ajouté                                      | `.github/workflows/codeql.yml`                  |
| ✅ **AUD-15** | P3       | Pas de workflow de release (`nx release` 100 % manuel)                          | Tag → workflow publie changelog + images versionnées              | `.github/workflows/`, `nx.json`                 |
| ✅ **AUD-16** | P3       | Runbook daté « Phase 9 », centré local alors que la prod est en ligne           | Renvoi vers doc 24 en tête + date à jour                          | `docs/exploitation/runbook-deploiement.md`      |

Priorités : **P1** = quick win sécurité/correctness (< 1 j cumulé) ; **P2** = chantier
structurant (CD + chaîne d'appro + DORA) ; **P3** = toolchain & polissage.

---

## 2. Roadmap d'exécution (par session)

Découpage pensé pour des sessions indépendantes, dépendances explicites. Chaque lot
= **une branche dédiée + une PR** (convention du dépôt).

### Session A — Quick wins P1 (`fix/cicd-quickwins`)

AUD-01, AUD-02, AUD-03, AUD-14. Sans dépendance. Faible risque, fort ratio.
→ Plus AUD-16 (doc) qui peut voyager dans la même PR.

### Session B — Gouvernance P1 (`chore/cicd-governance`)

AUD-04 + AUD-09 (secret scanning). Fichiers `.github/` + réglages repo (`gh api`).

### Session C — CD & chaîne d'appro P2 (`feat/cicd-cd-ghcr`) — **chantier central**

AUD-05 d'abord (publication GHCR), puis **dans la foulée** AUD-12 (fusion/suppression
`build-images`), AUD-06 (scan), AUD-07 (SBOM/provenance/cosign). AUD-08 (DORA) se
greffe une fois la publication + un mécanisme de déploiement en place.

> Dépend de Session B pour `packages: write` / OIDC propres.

### Session D — Toolchain P3 (`chore/toolchain-align`)

AUD-10 puis AUD-11 (ordonnés : figer Node avant de bouger pnpm). AUD-13 (cache Nx).
AUD-15 (release) en clôture.

> **Ordre recommandé global** : A → B → C → D. A et B sont parallélisables.

---

## 3. Détail des actions

### AUD-01 — Corriger la route de santé du smoke gateway · P1

**Constat.** `smoke-stack` fait `curl --fail http://localhost:3000/health`
([ci.yml:229](../.github/workflows/ci.yml)), mais la gateway a un préfixe global
`api` ([app.config.ts:19](../apps/api-gateway/src/app.config.ts)) et expose la santé
en **`/api/health`** (cf. `HealthController('health')` + préfixe, et la cohérence
runbook/doc 24). `/health` renvoie 404 ; `curl --fail` échoue (et `--retry` ne
réessaie pas un 404). Le constat est masqué par le gating `has_projects` qui saute le
job sur tout diff docs/libs → **gate dormant**.

**Action.** Remplacer `http://localhost:3000/health` → `http://localhost:3000/api/health`.
Optionnel mais recommandé : ajouter un `healthcheck` à `api-gateway` dans
`docker-compose.yml` (interroge `/api/health`) et passer le `depends_on` de `web` en
`condition: service_healthy`, pour que `--wait` couvre réellement la gateway.

**Critère de sortie.** Job `smoke-stack` déclenché (toucher un service déployable dans
la PR) et **step « Santé gateway » vert** sur `/api/health`.

---

### AUD-02 — Épingler les actions par SHA · P1

**Constat.** `uses: actions/checkout@v4`, `@v3`, `pnpm/action-setup@v4`, etc. — tags
**mutables**. OpenSSF Scorecard (`Pinned-Dependencies`) et SLSA recommandent
l'épinglage par **SHA de commit complet** : un tag peut être déplacé vers du code
malveillant entre deux passages Dependabot.

**Action.** Remplacer chaque `@vN` par `@<sha40>  # vN.M.P` dans `ci.yml` et
`codeql.yml`. Dependabot (déjà configuré pour `github-actions`) sait mettre à jour les
SHA et le commentaire. Cibles : `actions/checkout`, `actions/setup-node`,
`actions/upload-artifact`, `pnpm/action-setup`, `nrwl/nx-set-shas`,
`docker/setup-buildx-action`, `docker/build-push-action`, `github/codeql-action/*`.

**Critère de sortie.** `grep -rE 'uses:.*@v[0-9]'` ne retourne plus rien dans
`.github/workflows/` ; CI verte.

---

### AUD-03 — Timeouts sur tous les jobs · P1

**Constat.** Seuls `smoke-stack` et `e2e-stack` ont `timeout-minutes: 25`. `ci`,
`security`, `e2e-web`, `build-images`, `pact-can-i-deploy`, `affected-images` n'en ont
pas → un runner bloqué consomme jusqu'à 6 h (défaut GitHub).

**Action.** Ajouter `timeout-minutes` par job (suggestion : `ci` 20, `security` 10,
`e2e-web` 20, `build-images` 20, jobs légers 10).

**Critère de sortie.** Chaque `jobs.<x>` porte un `timeout-minutes`.

---

### AUD-04 — CODEOWNERS, SECURITY.md, protection de branche · P1

**Constat.** _Bus factor = 1_ reconnu (doc 18 axe F.4) mais aucun `CODEOWNERS` ne
route la revue ; pas de `SECURITY.md` (politique de divulgation) ; protection de `main`
non tracée dans le dépôt.

**Action.**

1. `.github/CODEOWNERS` : `* @EdouardZemb` (a minima ; affiner par dossier ensuite).
2. `SECURITY.md` (racine ou `.github/`) : périmètre, canal de signalement
   (e-mail privé), délai de réponse, versions supportées.
3. Documenter/vérifier la **protection de branche** `main` via `gh api` :
   `required_pull_request_reviews`, `required_status_checks` = jobs bloquants
   (`ci`, `security`, `pact-can-i-deploy`, et `smoke-stack`/`e2e-stack` quand
   applicables), `strict: true`, `enforce_admins`. Consigner le réglage retenu ici.

**Critère de sortie.** Les 2 fichiers existent ; le réglage de protection est tracé
(capture `gh api repos/EdouardZemb/creche-planner/branches/main/protection`).

> NB : la protection de branche n'est pas inspectable depuis le code seul — à vérifier
> en session via `gh api` (gh était indisponible au moment de l'audit).

---

### AUD-05 — CD réel : publier les images sur GHCR et les consommer · P2 — **central**

**Constat.** `build-images` construit en **`push:false`/`load:true`**
([ci.yml:399](../.github/workflows/ci.yml)) : images **jetées**, jamais publiées. La
prod fait `docker compose up --build` ([doc 24 §5](exploitation/24-plan-deploiement-serveur-ct-qdo.md))
→ **reconstruit ses propres images** : _ce qui est testé en CI n'est jamais ce qui
tourne en prod_ (rupture de parité d'artefact, anti-pattern SLSA). DORA reste aveugle
faute d'artefact/événement de déploiement.

**Action (design cible).**

1. **Publier** sur `ghcr.io/edouardzemb/creche-planner/<projet>` depuis la CI, **sur
   `push: main` uniquement** (les PR de forks ne doivent pas pousser) :
   - permission job `packages: write` (en plus de `contents: read`) ;
   - `docker/login-action` avec `GITHUB_TOKEN` ;
   - tags : `:<sha>` **et** `:main` (et `:<version>` sur tag `nx release`, cf. AUD-15) ;
   - `push: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}`.
2. **Consommer** côté prod : dans `docker-compose.server.yml`, remplacer les `build:`
   par `image: ghcr.io/edouardzemb/creche-planner/<svc>:${IMAGE_TAG}` (variable lue
   depuis `.env.server`). Le déploiement devient `docker compose pull && up -d --wait`
   au lieu de `--build`. Mettre à jour [doc 24 §5/§9](exploitation/24-plan-deploiement-serveur-ct-qdo.md)
   et le [runbook §8.3](exploitation/runbook-deploiement.md).
3. **Nuance PR vs main** : sur PR, on **ne pousse pas** → `smoke-stack`/`e2e-stack`
   gardent `--build` (preuve de constructibilité locale). Seul `main` publie. Documenter
   ce choix dans le commentaire de job.
4. Authentifier le serveur au GHCR (PAT read:packages ou token de déploiement),
   tracé dans `.env.server.example`.

**Critère de sortie.** Un push sur `main` publie une image par service affecté sur
GHCR (visible dans l'onglet Packages) ; un déploiement serveur via `pull` (sans
`--build`) démarre la pile et passe les portes 2-4 de la doc 24.

**Dépendances/risques.** Visibilité du package (privé → auth serveur obligatoire).
Coordonner avec AUD-12 (build-images devient le job de publication).

---

### AUD-06 — Scan CVE des images · P2

**Constat.** CodeQL couvre le **code source**, pas les **couches OS** des images.

**Action.** Après le build (idéalement sur l'image publiée), exécuter **Trivy**
(`aquasecurity/trivy-action`) ou Grype, `severity: HIGH,CRITICAL`, `exit-code: 1`
(bloquant). Publier le SARIF dans l'onglet Security (`upload-sarif`). Prévoir une
allowlist `.trivyignore` documentée pour les faux positifs assumés.

**Critère de sortie.** Job de scan présent et bloquant ; résultats visibles dans
Security ; build cassé si une CVE HIGH/CRITICAL non ignorée apparaît.

> **Implémenté (Session C, durci en clôture).** Trivy bloquant `HIGH,CRITICAL`,
> `ignore-unfixed: true`, `exit-code: 1` ; **pas d'upload SARIF** (GHAS indispo sur dépôt
> privé gratuit → garde-fou = exit-code). `.trivyignore` (vide) à la racine pour les faux
> positifs futurs. **Pour rester sous le seuil, les images appliquent les correctifs OS au
> build** (`apt-get upgrade -y` en runtime services ; `apk upgrade --no-cache` pour le web) —
> sans quoi des CVE corrigibles du base image (ex. `libgnutls30`) cassent le build. Validé en
> réel sur l'image publiée (cf. journal §5, 2026-06-10/11).

---

### AUD-07 — SBOM, provenance, signature d'image · P2

**Constat.** Aucune attestation de provenance, pas de SBOM, images non signées →
SLSA niveau 0.

**Action.** Sur le job de publication (AUD-05) :

- `docker/build-push-action` avec `provenance: true` et `sbom: true` ;
- **signer** avec **cosign keyless** (OIDC, `id-token: write`) : `cosign sign` sur le
  digest poussé ; optionnellement attester le SBOM (`cosign attest`).
- Documenter la **vérification** côté serveur (`cosign verify`) dans la doc 24.

**Critère de sortie.** Image publiée avec attestation de provenance + SBOM joints ;
`cosign verify` réussit sur le digest. Vise SLSA niveau 2-3.

---

### AUD-08 — Instrumenter les métriques DORA · P2

**Constat.** Écart auto-déclaré ([doc 24 §10](exploitation/24-plan-deploiement-serveur-ct-qdo.md)) :
_deployment frequency_, _lead time for changes_, _MTTR_, _change failure rate_ non
mesurés. Bloqué tant qu'AUD-05 n'existe pas (pas d'événement de déploiement).

**Action.** Une fois le CD en place :

- créer un **GitHub Deployment** (API `deployments`) à chaque déploiement réussi →
  _deployment frequency_ + _lead time_ (commit → deployment) calculables ;
- _change failure rate_ : taguer les déploiements suivis d'un rollback/incident
  (label `incident` sur issues, ou `deployment_status: failure`) ;
- _MTTR_ : durée entre `failure` et `success` suivant.
  Optionnel : exporter ces compteurs vers Prometheus (le pipeline OTel→Prometheus est
  déjà câblé) pour un dashboard Grafana « DORA ».

**Critère de sortie.** Les 4 métriques sont dérivables d'une source tracée (API
Deployments et/ou Prometheus) ; tableau de la doc 24 §10 passé de « non instrumenté »
à « instrumenté ».

> **Implémenté (2026-06-11, doc 26).** La topologie (aucun port entrant ; Cloudflare
> Tunnel sortant ; Deploy Key git-only) **interdit** le push SSH d'un runner hébergé →
> mécanisme retenu = **wrapper côté serveur** `scripts/deploy.mjs` (pull-based) qui
> crée un **GitHub Deployment** + statut `success`/`failure` autour des portes doc 24.
> `dora-metrics.mjs` + `dora.yml` (hebdo + dispatch) dérivent les **4 clés** depuis
> l'API Deployments (le `GITHUB_TOKEN` en lecture suffit ; le PAT `deployments:write`
> ne vit que sur le serveur). **Environments + API Deployments dispo sur privé gratuit**
> (≠ protection de branche/GHAS) ; seules les _protection rules_ d'environnement sont
> gated → non utilisées (la porte = le script). Écart résiduel acté : déploiement
> manuel (discipline) + volume faible. Conception complète : doc 26.

---

### AUD-09 — Secret scanning dans la pipeline · P2

**Constat.** Le flux manipule `.env.server` (secrets réels) ; aucun garde-fou
empêchant une fuite de secret committé.

**Action.**

- Job **gitleaks** (ou trufflehog) sur PR + push, bloquant ;
- activer **Secret Scanning + Push Protection** GitHub (`gh api` /réglages) ;
- vérifier que `.env.server` reste bien gitignored (déjà le cas, doc 24 §1).

**Critère de sortie.** Job de secret scan vert sur l'historique courant ; Push
Protection activée (tracé).

---

### AUD-10 — Aligner et figer la version Node · P3

**Constat.** CI sur `node-version: 24` ([ci.yml:93](../.github/workflows/ci.yml)),
`engines.node: ">=22"`, `@types/node: 20.19.9` → type-check contre les types Node 20
en exécutant Node 24 ; `24` non figé en patch (non reproductible).

**Action.** Choisir **une** LTS (recommandé : Node 22 LTS, cohérent avec `engines`),
la figer dans `.nvmrc` + `setup-node` (`node-version-file: .nvmrc`), accorder
`@types/node` à la même majeure, resserrer `engines`.

**Critère de sortie.** `.nvmrc` présent ; CI lit `.nvmrc` ; `@types/node` aligné ;
CI verte.

---

### AUD-11 — Monter pnpm 9/10 · P3

**Constat.** `packageManager: pnpm@8.15.1` (ancien) avec Node 24 ; couverture
d'advisories `pnpm audit` plus faible que 9/10.

**Action.** Passer `packageManager` à pnpm 9 ou 10, régénérer `pnpm-lock.yaml`,
vérifier `pnpm/action-setup` (lit `packageManager`). **Après AUD-10** (figer Node
d'abord pour isoler la cause d'un éventuel échec).

**Critère de sortie.** Lockfile régénéré sans conflit ; `pnpm install --frozen-lockfile`
et toute la CI vertes.

---

### AUD-12 — Rationaliser `build-images` · P3

**Constat.** Tant qu'AUD-05 n'est pas fait, `build-images` construit des images
**jetées** (`push:false`) que le smoke reconstruit de toute façon → minutes CI gâchées.

**Action.** **Fusionner** dans le job de publication GHCR d'AUD-05 (build **et** push
en un step, sur `main`) ; sur PR, conserver le build sans push comme preuve de
constructibilité, ou s'appuyer sur le `--build` du smoke. Supprimer la duplication.

**Critère de sortie.** Plus de job qui construit une image jamais utilisée ;
`build-images` est soit le publisher, soit supprimé.

---

### AUD-13 — Cache Nx distant · P3

**Constat.** `nx affected` recalcule à froid à chaque run (pas de cache partagé).

**Action.** Mettre en cache `.nx/cache` via `actions/cache` (clé = hash lockfile +
`nx.json`), **ou** activer Nx Cloud (token en secret). Mesurer le gain avant/après.

**Critère de sortie.** Hits de cache observés entre runs ; durée du job `ci` réduite.

---

### AUD-14 — Concurrence sur CodeQL · P3

**Constat.** `codeql.yml` n'a pas de `concurrency` → runs qui se chevauchent sur
pushes rapprochés.

**Action.** Ajouter le même bloc que `ci.yml` :
`concurrency: { group: codeql-${{ github.ref }}, cancel-in-progress: true }`.

> Ne pas annuler le run programmé hebdomadaire par mégarde : garder `cancel-in-progress`
> sur les seuls événements PR/push si besoin (condition sur `github.event_name`).

**Critère de sortie.** Bloc `concurrency` présent ; pas de double run sur push rapide.

---

### AUD-15 — Workflow de release · P3

**Constat.** `nx release` (version + changelog + tag par projet) est **100 % manuel**
([runbook §8.2](exploitation/runbook-deploiement.md)) ; aucun tag ne déclenche de
publication.

**Action.** Workflow déclenché sur tag `*@*` (ou `workflow_dispatch`) qui :
joue `nx release` (ou consomme le tag), publie les images versionnées sur GHCR
(réutilise AUD-05 avec le tag sémantique), génère/publie le changelog. Permissions
`contents: write` pour les notes de release.

**Critère de sortie.** Un tag de release produit images versionnées + notes de
release automatiquement.

---

### AUD-16 — Cohérence doc d'exploitation · P3

**Constat.** [runbook-deploiement.md](exploitation/runbook-deploiement.md) est daté
« Phase 9 — juin 2026 » et centré **local**, alors que la prod est en ligne ; le
renvoi vers la doc 24 n'existe que dans le sens doc 24 → runbook.

**Action.** Ajouter en tête du runbook un encart « Pour la **production**, voir
[doc 24](exploitation/24-plan-deploiement-serveur-ct-qdo.md) » ; actualiser la date ;
vérifier que la table des endpoints santé est cohérente (`/api/health`, cf. AUD-01).

**Critère de sortie.** Renvoi croisé présent ; date à jour ; endpoints cohérents avec
le code.

---

## 4. Traçabilité

| Référentiel                                                    | Actions couvrantes             |
| -------------------------------------------------------------- | ------------------------------ |
| OWASP CI/CD Top 10 (CICD-SEC-2/3/4/6)                          | AUD-02, AUD-04, AUD-09         |
| OpenSSF Scorecard / SLSA                                       | AUD-02, AUD-05, AUD-06, AUD-07 |
| NIST SSDF (PS, PW, RV)                                         | AUD-06, AUD-07, AUD-09         |
| DORA Four Keys                                                 | AUD-05, AUD-08                 |
| ISTQB CT-QDO (build/deploy pipeline, DevSecOps, observabilité) | AUD-05→AUD-09, doc 24 §10      |
| Reproductibilité / parité                                      | AUD-05, AUD-10, AUD-11         |

---

_Créé le 2026-06-09 à partir de l'audit CI/CD. Met à jour son statut au fil des sessions
(cocher/annoter le registre §1)._

## 5. Journal d'exécution

- **2026-06-09 — Session A (`fix/cicd-quickwins`)** : AUD-01 (route santé smoke →
  `/api/health`, vérifiée contre `app.config.ts` + `HealthController`), AUD-02 (8 actions
  épinglées par SHA + commentaire de version dans `ci.yml`/`codeql.yml` ; plus aucun `@vN`),
  AUD-03 (`timeout-minutes` sur tous les jobs `ci.yml` + le job CodeQL), AUD-14 (bloc
  `concurrency` CodeQL, `group` incluant `event_name` pour ne pas annuler le run `schedule`
  hebdomadaire), AUD-16 (renvoi prod doc 24 + date à jour dans le runbook). YAML validés.

- **2026-06-10 — Correctifs « CI verte » (même PR `fix/cicd-quickwins`)**. L'exécution de la
  Session A a révélé que `main` était **rouge en permanence** depuis ≥ PR #16 (deux échecs
  pré-existants, **pas** des régressions — vérifié : échec identique sur le merge doc-25) :
  1. **`e2e-web` + `e2e-stack`** échouaient au step _Install Playwright_ avec
     `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "playwright" not found`. Cause :
     `@playwright/test` n'est déclaré que dans `apps/web/package.json` (convention deps par
     projet) et, avec le linker pnpm **isolé**, son binaire vit dans `apps/web/node_modules/.bin`,
     pas à la racine ; le step lançait `pnpm exec playwright …` **depuis la racine**. Fix :
     `pnpm --filter @creche-planner/web exec playwright install …` (vérifié localement :
     racine → _not found_ ; filtré → `Version 1.60.0`).
  2. **CodeQL** échouait à l'**upload** (« Code scanning is not enabled for this repository ») :
     GitHub Advanced Security indisponible sur dépôt **privé / plan gratuit**. Décision
     (utilisateur) : **mettre le workflow CodeQL en pause** — déclencheurs auto retirés, ne
     reste que `workflow_dispatch` ; ré-activation documentée en tête de `codeql.yml` quand le
     dépôt deviendra public ou GHAS acquis. (Même famille de limitation que la protection de
     branche AUD-04.)
  3. **Specs `e2e-web` mockées obsolètes** (révélées une fois le step Playwright réparé :
     6 passaient, 2 échouaient). `parcours.e2e.spec.ts` et `a11y.e2e.spec.ts` mockaient le BFF
     mais **pas** `GET /api/v1/contrats?foyer=` (la liste), route introduite par le refactor
     **contrats API-backed (2026-06-06)** ; `a11y` amorçait même les contrats via `sessionStorage`,
     que `useContrats` ne lit plus. Sans contrat rendu, l'onglet/texte « Cantine » est absent.
     Fix : ajouter le handler `GET …/contrats` (liste) aux deux mocks + actualiser le commentaire
     d'en-tête a11y. **Vérifié localement : 8/8 verts** (suite mockée complète = parcours 1 + a11y 7).
  4. **`smoke-stack` — course de readiness gateway** (révélée quand, `web` étant affecté par les
     specs e2e, le job lourd s'est enfin déclenché — c'est aussi la **1re exécution réelle** de la
     santé gateway AUD-01). `curl … /api/health` renvoyait `(52) Empty reply` et **n'était pas
     réessayé** (`--retry` ne couvre pas l'exit 52) : la gateway acceptait le TCP sans encore
     servir, car aucun service applicatif n'avait de `healthcheck` → `up --wait` ne garantissait
     que `service_started`. Fix (le « optionnel recommandé » d'AUD-01) : **healthcheck liveness**
     sur `api-gateway` (`node -e fetch('/api/health/live')`, image node:24-slim sans curl/wget) +
     `web` qui attend `service_healthy` + `--retry-all-errors` sur le curl du smoke. Validé :
     `docker compose config` OK, commande healthcheck testée (exit 1 propre sur refus).

  **Reste : Sessions B (gouvernance + secret scanning), C (CD/GHCR central), D (toolchain).**

- **2026-06-10 — Session B (`chore/cicd-governance`)** : gouvernance P1 + secret scanning.
  - **AUD-04** — ajout de [`.github/CODEOWNERS`](../.github/CODEOWNERS) (`* @EdouardZemb`,
    bus factor = 1 explicite, demande de revue auto) et de [`SECURITY.md`](../SECURITY.md)
    racine (politique de divulgation : canal privé GitHub PVR puis e-mail, délais best
    effort, périmètre, garde-fous, limitation protection de branche). **Protection de
    branche RE-VÉRIFIÉE** en session via `gh api repos/EdouardZemb/creche-planner/branches/main/protection`
    → toujours **HTTP 403 « Upgrade to GitHub Pro or make this repository public »**
    (dépôt privé/plan gratuit). Pas d'enforcement serveur possible ; limitation tracée
    dans `SECURITY.md` et ici (§AUD-04 / §1 intro). Décision en suspens (Pro/Team, public,
    ou acter) inchangée.
    - **MÀJ 2026-06-18 (PUB-D, dépôt rendu public)** : limitation **levée**. Protection de
      `main` désormais **appliquée côté serveur** via `gh api .../branches/main/protection` :
      PR obligatoire, check **`ci`** requis (`strict: true`), force-push/suppression
      interdits, `enforce_admins: false`, **0 revue** (mono-mainteneur). Le check `security`
      n'est **pas** requis (vuln Multer pré-existante hors périmètre → sinon plus aucune PR
      ne pourrait merger). `SECURITY.md` §« Protection de branche » actualisé en conséquence.
  - **AUD-09** — job **`secret-scan`** ajouté à [`ci.yml`](../.github/workflows/ci.yml)
    (gitleaks-action `v3.0.0`, épinglée par SHA `e0c47f4…` résolu via `gh api`, cohérent
    avec AUD-02 + Dependabot `github-actions`). `fetch-depth: 0` → scan de **tout
    l'historique** sur push ET PR ; **bloquant par exit code**. `GITLEAKS_ENABLE_COMMENTS:
'false'` pour rester en `contents: read` (pas de `pull-requests: write`). **Push
    Protection / upload SARIF NON activés** : ce sont des fonctions GHAS, indisponibles
    sur dépôt privé gratuit (même limite que CodeQL #2 ci-dessus) → le garde-fou est
    l'exit code du job, pas l'onglet Security. Scan d'historique local via Docker tenté
    mais Docker Desktop arrêté → le 1er run CI du job fait foi sur « historique propre ».
    `.env.server`/`.env` confirmés gitignorés (`.gitignore:64-65`).

  **Reste : Sessions C (CD/GHCR central : AUD-05/12/06/07/08), D (toolchain : AUD-10/11/13/15).**

- **2026-06-10 — Session B (`chore/cicd-governance`, PR #20, merge `2f59190`)** : AUD-04
  (`.github/CODEOWNERS` + `SECURITY.md` racine ; protection de branche re-vérifiée via
  `gh api` → toujours HTTP 403, dépôt privé/gratuit, limitation tracée) et AUD-09 (job
  `secret-scan` gitleaks-action v3.0.0 épinglée SHA, `fetch-depth:0`, push+PR, bloquant
  par exit-code ; `permissions: pull-requests: read` indispensable pour lister les commits
  de la PR ; Push Protection/SARIF non activés = GHAS indispo). CI 100 % verte.

- **2026-06-10 — Session C (`feat/cicd-cd-ghcr`)** : CD réel + chaîne d'appro.
  - **AUD-05/AUD-12** — `build-images` REFONDU en **publisher GHCR** (fusion AUD-12 : plus
    d'images construites puis jetées). Sur **PR** : build seul (`push:false`/`load:true`,
    preuve de constructibilité + image locale pour le scan ; les forks ne poussent pas).
    Sur **push:main** : build + **push** `ghcr.io/edouardzemb/creche-planner/<svc>` (tags
    `:main` rolling + `:<sha40>` immuable, via `docker/metadata-action`), `permissions:
packages: write` + `id-token: write`. **Consommation prod** : `docker-compose.server.yml`
    pose `image: …:${IMAGE_TAG:-main}` sur les 6 services applicatifs (prime sur le `build:`
    de base) ; déploiement = `docker compose pull && up -d --wait` (plus de `--build`).
    `.env.server.example` : `IMAGE_TAG=main` + note `docker login ghcr.io` (images privées,
    PAT `read:packages`). Doc 24 §5 (Porte 1bis pull+verify, Porte 2 sans `--build`), §9
    (rollback par tag), runbook §8.3 actualisés.
  - **AUD-06** — scan **Trivy** (`aquasecurity/trivy-action`, épinglée SHA) sur la ref
    `:<sha>`, `severity HIGH,CRITICAL`, `ignore-unfixed:true`, `exit-code:1` **bloquant**.
    **Pas d'upload SARIF** (Security tab = GHAS indispo, comme secret-scan/CodeQL) → garde-fou
    = exit-code. Allowlist `.trivyignore` (vide) créée.
  - **AUD-07** — attestations `provenance:true` + `sbom:true` (sur push uniquement —
    incompatibles avec `load`), **signature cosign keyless** (`sigstore/cosign-installer`,
    OIDC `id-token: write`) du digest poussé. Commande `cosign verify` documentée (doc 24
    Porte 1bis).
  - **AUD-08 (DORA) — DIFFÉRÉ (⏳)** : nécessite un **mécanisme de déploiement** traçable.
    Le déploiement prod reste **manuel** (SSH `pull && up` sur le serveur de prod) ; aucun
    événement GitHub Deployment n'est émis. À traiter quand un workflow de déploiement
    (ou un webhook serveur créant un GitHub Deployment) existera — candidat Session D/après.
  - **Limite de validation** : cette PR ne touchant aucun projet déployable, le job
    `build-images` est **skippé** par le gate `affected-images.has_projects` → le chemin
    publish/scan/sign n'est PAS exercé par la CI de la PR. **1er exercice réel = prochain
    push:main affectant un service** (= test d'acceptation AUD-05/06/07). Build local non
    vérifié (Docker Desktop arrêté). Actions nouvelles épinglées par SHA résolus via
    `gh api` : login-action v4.2.0 `650006c…`, metadata-action v6.1.0 `80c7e94…`,
    trivy-action v0.36.0 `ed142fd…`, cosign-installer v4.1.2 `6f9f177…`.

  **Reste : AUD-08 (DORA, différé) + Session D (toolchain : AUD-10/11/13/15).**

- **2026-06-10 — Session D (`chore/toolchain-align`)** : toolchain P3.
  - **AUD-10 (Node figé)** — décision : **rester sur Node 24** (et non Node 22 comme
    esquissé à l'audit) car tout l'environnement réel y était DÉJÀ (machine dev `v24.16.0`,
    `.nvmrc=24`, CI `node-version:24`) et Node 24 « Krypton » est passé **LTS** fin 2025 →
    zéro downgrade, on aligne sur le réel. `.nvmrc` **figé au patch `24.16.0`** (était `24`,
    non reproductible). CI : les **7** `node-version: 24` codés en dur → `node-version-file:
.nvmrc` (source unique). `package.json` : `@types/node` **20.19.9 → 24.13.1** (accordé à la
    majeure exécutée ; fin du type-check contre Node 20 sous Node 24), `engines.node`
    **`>=22` → `>=24`** (resserré sur la majeure de `.nvmrc`).
  - **AUD-11 (pnpm 9/10)** — `packageManager` **`pnpm@8.15.1` → `pnpm@10.34.2`** (dernière
    major). `pnpm-lock.yaml` **régénéré via corepack** (`corepack pnpm install`, le champ
    `packageManager` pilote la version) → format **lockfileVersion `6.0` → `9.0`** (gros
    diff attendu). `pnpm install --frozen-lockfile` re-vérifié cohérent. **Piège pnpm 10** :
    les _build scripts_ de dépendances sont **ignorés par défaut** (durcissement sécurité) —
    [À CONFIRMER après build : si esbuild/@swc/core/nx cassent, ajouter `pnpm.onlyBuiltDependencies`].
  - **AUD-13 (cache Nx)** — step **`actions/cache` (v5.0.5 épinglé SHA `27d5ce7…`)** dans le
    job `ci` (le plus lourd), `path: .nx/cache`, clé `nx-<os>-<hash(pnpm-lock,nx.json)>-<sha>`
    - `restore-keys` en cascade → réutilisation des artefacts inchangés entre runs. Posé sur
      `ci` seul (les autres jobs nx ont un moindre gain et créeraient des conflits de clé).
  - **AUD-15 (release)** — nouveau **`.github/workflows/release.yml`** déclenché sur push de
    tag `*@*` (pattern nx `{projectName}@{version}`) + `workflow_dispatch`. Décompose le tag
    → build+push de l'**image versionnée** `ghcr.io/edouardzemb/creche-planner/<projet>:<version>`
    (semver immuable + `:<sha>`), avec la **même chaîne d'appro que `build-images`**
    (provenance + SBOM + Trivy bloquant + cosign keyless), puis **GitHub Release** à notes
    auto-générées (idempotent si `nx release` l'a déjà créée). ci.yml ne se déclenche pas sur
    les tags → pas de double publication. Runbook §8.2 actualisé (push de tag → release auto).

  **Reste : AUD-08 (DORA, différé — nécessite un mécanisme de déploiement traçable).**

- **2026-06-10/11 — Clôture Session D (PR #22 `chore/toolchain-align`, merge `88677d7`) +
  remédiation des latents exposés (PR #23 `fix/contract-pact-latents`, merge `6ccfb34`).**

  - **Confirmation AUD-11 (pnpm 10 / build scripts ignorés)** — le « À CONFIRMER » ci-dessus
    est **levé** : pnpm 10 n'exécute plus les _build scripts_ par défaut, mais cela reste
    **sans effet** (typecheck + build verts sur 17 projets ; `install --prod` du stage Docker
    `deps` exit 0 avec seul `protobufjs` en _warning_, inoffensif au runtime). **L'ancien
    `ERR_PNPM_IGNORED_BUILDS` de pnpm 10 (doc 14 §5.1) est relâché en simple _warning_** sur
    10.34.2. **Corollaire** : le `Dockerfile` (stage `deps`) épinglait `pnpm@8.15.1` →
    incompatible avec le **lockfile v9** produit par `nx prune` → corrigé en `pnpm@10.34.2`
    (sinon tous les builds Docker cassaient). Pas de `pnpm.onlyBuiltDependencies` nécessaire.

  - **4 latents pré-existants révélés par le diff lockfile de #22.** Le changement de
    `pnpm-lock.yaml` a forcé `nx affected` sur **tous** les projets — premier déclencheur
    « tout affecté » depuis longtemps (les Sessions A/B/C ne touchaient que `.github`/docs).
    Cela a exercé des specs qui ne tournaient plus depuis le 2-7 juin, exposant des échecs
    **sans lien avec la toolchain** (mêmes `pact-core` 15.2.1 et deps runtime que `main`) : 1. **`svc-foyer`** — le contrat consumer matchait `rfrEuros`/`nbParts` (entiers : 72705 €,
    3 parts) en `decimal()`. **pact-core 15.2.1 distingue strictement integer/decimal** et
    rejette un entier sur un matcher `decimal`. → `integer()`, pact régénéré. 2. **`svc-planification`** — les pacts envoyaient des semaines **partielles** (`{LUNDI}`)
    alors que le provider exige des **Record exhaustifs des 7 jours** (`z.record(enum,…)`
    est exhaustif en **Zod 4** ; cf. **AN-02** doc 22, doc 14 §3 ; le front envoie déjà les
    7 jours) → `400`. + le `foyerId` du corps de modification (`2222…2222`, **variant
    non-RFC**) était rejeté par `z.string().uuid()` (**strict en Zod 4**) là où
    `ParseUUIDPipe` (path/query) le tolère → `400`. → semaines complètes + UUID v4 valide,
    pact régénéré. 3. **`svc-referentiel`** — flaky : la **readiness HTTP (liveness) ne garantit ni la fin
    des migrations ni le seed de boot _fire-and-forget_** (`SeedService` : `void
this.amorcer()`). Le `stateHandler` (select-puis-insert) levait `relation
"grille_abcm" does not exist` (vraie cause profonde du « state handler failed »
    intermittent, ≠ simple course de seed). → attente que la grille T3 soit **commitée**
    avant `verifyProvider`, **avec `try/catch` tolérant la table non encore migrée**
    (complément `bf60358` après ré-échec sous la forte concurrence de #22). 4. **Gate Trivy (AUD-06) — 1re exécution réelle.** `build-images` ne s'exécute que sur un
    projet déployable affecté : depuis Session C, aucun PR n'en touchait → **le scan Trivy
    n'avait jamais tourné**. Sa 1re exécution a bloqué sur **5 CVE `libgnutls30`** (3 HIGH,
    2 CRITICAL) du base image `node:24-slim`, **corrigibles** (`3.7.9-2+deb12u6` →
    `+deb12u7`). → durcissement : **`apt-get upgrade -y`** au stage `runtime` (Dockerfile
    services) + **`apk upgrade --no-cache`** (`apps/web/Dockerfile`, nginx:alpine). Le gate
    reste **strict** (pas de `.trivyignore`). Vérifié localement : image patchée scannée
    par Trivy (mêmes options que la CI) → **exit 0**.

  - **Méthode** : tous les latents ont été **root-causés et vérifiés localement** contre
    Postgres réel (4 conteneurs `docker compose up`) avant push, puis confirmés en CI. La
    séquence a respecté la discipline PR : #23 (latents) mergée d'abord, puis #22 rebasée
    dessus (rebase Dockerfile auto-fusionné — pin pnpm et `apt upgrade` sur lignes disjointes).

  - **✅ Acceptation AUD-05/06/07 — 1er publish GHCR RÉEL.** Le `push:main` du merge de #22
    (run `27307415589`) a **publié les 6 images** sur `ghcr.io/edouardzemb/creche-planner/*`
    avec **succès** : AUD-05 (push GHCR + tags `:main`/`:<sha>`), AUD-06 (Trivy sur image
    publiée, patch OS validé), **AUD-07 (provenance + SBOM + signature `cosign` keyless OIDC,
    jamais exercée jusqu'ici → OK)**. La chaîne d'appro Sessions C+D est désormais éprouvée
    de bout en bout sur un vrai déploiement d'artefact.

  - **Pièges nx mémorisés** : (a) les fichiers `/pacts/*.json` sont **hors project root** →
    changer un pact n'affecte (nx) QUE `api-gateway` (consumer) + le provider dont le `.spec`
    change, **pas** les autres `svc-*` ; (b) un diff de **lockfile** est le seul déclencheur
    « tout affecté » → utile à provoquer périodiquement pour débusquer les régressions
    dormantes des projets rarement touchés.

  **Bilan plan doc 25 : 15/16 actions livrées et mergées. Reste uniquement AUD-08 (DORA),
  volontairement différé tant qu'aucun mécanisme de déploiement traçable n'existe (prod encore
  déployée manuellement par SSH).**

- **2026-06-11 — AUD-08 (DORA, `feat/cicd-dora-aud-08`)** : dernière action ouverte du plan,
  CLÔTURÉE. Design préalable dans **[doc 26](26-instrumentation-dora-aud-08.md)** (mécanisme,
  options évaluées, définitions opérationnelles, écart CT-QDO).
  - **Topologie d'abord** : le « push SSH d'un runner hébergé » de l'énoncé est **infaisable**
    (le serveur de prod n'a **aucun port entrant** ; Cloudflare Tunnel est **sortant** ; la Deploy Key
    est **git-only**, pas d'accès API). Le déploiement étant **pull-based** (AUD-05), l'événement
    doit **naître sur le serveur**. Mécanisme retenu = **wrapper côté serveur** (option A ; option B
    runner self-hosted documentée comme évolution, écartée pour la surface d'attaque sur machine
    prod partagée).
  - **`scripts/deploy.mjs`** (Node pur, zéro dép.) : enchaîne les portes doc 24 (1bis `pull`
    [+ `cosign verify` opt.] → 2 `up --wait` → 3 health/seed/perf) ET crée un **GitHub Deployment**
    `production` + statut `in_progress`→`success`/`failure` via l'API. **SHA déployé résolu** depuis
    le label OCI `org.opencontainers.image.revision` de l'image gateway tirée (exact même sur rolling
    `:main`). **Télémétrie best-effort** : une panne API n'avorte jamais un déploiement réel ; seul
    l'échec d'une **porte** est fatal (→ `failure`). `DORA_DRY_RUN` validé localement.
  - **`.github/workflows/scripts/dora-metrics.mjs`** + **`dora.yml`** (hebdo + `workflow_dispatch`) :
    dérivent les **4 clés** depuis l'API Deployments (+ `/commits` pour le lead time, + issues
    `incident` best-effort), avec classement Elite/High/Medium/Low et export Prometheus optionnel.
    Subtilité gérée : poser un statut `success` **auto-inactive** les précédents → on classe par le
    dernier statut **≠ `inactive`**. Lecture seule (`GITHUB_TOKEN`), **aucun PAT côté CI**. Math
    **validée hors-ligne** (harnais fetch mocké : freq/lead/CFR/MTTR + cas d'inactivation).
  - **Plateforme** : Environments + API Deployments **dispo sur privé gratuit** (≠ branch
    protection/GHAS) ; _protection rules_ d'environnement gated → non utilisées (porte = script).
  - **Docs** : doc 24 §9 (déploiement via wrapper) + §10 (ligne DORA « non instrumenté » →
    « instrumenté »), `.env.server.example` (`GH_DEPLOYMENTS_TOKEN` fine-grained + commande).
  - **Validation réelle** différée au **prochain déploiement serveur** par le wrapper (1er
    Deployment effectif) — même schéma d'acceptation que AUD-05/06/07.

  **✅ Plan doc 25 BOUCLÉ : 16/16 actions livrées.**

- **2026-06-12 — Garde-fous : SAST de retour via Semgrep (AQ-11, [doc 27](27-audit-global-remediation.md))** :
  depuis la mise en pause de CodeQL (GHAS indisponible sur dépôt privé gratuit, cf. §journal
  2026-06-09), **aucune analyse statique de sécurité ne tournait**. Nouveau job **`sast-semgrep`**
  dans [`ci.yml`](../.github/workflows/ci.yml) : image `semgrep/semgrep:1.165.0` **épinglée par
  digest** (AUD-02), deux passes — findings **ERROR bloquants par exit-code** (`--severity ERROR
--error`), toutes sévérités en **informatif** (même motif que le job `security` ; même famille
  de garde-fous que gitleaks/Trivy : pas de SARIF ni d'onglet Security). **Déviation vs l'esquisse
  doc 27** : les packs registre `p/typescript`/`p/nodejs` ont été ÉCARTÉS après test local — sans
  login, le registre ne sert qu'un sous-ensemble réduit (74 règles) **incapable de détecter
  `eval(userInput)` ou une injection de commande**. À la place : règles OSS de
  `semgrep/semgrep-rules` (dossiers `javascript/` + `typescript/`, ~212 règles) **épinglées par
  SHA** (`48a4fdb8…`), checkout sparse + `--exclude .semgrep-rules` (fixtures volontairement
  vulnérables) + `--metrics=off` (aucun appel registre). Vérifié localement : dépôt **0 finding**
  (357 fichiers), et la fixture `code-string-concat` introduite volontairement → **exit 1**. Un
  faux positif se traite **ligne à ligne** par `// nosemgrep: <rule-id>` justifié, jamais par
  ignore global ; montée de version des règles = bump du `ref`.
