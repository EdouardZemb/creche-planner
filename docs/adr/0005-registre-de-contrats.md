# ADR-0005 — Registre de contrats : pacts fichiers + garde `can-i-deploy`

- **Statut** : Accepté
- **Date** : 2026-06-04
- **Décideurs** : Propriétaire du produit (utilisateur)
- **Contexte amont** : [ADR-0001](0001-architecture-microservices.md) (microservices stricts),
  [ADR-0004](0004-decentralisation-des-contrats.md) (décentralisation des contrats)
- **Déclencheur** : [spec 09](../09-spec-decouplage-microservices.md) DEC-06 (registre de
  contrats) et le LOT D de la [doc 10](../10-plan-implementation-decouplage.md) (livraison
  indépendante & registre de contrats).

## Contexte

La compatibilité de contrat HTTP entre la gateway (BFF, **consommateur**) et les quatre services
métier (**providers** `svc-foyer`, `svc-referentiel`, `svc-planification`, `svc-tarification`) est
décrite par des pacts **commités à plat** dans `/pacts/*.json`, générés par les specs consommateur
et **rejoués** par les specs provider (`*.provider.pact.spec.ts`) du job CI `ci` (avec ses quatre
bases Postgres éphémères). Cette vérification provider **prouve déjà** que chaque provider honore
le pact attendu.

La spec DEC-06 demande d'aller plus loin : remplacer les pacts à plat par une vérification de
**compatibilité au déploiement** (« puis-je déployer ? »), idéalement via un **Pact Broker** qui
publie les pacts, conserve la matrice des versions déployées par environnement et répond à la
question `can-i-deploy` avant une mise en production.

Or un Pact Broker réel est un **service serveur** (base PostgreSQL dédiée + application web Pact
Broker) qui doit être hébergé et joignable depuis la CI et les développeurs. Dans le contexte de
ce projet — mono-utilisateur, **développé et exécuté hors-ligne/local**, sans infrastructure de
service partagée provisionnée ni budget d'hébergement — déployer et maintenir un broker serveur
serait **disproportionné** et introduirait une dépendance d'infrastructure indisponible dans
l'environnement cible. La spec DEC-06/CA1 prévoit explicitement cette issue : « à défaut, un
**ADR documente** le choix de rester en pacts fichiers avec ses limites ».

## Décision

**1. Rester en pacts fichiers.** Les pacts demeurent **commités** dans `/pacts/*.json` et restent
la source de vérité du contrat HTTP gateway↔services. Ils sont régénérés par les tests consommateur
et vérifiés par les tests provider du job CI `ci` (preuve de non-régression).

**2. Ajouter une garde `can-i-deploy` surrogate, en pacts fichiers.** Le script
[`.github/workflows/scripts/can-i-deploy.mjs`](../../.github/workflows/scripts/can-i-deploy.mjs)
(Node pur, sans dépendance) joue le rôle de la question « puis-je déployer ? » que le job `ci` ne
couvre pas : il vérifie, **avant toute construction d'image**, que la **matrice de contrats
attendue** est complète et cohérente. Il échoue (et **bloque** le pipeline) si :

- un pact attendu pour une paire `api-gateway → provider` est **manquant** ;
- un fichier pact référence un **consommateur ou un provider inconnu** ;
- un pact est **vide** (aucune interaction) ou son JSON est **invalide**.

**3. Intégrer la garde à la CI en amont de la livraison.** Le job `pact-can-i-deploy`
([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) exécute ce script ; il **précède**
les jobs `affected-images` puis `build-images` (image par service). Aucune image n'est construite
si la matrice de contrats est incomplète ou incohérente. La vérification provider (le job `ci`) et
la garde de complétude (`pact-can-i-deploy`) sont **complémentaires** : la première prouve qu'un
provider honore son contrat, la seconde prouve qu'aucun contrat attendu ne manque avant de livrer.

## Statu quo conservé (non-décisions assumées)

- **Pas de Pact Broker serveur** : décision explicitement reportée tant qu'il n'existe pas
  d'environnement de déploiement réel multi-environnements justifiant l'infrastructure.
- **Pas de publication d'images vers un registre** : les jobs `build-images` construisent et
  taguent les images (`push: false`) pour **prouver** la déployabilité par service ; le branchement
  d'un registre est hors périmètre de cette décision.

## Conséquences

**Bénéfices :**

- La question « puis-je déployer ? » est posée **en CI**, de façon **bloquante**, sans
  infrastructure serveur ni dépendance npm.
- La garde détecte un **trou de contrat** (paire manquante) ou un pact corrompu **avant** la
  construction d'images, là où la seule vérification provider ne le ferait pas (un provider
  silencieusement non couvert resterait invisible).
- Réversible et incrémental : le passage ultérieur à un vrai Pact Broker remplacerait ce script
  par `pact-broker publish` + `pact-broker can-i-deploy` sans changer le reste du pipeline.

**Limites assumées (vs un vrai broker) :**

- Pas de **matrice de versions déployées** : le script ne sait pas quelle version d'un consommateur
  est compatible avec quelle version d'un provider déjà en production ; il valide la **présence et
  la cohérence** des contrats, pas leur compatibilité **version-à-version** dans un environnement.
- Pas de **tags d'environnement** (`test`, `prod`) ni de notion de « dernière version vérifiée
  déployée ».
- Pas d'**historique de `verificationResults`** ni de webhooks ; la liste des providers attendus
  est **codée en dur** dans le script (`PROVIDERS_ATTENDUS`) et doit être tenue à jour
  manuellement si un service consommé par la gateway est ajouté ou retiré.
- La compatibilité **version-à-version réelle** reste portée par les tests provider du job `ci`
  (rejeu des pacts), pas par cette garde.

## Révision

Réversible. Le jour où un environnement de déploiement réel est introduit, on provisionne un Pact
Broker (conteneur + Postgres), on remplace le script `can-i-deploy.mjs` par les commandes
`pact-broker` et on étend la matrice de contrats par environnement. La structure du pipeline
(verif provider → garde de compatibilité → image par service) reste inchangée.
