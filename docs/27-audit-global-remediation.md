# Audit global & plan de remédiation (architecture, code, web, tests, produit)

> **Origine** : audit complet du 2026-06-11 (architecture, qualité du code backend,
> frontend PWA, stratégie de test & CI/CD, pertinence fonctionnelle, organisation
> du dépôt), mené en six analyses parallèles puis contre-vérifié sur les constats
> sensibles.
>
> **But de ce document** : transformer les constats en **actions traçables et
> exécutables dans de futures sessions**, sans avoir à re-dériver le diagnostic.
> Chaque action porte un **ID stable (AQ-xx)**, une **priorité**, les **fichiers
> concernés**, un **critère de sortie** vérifiable et une esquisse d'implémentation.
>
> Convention reprise de la [doc 25](25-audit-cicd-remediation.md) (registre AUD-xx,
> roadmap par session). Une session = **une branche dédiée + une PR** (convention du
> dépôt, cf. [doc 03](03-standards-developpement.md)).

---

## 0. État du projet au moment de l'audit

**Note globale : A− (~88/100).**

| Dimension      | Note | Synthèse                                                                                                       |
| -------------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| Domaine métier | A+   | 100 % couverture imposée, 20 oracles chiffrés (CT-01..20) verts, MBT réellement utile, zéro déviation doc 02   |
| Architecture   | A    | Bounded contexts enforced (tags Nx bloquants), outbox + idempotence, libs domaine pures                        |
| Code backend   | A−   | TS strict partout, Zod en entrée ; ~150 lignes de boilerplate dupliquées 4×, deux services sans tests unit.    |
| Frontend PWA   | A−   | A11y exemplaire (0 violation axe AA), erreurs réseau bien classées ; annonces live manquantes sur mutations    |
| Tests & CI/CD  | B+   | Pyramide saine, supply-chain au-dessus des standards ; **aucune métrique historisée**, pas de mutation testing |
| Organisation   | A    | 35 docs, conventions enforced de bout en bout ; index de navigation manquant                                   |

**Faiblesses structurantes** (le reste est du polissage) :

1. **Excellence d'exécution, zéro mesure dans le temps** : couverture, flakiness et
   durée CI ne sont historisées nulle part — un abaissement silencieux passerait
   inaperçu.
2. **Trous ciblés dans le filet de test** : pas de garde anti-dérive sur les pacts
   commités, pas de tests unitaires `FoyerService`/`ReferentielService`, pas de test
   d'intégration de la chaîne projection tarification, pas de mutation testing.
3. **Déséquilibre effort/valeur assumé** : l'infrastructure (microservices, NATS,
   observabilité) dépasse le besoin mono-foyer pour longtemps. Recommandation
   stratégique : **geler l'investissement infra** après ce plan et basculer sur la
   valeur utilisateur (plan « Factures réelles », §4).

**Faux positif écarté pendant l'audit** (à ne pas re-signaler) : l'auth désactivée
quand `GATEWAY_TOKEN` est absent est un comportement **délibéré, documenté et
testé** ([token-auth.guard.ts:17](../apps/api-gateway/src/security/token-auth.guard.ts),
5 tests dans `token-auth.guard.spec.ts`) ; en prod l'accès passe par Cloudflare
Access et les ports ne sont pas publiés. AQ-01 n'ajoute qu'un garde-fou défensif.

---

## 1. Registre d'actions (synthèse)

| ID           | Priorité | Constat                                                                                                             | Critère de sortie                                                            | Fichiers principaux                                                                                       |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| ✅ **AQ-01** | P1       | Sans `GATEWAY_TOKEN`, auth désactivée silencieusement — y compris si la prod oublie la var                          | La gateway **refuse de démarrer** en prod sans jeton (test à l'appui)        | `apps/api-gateway/src/config.ts`, `main.ts`                                                               |
| ✅ **AQ-02** | P1       | Rien ne garantit que les pacts commités correspondent à ce que le consumer génère                                   | Job CI échoue si `pacts/*.json` régénérés ≠ commités                         | `.github/workflows/ci.yml`, `pacts/`                                                                      |
| ✅ **AQ-03** | P1       | `prestation as unknown as PrestationRM` court-circuite le typage sur le calcul des coûts                            | Cast remplacé par une validation Zod, test du cas non conforme               | `apps/svc-tarification/src/tarification/cout.service.ts`                                                  |
| ✅ **AQ-04** | P1       | Regex date naïve `^\d{4}-\d{2}-\d{2}$` accepte `2026-13-45`                                                         | `z.string().date()` (ou équiv.), test BVA sur dates invalides                | `apps/svc-referentiel/src/referentiel/referentiel.controller.ts:69`                                       |
| ✅ **AQ-05** | P1       | Aucune annonce `aria-live` lors des mutations du calendrier (absences, jours sup)                                   | Région live annonce chaque mutation ; test unitaire + axe toujours vert      | `apps/web/src/planning/CalendrierCreche.tsx`                                                              |
| ✅ **AQ-06** | P2       | Aucune métrique de test historisée (couverture, flakiness, durée CI)                                                | lcov + JUnit en artefacts à chaque run + job de comparaison vs baseline      | `.github/workflows/ci.yml`, `libs/*/vitest.config.mts`                                                    |
| ✅ **AQ-07** | P2       | ~150 lignes dupliquées 4× : `domain-exception.filter.ts`, modules NATS/DB quasi identiques                          | Lib `nest-commons` ; les 4 services l'importent ; duplication supprimée      | `apps/svc-*/src/common/`, `libs/` (nouvelle lib)                                                          |
| ✅ **AQ-08** | P2       | `FoyerService` et `ReferentielService` sans tests unitaires (seuls les pacts les couvrent)                          | Tests unit. : outbox transactionnel, 404, chevauchement de période refusé    | `apps/svc-foyer/src/foyer/`, `apps/svc-referentiel/src/referentiel/`                                      |
| ✅ **AQ-09** | P2       | Chaîne « événement → projection → calcul » non testée hors E2E stack                                                | Test d'intégration : event en base → projection à jour + idempotence rejouée | `apps/svc-tarification/src/consumers/`                                                                    |
| ✅ **AQ-10** | P2       | Types web maintenus à la main, miroir manuel de l'OpenAPI gateway (DEC-03, doc 09)                                  | Types générés depuis l'OpenAPI (script + cible Nx), diff CI si dérive        | `apps/web/src/api/`, `apps/api-gateway` (export spec)                                                     |
| ✅ **AQ-11** | P2       | SAST absent (CodeQL en pause, GHAS indisponible en privé gratuit)                                                   | Semgrep OSS en CI, règles TS/NestJS de base, bloquant sur ERROR              | `.github/workflows/ci.yml`                                                                                |
| ✅ **AQ-12** | P2       | `extraireErreurs` dupliquée ; échec quota `sessionStorage` silencieux                                               | Fonction extraite dans `utils/` ; warning console + info utilisateur         | `apps/web/src/foyer/FoyerFormPage.tsx`, `ContratForm.tsx`, `apps/web/src/hooks/usePersistanceAbsences.ts` |
| ✅ **AQ-13** | P3       | 100 % de couverture ne prouve pas que les assertions mordent (pas de mutation testing)                              | Stryker sur ≥ 2 libs domaine, score ≥ 80 %, mutants survivants triés         | `libs/tarification/domain`, `libs/planification/domain`                                                   |
| 🔶 **AQ-14** | P3       | Événements NATS documentés seulement en code ; rétention JetStream non documentée ; rebinding consumer à délai fixe | AsyncAPI par contexte + doc rétention + backoff exponentiel                  | `libs/contracts/*/`, `apps/svc-tarification/src/consumers/jetstream.consumer.ts`, `docs/exploitation/`    |
| 🔶 **AQ-15** | P3       | CI jusqu'à ~50 min (smoke-stack + e2e-stack séquentiels, rebuilds) ; pas de healthcheck apps                        | smoke/e2e parallélisés ou mutualisés, cache buildx, healthchecks 5 apps      | `.github/workflows/ci.yml`, `docker-compose.yml`                                                          |
| ✅ **AQ-16** | P3       | Pas d'index de navigation docs, pas de CONTRIBUTING.md, `caddy-root.crt` à la racine, étapes onboarding implicites  | Index « par où commencer », CONTRIBUTING, cert déplacé, README complété      | `docs/README.md` (nouveau), `.github/CONTRIBUTING.md`, `README.md`                                        |
| **AQ-17**    | P3       | Mineurs backend : pas de timeout sur transactions Drizzle ; rate-limit mémoire non documenté mono-instance          | Timeout configuré + commentaire/doc sur la limite du rate-limit              | `apps/svc-*/src/database/`, `apps/api-gateway/src/security/rate-limit.guard.ts`                           |
| **AQ-18**    | P3       | Pas de lazy loading des routes web (acceptable à 5 écrans, à faire si le périmètre grossit)                         | `React.lazy` + `Suspense` sur les pages lourdes, bundle initial réduit       | `apps/web/src/App.tsx`                                                                                    |

Priorités : **P1** = quick wins correctness/a11y (< 1 j cumulé) ; **P2** = chantiers
structurants (mesure, factorisation, tests manquants, typage) ; **P3** = robustesse
& polissage. AQ-18 est optionnel (déclencheur : ajout d'un 6ᵉ écran).

> **Revue de statut (2026-07-02)** — re-vérifiée **action par action dans le code et la
> CI** (pas sur déclaration). Légende : ✅ livré · 🔶 partiellement livré (détail §3) ·
> sans coche = ouvert.
>
> - **AQ-01→13 : livrées et toujours en place** (garde-fou `GATEWAY_TOKEN` dans
>   `config.ts`, job `pact-drift`, `z.iso.date()`, région live du calendrier,
>   baseline de couverture en CI, `libs/nest-commons`, specs `foyer.service.spec.ts` /
>   `referentiel.service.spec.ts`, `projection.integration.spec.ts`,
>   `openapi-types-drift`, `sast-semgrep`, `utils/erreurs.ts`, `mutation.yml`).
> - **AQ-14 🔶** : backoff progressif livré (natif JetStream) ; AsyncAPI et doc de
>   rétention toujours manquants. **AQ-15 🔶** : smoke/e2e parallélisés + cache buildx
>   GHA ; healthchecks des apps hors gateway manquants.
> - **AQ-16 ✅** : livrée le 2026-07-02 (index `docs/README.md`, `CONTRIBUTING.md`,
>   bandeau « historique » sur la doc 05 — déviations assumées en §3).
>   **AQ-17, AQ-18** : ouverts.
>
> ⚠️ **Numéros de PR** : les PR de ce plan (#39→#48, sessions A→H) datent d'**avant la
> publication du dépôt** (2026-06-18, historique squashé dans l'import initial `4f36e3e`).
> Ces numéros ne correspondent à **aucune PR du dépôt public actuel** — cf. §5.

---

## 2. Roadmap d'exécution (par session)

Découpage pensé pour des **sessions indépendantes à fichiers disjoints**
(parallélisables sauf mention), chacune autonome : le contexte nécessaire est dans
le détail de l'action (§3), pas dans l'historique de conversation.

### Session A — Quick wins backend (`fix/audit-quickwins-backend`)

**AQ-01, AQ-03, AQ-04** (+ AQ-17 si le temps le permet). Sans dépendance.
Trois corrections localisées, chacune avec son test. ~2-3 h.

### Session B — Garde anti-dérive Pact (`ci/pact-drift-check`)

**AQ-02**. Sans dépendance. Commencer par **vérifier l'état réel** : lancer les
tests consumer du gateway et comparer les pacts générés aux fichiers commités —
l'audit a identifié l'absence de garde, pas une dérive avérée. ~2-3 h.

### Session C — A11y & petits fixes web (`fix/web-a11y-annonces`)

**AQ-05 + AQ-12**. Sans dépendance. Fichiers exclusivement sous `apps/web/`. ~3-4 h.

### Session D — Qualité mesurée en CI (`ci/metriques-historisees`)

**AQ-06 + AQ-11**. Sans dépendance (même fichier `ci.yml` que B : ne pas paralléliser
avec B). Le chantier le plus important du plan en valeur long terme. ~1 j.

### Session E — Factorisation nest-commons (`refactor/nest-commons`)

**AQ-07**. Sans dépendance. **À faire avant la session F** (écrire les tests sur le
code factorisé, pas l'inverse). Touche les 4 services + une nouvelle lib. ~0,5-1 j.

### Session F — Tests manquants services (`test/services-foyer-referentiel`)

**AQ-08 + AQ-09**. Dépend de E (faiblement : faisable avant, mais les tests
devraient alors être retouchés après la factorisation). ~1 j.

### Session G — Typage web généré (`feat/web-types-openapi`)

**AQ-10** (= DEC-03 de la [doc 09](09-spec-decouplage-microservices.md)). Sans
dépendance. ~0,5-1 j.

### Session H — Mutation testing (`test/mutation-stryker`)

**AQ-13**. Idéalement après F (le filet est complet). ~0,5-1 j + triage.

### Session I — Contrats d'événements & résilience NATS (`docs/asyncapi-nats`)

**AQ-14**. Sans dépendance. ~0,5-1 j.

### Session J — CI plus rapide (`ci/pipeline-parallele`)

**AQ-15**. Après D (même fichier `ci.yml`, et les métriques de durée de D
permettent de mesurer le gain). ~0,5-1 j.

### Session K — Hygiène documentaire (`docs/index-et-contributing`)

**AQ-16**. Sans dépendance, aucun risque. ~2-3 h.

> **Ordre recommandé** : A, B, C en premier (quick wins, parallélisables entre
> elles — fichiers disjoints sauf B/D sur `ci.yml`). Puis D (mesure), E → F
> (factorisation puis tests), G. Enfin H, I, J, K dans n'importe quel ordre.
> **Après ce plan : gel infra, cap sur le plan produit « Factures réelles » (§4).**

---

## 3. Détail des actions

### AQ-01 — Garde-fou prod sur `GATEWAY_TOKEN` · P1

**Constat.** [token-auth.guard.ts:38](../apps/api-gateway/src/security/token-auth.guard.ts)
retourne `true` pour toute requête quand `GATEWAY_TOKEN` est absent. C'est voulu
(confort dev, prod derrière Cloudflare Access + ports non publiés), mais rien ne
protège contre une **régression de config** : un `.env.server` incomplet ou une
var supprimée par erreur désactiverait l'auth sans aucun signal.

**Implémentation.** Au bootstrap (`main.ts` ou `loadConfig()` dans
[config.ts](../apps/api-gateway/src/config.ts)) : si `NODE_ENV === 'production'`
et `authToken === undefined`, **lever une erreur fatale** avec un message explicite
(« GATEWAY_TOKEN requis en production ; pour désactiver l'auth volontairement,
poser GATEWAY_AUTH_DISABLED=1 »). Prévoir l'échappatoire explicite
`GATEWAY_AUTH_DISABLED` puisque la prod actuelle tourne **volontairement** sans
jeton (décision doc 24) — le but est de transformer un défaut implicite en choix
explicite. Mettre à jour [.env.server.example](../.env.server.example) et la doc 24.

**Attention.** Vérifier l'impact sur la prod réelle **avant** merge : si
`NODE_ENV=production` y est posé, le déploiement suivant exigera la nouvelle var.
Ajouter la ligne dans `.env.server` côté serveur fait partie du critère de sortie.

**Critère de sortie.** Test unitaire « prod sans jeton ni échappatoire → démarrage
refusé » vert ; stack dev (`docker compose up`) inchangée ; prod redéployée OK.

---

### AQ-02 — Garde anti-dérive des pacts commités · P1

**Constat.** Les pacts (`pacts/*.json`) sont générés par les tests consumer du
gateway et **commités** ; la CI vérifie les providers contre ces fichiers
(+ gate `can-i-deploy`). Mais rien ne garantit que les fichiers commités sont à
jour : si un test consumer évolue sans re-commit du pact, les providers sont
vérifiés contre un contrat périmé.

**Vérifier d'abord.** Lire `.github/workflows/ci.yml` et les specs
`apps/api-gateway/contract/*.pact.spec.ts` : confirmer où les pacts sont écrits et
si un mécanisme de comparaison existe déjà (l'audit n'en a pas trouvé).

**Implémentation.** Après le job qui exécute les tests consumer, ajouter un step
`git diff --exit-code pacts/` (ou comparaison normalisée si les pacts contiennent
des champs non déterministes — les trier/normaliser le cas échéant). Échec = le
développeur doit commiter les pacts régénérés.

**Critère de sortie.** Une modification volontaire d'une interaction consumer sans
re-commit du pact fait **échouer la CI** ; le cas nominal reste vert.

---

### AQ-03 — Remplacer le cast `as unknown as PrestationRM` · P1

**Constat.** [cout.service.ts:366](../apps/svc-tarification/src/couts/cout.service.ts) :
`prestation as unknown as PrestationRM` sur le chemin de calcul des coûts. Le
double cast neutralise le typage strict à l'endroit le plus critique du projet
(jsonb → domaine).

**Implémentation.** Définir (ou réutiliser) un schéma Zod `prestationRmSchema`
aligné sur le type `PrestationRM`, et remplacer le cast par
`prestationRmSchema.parse(prestation)`. En cas de non-conformité : erreur explicite
(données de projection corrompues = bug à faire remonter, pas à masquer). Chercher
les autres `as unknown as` hors specs (`grep -rn "as unknown as" apps/ libs/ --include=*.ts | grep -v spec`)
et traiter de la même façon ceux qui sont en code de prod.

**Critère de sortie.** Plus aucun `as unknown as` en code de production ; test du
cas « prestation malformée → erreur explicite » vert ; suite tarification verte.

> **MÀJ 2026-07-02** : le constat d'origine (cast dans `cout.service.ts`) reste corrigé.
> Une occurrence est toutefois **réapparue depuis** en code de production —
> [semaine-besoins.ts:169](../apps/api-gateway/src/bff/semaine-besoins.ts) — lecture
> **défensive et commentée** d'un champ `passthrough` (parse en échec ⇒ champ omis,
> pas de crash). Assumée en l'état ; à résorber si le champ intègre un jour le contrat typé.

---

### AQ-04 — Validation réelle des dates au référentiel · P1

**Constat.** [referentiel.controller.ts:69](../apps/svc-referentiel/src/referentiel/referentiel.controller.ts) :
regex `^\d{4}-\d{2}-\d{2}$` qui accepte `2026-13-45`.

**Implémentation.** Remplacer par `z.string().date()` (Zod ≥ 3.23 valide le
calendrier réel) dans le schéma de query. Vérifier s'il existe d'autres validations
de date par regex dans les contrôleurs (`grep -rn "\\\\d{4}-" apps/*/src --include=*.ts`).

**Critère de sortie.** `2026-13-45` et `2026-02-30` → 400 avec message de
validation ; dates valides inchangées ; tests BVA ajoutés.

---

### AQ-05 — Annonces `aria-live` sur les mutations du calendrier · P1

**Constat.** Dans [CalendrierCreche.tsx](../apps/web/src/planning/CalendrierCreche.tsx),
ajouter/retirer une absence ou un jour supplémentaire ne produit **aucune annonce**
pour les lecteurs d'écran : l'utilisateur non-voyant ne sait pas que son action a
été prise en compte avant la sauvegarde (debounce 800 ms). Seule vraie lacune
relevée par l'audit a11y — le reste (Tabs, focus de route, modale, deltas) est
exemplaire, s'en inspirer.

**Implémentation.** Région live unique (`role="status"` + `aria-live="polite"` +
classe `sr-only`) alimentée à chaque mutation : « Absence ajoutée le 12 juin »,
« Jour supplémentaire retiré le 3 juin », et à la sauvegarde (réutiliser/compléter
`StatutSauvegarde` si pertinent). Suivre le motif existant de
[useAnnonceRoute.ts](../apps/web/src/hooks/useAnnonceRoute.ts). Appliquer aussi au
calendrier ABCM si la même lacune s'y trouve.

**Critère de sortie.** Test unitaire vérifiant le contenu de la région live après
mutation ; suite axe e2e toujours 0 violation ; conventions doc 11 respectées.

---

### AQ-06 — Métriques de test historisées · P2

**Constat.** La CI calcule couverture et résultats mais ne **publie ni ne compare
rien dans le temps** : pas d'artefacts lcov/JUnit conservés, pas de baseline, pas
de détection de flakiness. Déjà pointé par la doc 18 (KPI §1.3) sans outillage.

**Implémentation.**

1. Uploader en artefacts à chaque run : lcov des libs domaine + rapports JUnit
   (vitest et Playwright) avec rétention longue (90 j).
2. Job de comparaison : télécharger la baseline du dernier run `main`
   (`gh api .../artifacts` ou actions/cache), comparer la couverture globale, échec
   si baisse > 0,5 pt, résumé dans `GITHUB_STEP_SUMMARY`.
3. Flakiness : activer `retries` + reporter JUnit chez Playwright, compter les
   tests « passés après retry » dans le summary.

**Critère de sortie.** Chaque run de `main` publie ses artefacts ; une PR qui fait
baisser la couverture domaine échoue avec un message comparatif ; le summary
affiche couverture + retries.

> **MÀJ 2026-07-02** : renforcée depuis par l'audit 2026-07 (lot 1a) — couverture
> **mesurée avec seuils ratchet** sur les 5 services et le web
> ([#130](https://github.com/EdouardZemb/creche-planner/pull/130), après réactivation
> de la couverture gateway [#129](https://github.com/EdouardZemb/creche-planner/pull/129)).

---

### AQ-07 — Lib `nest-commons` (dédup boilerplate services) · P2

**Constat.** Vérifié : `domain-exception.filter.ts` existe en **4 copies**
(`apps/svc-{foyer,referentiel,planification,tarification}/src/common/`), et les
modules NATS/database suivent le même motif quasi identique. ~150 lignes dupliquées
sans valeur métier ; toute correction doit être reportée 4 fois (déjà identifié en
DEC-07, doc 09).

**Implémentation.** Générer une lib Nx (invoquer le skill `nx-generate`) — nom
suggéré `libs/nest-commons`, tags `type:infrastructure`, `context:shared` pour
respecter les frontières ([.eslintrc.json](../.eslintrc.json)). Y déplacer :
`DomainExceptionFilter`, le module NATS générique (connexion + publication outbox),
la fabrique de module database (paramétrée par schéma). Migrer les 4 services un
par un, suite verte entre chaque.

**Critère de sortie.** Plus aucune copie locale des fichiers factorisés ;
`pnpm nx run-many -t lint typecheck test build` vert ; frontières Nx respectées
(le lint les vérifie) ; pacts inchangés.

---

### AQ-08 — Tests unitaires `FoyerService` et `ReferentielService` · P2

**Constat.** Ces deux services n'ont **aucun test unitaire applicatif** (seuls les
pacts et l'E2E les exercent), contrairement à planification et tarification qui
sont bien couverts. Les cas à risque : transactionnalité outbox, 404, règles de
chevauchement de période des grilles.

**Implémentation.** S'inspirer des specs existantes
(`apps/svc-planification/src/.../planification.service.spec.ts` : fakes de DB sans
vraie base). Couvrir au minimum — Foyer : création avec écriture outbox **dans la
même transaction**, ajout d'enfant avec validation domaine, `NotFoundException`
sur obtenir/mettre à jour inexistant. Référentiel : chevauchement de période
refusé, sélection de la grille applicable à une date, versionnement (création
d'une nouvelle fenêtre de validité).

**Critère de sortie.** Specs en place pour les deux services, cas ci-dessus
couverts, suite verte.

---

### AQ-09 — Test d'intégration de la chaîne projection tarification · P2

**Constat.** Le scénario « événement publié → projection mise à jour → coût
recalculé » n'est couvert que par l'E2E stack complète (lourd, feedback lent).
Un mismatch de schéma d'événement serait détecté tard.

**Implémentation.** Test d'intégration au niveau de
`apps/svc-tarification/src/consumers/` : injecter une enveloppe
`FoyerMisAJour.v1` (et `.v2` pour la rétro-compat) dans le handler de projection
avec une base de test (ou fake DB existante), vérifier la projection, puis
**rejouer le même événement** et vérifier le no-op (idempotence via
`processed_event`). Étendre aux événements planification (prestations du mois).

**Critère de sortie.** Tests verts couvrant : projection v1, rétro-compat v2,
idempotence rejouée, événement de type inconnu ignoré sans crash.

---

### AQ-10 — Typage web généré depuis l'OpenAPI (DEC-03) · P2

**Constat.** Les types de `apps/web/src/api/` sont un **miroir manuel** de
l'OpenAPI exposée par la gateway — risque de divergence silencieuse. Déjà acté en
DEC-03 ([doc 09](09-spec-decouplage-microservices.md)), jamais outillé.

**Implémentation.** `openapi-typescript` (dev-dependency, génération de types
purs sans runtime) : cible Nx `web:generate-types` qui lit la spec (exportée en
fichier par la gateway — ajouter une cible qui sérialise la spec si elle n'existe
qu'en route HTTP), génère `apps/web/src/api/openapi-types.gen.ts`. Migrer les
types manuels vers les types générés. En CI : régénérer + `git diff --exit-code`
(même motif qu'AQ-02).

**Critère de sortie.** Types consommés par le client web = types générés ; une
modification de DTO gateway sans régénération fait échouer la CI ; suite web verte.

> **Ajustement à l'exécution (2026-06-12, PR #46)** : la spec n'existe pas
> « qu'en route HTTP » — `gatewayOpenApiDocument` est un objet statique de
> contracts-kernel, donc le script (`scripts/generate-openapi-types.mjs`)
> l'importe directement (type-stripping natif Node 24) : aucune cible de
> sérialisation gateway nécessaire. L'« interpréteur de JSON Schema au niveau
> type » fait main qui dérivait déjà une partie des types (limité à un
> sous-ensemble de JSON Schema → dérive silencieuse en `unknown` hors de ce
> sous-ensemble) est remplacé par le fichier généré ; `api/openapi-types.ts`
> devient un adaptateur mince et la façade `types/bff.ts` est conservée
> (consommateurs intacts ; statuts de réponse en clés **numériques** `200`/`201`,
> convention openapi-typescript). `*.gen.ts` est exclu de prettier/eslint et
> figé en LF (`.gitattributes`) : comparé à l'octet près par le job
> `openapi-types-drift` (dont `affected-images` dépend), aucun formateur ne
> doit y toucher. Dérive prouvée localement : champ ajouté au contrat → diff
> exit 1.

---

### AQ-11 — Semgrep OSS en remplacement de CodeQL · P2

**Constat.** CodeQL est en pause (GHAS indisponible sur dépôt privé gratuit,
[codeql.yml](../.github/workflows/codeql.yml)) : **aucun SAST actif**. Semgrep OSS
tourne sans GHAS et sans upload SARIF (sortie exit-code, comme les autres
garde-fous du dépôt — convention doc 25).

**Implémentation.** Job CI dédié : `semgrep scan --config p/typescript
--config p/nodejs --error` (bloquant sur findings ERROR, WARN informatif).
Épingler l'action/image par SHA (convention AUD-02). Trier les findings initiaux :
corriger ou ignorer ligne à ligne (`# nosemgrep` justifié) — pas d'ignore global.

> **Ajustement à l'exécution (2026-06-12)** : les packs registre `p/typescript`/
> `p/nodejs` se sont révélés édulcorés sans login (74 règles, ne détectent ni
> `eval` ni l'injection de commande) → remplacés par les règles OSS de
> `semgrep/semgrep-rules` épinglées par SHA, `--metrics=off`, deux passes
> (ERROR bloquant / tout informatif). Détail au journal de la doc 25.

**Critère de sortie.** Job vert sur `main` après triage ; un finding ERROR introduit
volontairement (test local) est bien bloquant ; doc 25 §garde-fous mise à jour.

---

### AQ-12 — Petits fixes web (dédup + quota storage) · P2

**Constat.** (1) `extraireErreurs` dupliquée à l'identique entre
[FoyerFormPage.tsx](../apps/web/src/foyer/FoyerFormPage.tsx) et
[ContratForm.tsx](../apps/web/src/foyer/ContratForm.tsx). (2) Dans
`usePersistanceAbsences.ts`, l'échec d'écriture `sessionStorage` (quota) est
avalé par un `catch {}` muet.

**Implémentation.** (1) Extraire dans `apps/web/src/utils/` (suivre le style de
`utils/erreurs.ts`). (2) Dans le catch : `console.warn` + positionner un état
permettant d'informer l'utilisateur que la persistance locale est indisponible
(bandeau discret), sans bloquer la saisie.

**Critère de sortie.** Une seule implémentation d'`extraireErreurs`, tests verts ;
le cas quota est testé (mock de `setItem` qui throw).

---

### AQ-13 — Mutation testing sur les libs domaine · P3

**Constat.** La couverture à 100 % des libs domaine ne prouve pas que les
assertions **mordent**. Le mutation testing est le seul moyen de le mesurer ;
c'est sur `tarification/domain` (calculs d'argent) que le ROI est maximal.

**Implémentation.** `@stryker-mutator/core` + `@stryker-mutator/vitest-runner`
sur `libs/tarification/domain` puis `libs/planification/domain`. Cible Nx
`mutation` **hors CI bloquante** (coûteux) : exécution manuelle ou job hebdo
(`workflow_dispatch` + `schedule`). Trier les mutants survivants : chacun est soit
un test à renforcer, soit du code mort à supprimer.

**Critère de sortie.** Score de mutation mesuré et documenté (≥ 80 % visé sur
tarification) ; mutants survivants triés (issue ou correction) ; cible
reproductible documentée dans la doc 20/21.

> **MÀJ 2026-07-02** : au-delà du périmètre initial (tarification + planification),
> Stryker est exécuté en workflow dédié (`.github/workflows/mutation.yml`) et **étendu
> à `foyer-domain` et `referentiel-domain`**
> ([#131](https://github.com/EdouardZemb/creche-planner/pull/131)).

---

### AQ-14 — AsyncAPI, rétention JetStream, backoff consumer · P3

**Constat.** (1) Les événements NATS ne sont documentés qu'en code
(`libs/contracts/*/src/lib/events/`) — pas de source unique de vérité.
(2) La configuration de rétention des streams JetStream n'est documentée nulle
part. (3) Le rebinding des consommateurs est à délai fixe (5 s) dans
[jetstream.consumer.ts](../apps/svc-tarification/src/consumers/jetstream.consumer.ts)
au lieu d'un backoff exponentiel.

**Implémentation.** (1) Un `asyncapi.yaml` par contexte dans
`libs/contracts/{foyer,referentiel,planification}/` décrivant channels, payloads
v1/v2, en-têtes de dédup. (2) Documenter rétention/limites des 3 streams dans
`docs/exploitation/` (lire la config réelle de création des streams d'abord).
(3) Backoff : `min(DELAI_BASE * 2^tentatives, 60_000)`, remise à zéro au succès,
test unitaire.

**Critère de sortie.** AsyncAPI valides (`asyncapi validate` ou lint équivalent)
référencées par les README de libs ; doc rétention publiée ; backoff testé.

> **MÀJ 2026-07-02 — 🔶 partiellement livré.** Le point (3) est réglé autrement que
> par l'esquisse : le rebinding à délai fixe a laissé place au **backoff progressif natif
> JetStream** (`ConsumerConfig.backoff` = 1 s/5 s/15 s/30 s + `max_deliver`,
> [jetstream.consumer.ts](../apps/svc-tarification/src/consumers/jetstream.consumer.ts)).
> Restent ouverts : (1) AsyncAPI par contexte, (2) doc de rétention des streams
> (seule la rétention Loki est documentée dans `observabilite.md`, pas celle de JetStream).

---

### AQ-15 — CI plus rapide · P3

**Constat.** `smoke-stack` puis `e2e-stack` font **chacun** un
`docker compose up --build` (~50 min cumulées dans le pire cas). Pas de cache de
layers Docker entre jobs. Les 5 apps n'ont pas de healthcheck compose (seule
l'infra en a), ce qui fragilise `--wait`.

**Implémentation.** Au choix après mesure (utiliser les durées historisées
d'AQ-06) : (a) paralléliser smoke-stack et e2e-stack (jobs frères, chacun sa
stack) ; (b) mutualiser : une seule stack montée, smoke puis E2E dessus ;
(c) cache buildx GHA (`cache-from/to: type=gha`) pour les builds d'images.
Ajouter des healthchecks aux 5 apps dans [docker-compose.yml](../docker-compose.yml)
(endpoint `/api/health` ou équivalent par service) — bénéficie aussi à
`deploy.mjs --wait` en prod.

**Critère de sortie.** Durée totale CI réduite d'au moins 30 % (mesurée avant/après
sur 3 runs) ; `up --wait` attend réellement la santé des apps.

> **MÀJ 2026-07-02 — 🔶 partiellement livré.** `smoke-stack` et `e2e-stack` sont
> désormais des **jobs frères parallèles** (mêmes `needs: [ci, pact-can-i-deploy,
affected-images]`) et `build-images` utilise le **cache buildx GHA**
> (`cache-from/to: type=gha` par projet). Restent : healthchecks compose des apps autres
> que la gateway (les `svc-*` et `web` n'en ont pas ; seuls l'infra et `api-gateway` en
> ont) et l'éventuelle mutualisation de pile entre smoke et e2e (chacun refait son
> `up --build`).

---

### AQ-16 — Hygiène documentaire & onboarding · P3

**Constat.** (1) Pas d'index de navigation : 35 docs sans « par où commencer ».
(2) Pas de `CONTRIBUTING.md` (les standards existent en doc 03 mais ne sont pas
référencés à l'endroit conventionnel). (3) [caddy-root.crt](../caddy-root.crt) à
la racine plutôt que dans `docker/` (cosmétique — attention : le chemin est
référencé par `deploy.mjs` et la doc 24). (4) README : étapes implicites
(`pnpm seed:demo` non mentionné, prérequis Docker Desktop pour `e2e:stack`,
flux de génération des types web). (5) Redondance partielle docs 05 (plan) / 06
(avancement).

**Implémentation.** Créer `docs/README.md` : index hiérarchisé par usage
(« comprendre le métier → 01/02 », « contribuer → 03 », « déployer → 24 + runbook »,
« reprendre le projet → 06 ») ; `.github/CONTRIBUTING.md` court renvoyant doc 03 +
template PR ; déplacer le certificat **en mettant à jour toutes les références**
(`grep -rn "caddy-root.crt" --include=*.{md,mjs,yml,yaml,sh}`) ; compléter le
README racine ; pour 05/06, choisir : bandeau « document historique, voir doc 06 »
en tête de la doc 05 (moins risqué qu'une fusion).

**Critère de sortie.** Index publié et lié depuis le README racine ; CONTRIBUTING
en place ; `node scripts/deploy.mjs DRY_RUN=1` (ou équivalent) passe après le
déplacement du certificat ; aucune référence cassée (`grep` final propre).

> **MÀJ 2026-07-02 — ✅ livrée, avec déviations assumées.** (1) Index
> [`docs/README.md`](README.md) (par thème + « par où commencer » + explication de
> la numérotation 24/28/29 rangée sous `exploitation/`), lié depuis le README
> racine. (2) `CONTRIBUTING.md` créé **à la racine** (plus visible que
> `.github/`). (5) Doc 05 marquée « document historique, la doc 06 fait foi ».
> **Non retenus** : (3) déplacement de `caddy-root.crt` — cosmétique, référencé
> par `deploy.mjs` et la doc 24, risque > bénéfice ; (4) la mise à jour de fond du
> README racine (état projet arrêté à la Phase 9, React 18, 4 services) est
> extraite en tâche dédiée.

---

### AQ-17 — Mineurs backend (timeouts, rate-limit) · P3

**Constat.** (1) Les `db.transaction()` Drizzle n'ont pas de timeout — une
transaction bloquée attendrait indéfiniment. (2) Le rate-limit du gateway est une
`Map` mémoire ([rate-limit.guard.ts:28](../apps/api-gateway/src/security/rate-limit.guard.ts)) :
correct en mono-instance (cas actuel), mais la limite n'est documentée nulle part.

**Implémentation.** (1) Vérifier l'API exacte de la version Drizzle utilisée pour
poser un timeout (ou `statement_timeout` côté pool pg) — ne pas inventer de flag.
(2) Commentaire en tête du guard + mention dans la doc 04 : « limite par instance,
à remplacer par un store partagé si réplication ».

**Critère de sortie.** Timeout effectif démontré par un test (transaction qui
dort > timeout → erreur) ; documentation à jour.

> **MÀJ 2026-07-02 — ouvert.** Aucun `statement_timeout`/timeout de transaction posé
> (vérifié : zéro occurrence dans le code). Le point (2) est en partie couvert : l'en-tête
> de [rate-limit.guard.ts](../apps/api-gateway/src/security/rate-limit.guard.ts) documente
> l'état **en mémoire, par instance** ; côté surveillance, l'alerte Prometheus
> `PostgresLongRunningTransaction` (`docker/prometheus/alerts.yml`) atténue le risque (1)
> sans le clore.

---

### AQ-18 — Lazy loading des routes web (optionnel) · P3

**Constat.** Toutes les pages sont importées statiquement dans
[App.tsx](../apps/web/src/App.tsx). Acceptable à 5 écrans ; à faire dès qu'un
écran lourd s'ajoute (déclencheur : plan « Factures réelles » et son OCR).

**Implémentation.** `React.lazy` + `<Suspense fallback={<Spinner/>}>` sur
`PlanningPage` et `CoutsAnnuelsPage` (FullCalendar est le plus gros morceau).
Mesurer avant/après avec `reportCompressedSize` du build Vite.

**Critère de sortie.** Bundle initial réduit (mesuré) ; navigation et tests E2E
inchangés ; pas de flash de spinner sur navigation rapide (tester).

---

## 4. Hors périmètre de ce plan — cap stratégique

La recommandation centrale de l'audit : **l'infrastructure est finie**. Elle est
au-dessus du besoin mono-foyer pour longtemps (choix pédagogique assumé,
ADR-0001) ; continuer à y investir au-delà du présent plan serait du
sur-polissage. Une fois les sessions A-F réalisées (le reste est opportuniste),
l'effort doit basculer sur la **valeur utilisateur** :

1. **Plan « Factures réelles »** (prochaine phase produit, déjà pressentie) :
   rapprochement prévu/facturé, levée de l'hypothèse Q-11 (carence 48 h ABCM,
   doc 02 §10) sur facture réelle, crédit d'impôt (logique calculable depuis les
   coûts, présentation absente). À spécifier dans une **doc 28** dédiée avant
   toute implémentation (convention du dépôt : la spec précède le code).
2. **Restes opérationnels connus** (hors audit, suivis ailleurs) : import du CA
   Caddy sur les postes LAN, suppression des 2 backups ufw orphelins, révocation
   du token API Cloudflare (doc 24 / mémoire de session).

---

## 5. Suivi

Cocher ici au fil des sessions (convention doc 25 : ✅ dans le tableau §1 +
mention de la PR).

| Session | Branche                           | Actions     | PR                                                             | État                                                              |
| ------- | --------------------------------- | ----------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| A       | `fix/audit-quickwins-backend`     | AQ-01/03/04 | #40 (privée)¹                                                  | ✅ Fait (2026-06-11)                                              |
| B       | `ci/pact-drift-check`             | AQ-02       | #39 (privée)¹                                                  | ✅ Fait (2026-06-11)                                              |
| C       | `fix/web-a11y-annonces`           | AQ-05/12    | #41 (privée)¹                                                  | ✅ Fait (2026-06-11)                                              |
| D       | `ci/metriques-historisees`        | AQ-06/11    | #42 (privée)¹                                                  | ✅ Fait (2026-06-12)                                              |
| E       | `refactor/nest-commons`           | AQ-07       | #43 (privée)¹                                                  | ✅ Fait (2026-06-12)                                              |
| F       | `test/services-foyer-referentiel` | AQ-08/09    | #45 (privée)¹                                                  | ✅ Fait (2026-06-12)                                              |
| G       | `feat/web-types-openapi`          | AQ-10       | #46 (privée)¹                                                  | ✅ Fait (2026-06-12)                                              |
| H       | `test/mutation-stryker`           | AQ-13       | #48 (privée)¹                                                  | ✅ Fait (2026-06-12)                                              |
| I       | `docs/asyncapi-nats`              | AQ-14       | —                                                              | 🔶 Partiel (backoff livré ; AsyncAPI + rétention à faire)         |
| J       | `ci/pipeline-parallele`           | AQ-15       | —                                                              | 🔶 Partiel (parallélisation + cache faits ; healthchecks à faire) |
| K       | `docs/index-et-contributing`      | AQ-16       | [#143](https://github.com/EdouardZemb/creche-planner/pull/143) | ✅ Fait (2026-07-02)                                              |
| —       | (opportuniste)                    | AQ-17/18    | —                                                              | Ouvert / optionnel                                                |

> ¹ **PR de l'ancien dépôt privé** : ces sessions ont été mergées **avant la publication
> du dépôt** (2026-06-18). L'historique a été squashé dans l'import initial public
> `4f36e3e` : ces numéros ne correspondent à **aucune PR du dépôt public actuel** (les
> #39→#48 publics portent sur d'autres sujets — p. ex. le #40 public est une PR de
> roadmap CI/CD). La preuve du « fait » est le **code lui-même**, re-vérifié le
> 2026-07-02 (encart §1).
