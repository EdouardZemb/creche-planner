# Plan — mise à niveau standards industriels (revue 2026-08)

> Source : revue standards du 2026-08-10 (session distante, branche
> `claude/industrial-standards-review-cejjwq`). Constats consignés en
> `AM-33` → `AM-51` + `LE-29` ([doc 34](../../docs/34-registre-ameliorations.md)) ;
> veille pérennisée en [doc 36](../../docs/36-veille-standards.md).
> Ce plan est la source de vérité du découpage en lots. Chaque lot suit le rituel
> `/executer-lot` (constat négatif d'abord : re-vérifier l'énoncé contre le code du
> moment — les lignes citées ici datent du 2026-08-10).

## Ordre retenu et raison

Le RGPD d'abord (seule famille où l'écart est une obligation, pas un choix), mais son
lot documentaire demande des décisions PO — il se prépare en parallèle des lots
techniques, qui n'attendent rien.

## Lot 0 — quick wins (✅ livré avec la revue, même PR)

- `AM-42` backoff exponentiel + jitter + discrimination 4xx (`libs/resilience`).
- `AM-43` HSTS + garde des en-têtes (`apps/web/src/nginx-headers.spec.ts`), négatif joué.
- `AM-38` `Retry-After` sur le 429 de la gateway.
- `AM-51` veille standards (doc 36 + rituel doc 34 §7).

## Lot 1 — RGPD documentaire (`AM-33`, `AM-36` volet décisions, `AM-46`) ✅ LIVRÉ

**Fait le 2026-08-11 — PR #312**, branche `feat/rgpd-lot1-registre-et-mentions`.

**Décision PO d'entrée, qui recadre tout le reste : l'exemption domestique de
l'art. 2(2)(c) est ASSUMÉE** ([ADR-0007](../../docs/adr/0007-exemption-domestique-et-demarche-volontaire.md)).
Les livrables sont tenus en **démarche volontaire** ; le dépôt ne revendique aucune
conformité. Cela clôt la contradiction que ce plan avait avec
`amelioration-2026-07-pistes.md`. L'ADR énonce les 4 seuils qui rouvriraient la
question (plus d'un foyer, accès direct d'un établissement, cadre associatif, donnée
de santé réelle).

Livré : [doc 37](../../docs/37-registre-des-traitements.md) (8 traitements, 8 tiers
classés par exposition réelle, durées par catégorie), RPO 24 h / RTO 24 h + écarts
dans `sauvegardes.md` §10, page publique `/mentions` + pied de page permanent, et
**pied d'information sur les deux courriels sortants**.

**Trois écarts à l'énoncé, constatés contre le code :**

1. L'énoncé disait « art. 13 » ; c'est **aussi l'art. 14** — l'agent d'établissement
   et les enfants n'ouvrent jamais l'application, la collecte les concernant est
   indirecte. La page web seule ne les informe jamais → pied de courriel ajouté.
2. L'inventaire des tiers de l'`AM-33` était **incomplet (4 manquants) et mal
   hiérarchisé** : Cloudflare voit tout en clair, Google Drive ne voit que du chiffré.
3. `AM-36` disait « un foyer parti reste en base » ; en fait **un foyer ne peut pas
   partir** — les durées s'ancrent donc sur un fait observable aujourd'hui.

Reste ouvert : `AM-36` (volet outillage → lot 2) et `AM-52` (surveillance des
sauvegardes, préalable à tout resserrement du RPO).

## Lot 2 — droit à l'effacement et purge (`AM-34`, `AM-36` volet outillage)

**Écart assumé au découpage initial : le lot 2 est scindé en 2a et 2b.** Les deux moitiés
n'ont aucune dépendance l'une envers l'autre et ne portent pas le même risque — l'une
touche cinq services et un écran, l'autre pose une tâche périodique dans une lib partagée.
Les relire ensemble aurait noyé la seconde.

### Lot 2a — effacement à la demande ✅ LIVRÉ

**Fait le 2026-08-12**, branche `feat/rgpd-lot2-effacement-foyer`.

`DELETE /api/v1/foyers/:id` (garde `@FoyerScope`) → cascade SQL côté `svc-foyer` →
événement `foyer.FoyerSupprime.v1` → effacement des copies dans `svc-tarification`,
`svc-notifications` et `svc-planification`. Zone de danger dans « Ma famille », avec mot
de confirmation à recopier. Page `/mentions` remise en accord avec ce qui est outillé.

**Quatre écarts à l'énoncé, constatés contre le code :**

1. L'énoncé disait « les événements `.v1` et les read models aval portent des copies ».
   C'est vrai, mais il manquait le principal : **`dead_letter` aussi**, et en clair.
   Les abonnements sont posés sur `foyer.>` sans `filter_subject`, donc tout événement
   qu'un service ne consomme pas y atterrit avec son payload — `svc-planification` ne
   traite qu'`EnfantModifie`, il archive donc tous les revenus et tous les e-mails depuis
   la mise en production. L'effacement purge cette table ; la cause racine est `AM-53`.
2. `outbox` n'est **pas** purgée, délibérément : c'est une file de publication vivante,
   pas un magasin — l'événement d'effacement lui-même y transite. Sa borne est
   temporelle (lot 2b). Idem `processed_event`, que doc 37 §3 exclut nommément.
3. La « purge différée des parents soft-delete » de l'énoncé se révèle **déjà couverte
   pour le cas qui compte** : effacer un foyer emporte ses parents retirés. Ce qui reste
   est le retrait d'un parent **seul**, qui conserve nom et e-mail — hors périmètre ici,
   parce que sa réactivation par e-mail en dépend (`ajouterParent` ressuscite la ligne
   inactive) : le supprimer changerait un comportement métier, ce n'est pas de l'hygiène.
4. Le composant partagé `Modale` s'est révélé cassé pour tout champ de saisie (`LE-31`) :
   corrigé ici, parce que la confirmation du lot ne pouvait pas fonctionner autrement.

### Lot 2b — bornes temporelles (`AM-36` volet outillage, `AM-01`, `AM-03`) ✅ LIVRÉ

**Fait le 2026-08-12**, branche `feat/rgpd-lot2b-bornes-temporelles`.

`PurgeModule` dans `libs/nest-commons` : patron maison `setInterval` + garde de réentrance,
horloge **remontée dans la lib** (`CLOCK`, jusque-là locale à `svc-notifications` — le patron
partagé était justement celui qui appelait `new Date()` en dur), compteurs OTel, une tâche
isolée par `try`. Neuf bornes dans les cinq services, chacune avec son index posé **dans la
même migration**. Les deux tables techniques (`outbox`, `dead_letter`) sont bornées **dans la
lib** : leur prédicat n'existe qu'à un seul endroit, et un nouveau service en hérite.

**Cinq écarts à l'énoncé, constatés contre le code :**

1. **Deux des huit durées de doc 37 §3 étaient fausses, pas difficiles.** T1 ancrait la
   rétention sur la « date d'effet de la version » : or la **fin** d'une version n'existe pas
   en base, elle est dérivée à la lecture et la dernière reste ouverte — la version **en
   vigueur** d'un foyer inactif tombe sous la borne, et l'aval ne plante pas, il **facture
   faux en silence**. T3bis demandait de purger la preuve d'un désabonnement dont la
   disparition **vaut réabonnement**. Elles sont **corrigées** en doc 37 v1.1 (`AM-55`,
   `AM-57`), et la porte `pnpm retentions` refuse désormais une durée dont la colonne
   n'existe pas — motif `MO-2` à sa troisième occurrence, donc une porte et non une leçon.
2. **`envoi_etablissement` est anonymisée en place, pas purgée.** Cette ligne est le seul
   verrou anti-double-envoi vers une vraie crèche, et l'endpoint d'envoi n'est borné par
   aucune date (`AM-58`) : la supprimer rouvrait un second courriel réel. Le contenu part,
   la ligne-témoin reste.
3. **`notification_hebdo` écartée** : doc 37 la rangeait avec la boîte de réception au motif
   qu'elle serait « un journal en ajout seul ». Le code ne dit cela que de `notification` —
   c'est la machine à états de la validation, et rien ne ferme une semaine `A_VALIDER`
   (`AM-59`).
4. **`correction_journal` écartée** : la table ne porte aucune date d'effet, et sa colonne
   d'ancrage n'a même pas le même nom dans les deux services (`AM-60`). `AM-03` n'est donc
   soldée que pour `dead_letter`.
5. **`desabonnement_token` ajoutée**, absente de l'énoncé : c'est la seule trace survivante de
   l'exercice du droit d'opposition, et la borne dérive son écart au TTL depuis la
   configuration au lieu de le recopier.

Le préalable `processed_event` reste entier : toujours aucun `max_age` JetStream.

## Lot 3 — portabilité (`AM-35`) ✅ LIVRÉ

**Fait le 2026-08-12**, branche `feat/rgpd-lot3-portabilite-export`.

`GET /api/v1/foyers/:id/export` (garde `@FoyerScope`) agrège **trois** services sources —
un module `portabilite` par service, même découpage que la cascade d'effacement du lot 2a —
en un document JSON à trois sections nommées pour la personne, pas pour l'architecture
(`situationFoyer`, `gardeEtPlanning`, `communications`). Téléchargement depuis « Ma
famille », au-dessus de la zone de danger. Porte `pnpm portabilite` + inventaire des
**46 tables** en [doc 37 §6](../../docs/37-registre-des-traitements.md).

L'énoncé annonçait un « petit lot ». Il l'était pour la route ; il ne l'était pas pour la
question à laquelle la route oblige à répondre : _laquelle des 46 tables sort, laquelle
n'a pas à sortir, et qui le garantit demain ?_

**Six écarts à l'énoncé, constatés contre le code :**

1. **Les préférences de notification sont exportées EFFECTIVES, pas telles qu'en base.**
   Dans `preference_notification`, l'absence de ligne **vaut consentement** (défaut
   applicatif). Exporter les seules lignes stockées aurait livré les **écarts au défaut**
   en les présentant comme l'état complet — une donnée fausse, produite par un export
   littéralement correct. On réutilise `fusionnerDefauts`, la primitive de « Mon profil ».
2. **Le `jti` d'un jeton de désabonnement n'est pas exporté.** Ce jeton est une
   **capacité** : il désabonne sans authentification. Recopié dans un fichier qui circule,
   il resterait actionnable par quiconque le lit. La trace part (type, canal, dates), le
   secret reste. Sondé : le `jti` n'apparaît nulle part dans le document.
3. **Aucune dégradation gracieuse**, contrairement au reste de la passerelle. Ailleurs un
   amont muet fait perdre un enrichissement ; ici il ferait livrer un export **amputé sans
   le dire**. Les trois appels sont dans un seul `relayer` : soit les trois répondent, soit
   l'export échoue.
4. **`svc-tarification` n'est pas interrogé** : ses 5 tables sont des copies projetées.
   La règle ne vaut que dans un sens — là où la copie porte **moins** que sa source
   (`etablissement` et ses coordonnées, qui ne voyagent dans aucun événement), c'est la
   **source** qui est lue.
5. **Les colonnes ne sont pas contractées, les sections le sont.** Décrire les ~60 colonnes
   dans l'OpenAPI en aurait fait une troisième copie (table, interface de service,
   contrat) que rien n'aurait gardée alignée. Ce que la passerelle contracte, c'est la
   **présence de chaque section** : un service qui cesserait d'en rendre une fait échouer
   l'export au lieu d'en livrer un tronqué.
6. **La primitive de téléchargement a été remontée** de `couts/export.ts` vers
   `utils/telechargement.ts` : l'export de portabilité était le second usage, et recopier
   la danse `Blob` → ancre → `revokeObjectURL` aurait été un miroir.

## Lot 4 — erreurs RFC 9457 (`AM-37`) ✅ LIVRÉ

**Fait le 2026-08-12**, branche `feat/standards-lot4-problem-json`.

`ProblemeFilter` global à la passerelle : toute erreur part désormais en
`application/problem+json`, membres RFC 9457 plus deux extensions que le produit utilise
réellement (`code` métier, `erreurs` par champ). Le contrat et le registre des quatre codes
vivent dans [`contracts-kernel/dto/probleme.ts`](../../libs/contracts/kernel/src/lib/dto/probleme.ts) ;
les **50** réponses d'erreur du document OpenAPI décrivent enfin un corps. Porte
`pnpm problemes` (4 sondes) + appariement des exemptions dans `openapi.couverture.spec.ts`.

L'énoncé promettait une traversée « contrat par contrat » pour ne casser ni les pacts ni
l'UI. **Aucun pact n'a été touché, et la traversée n'a pas eu lieu** — non parce que le
danger était imaginaire, mais parce que la conception l'a dissous (écart 1).

**Cinq écarts à l'énoncé, constatés contre le code :**

1. **Traduire au bord supprime le couplage que la traversée devait contourner** (`LE-40`).
   La forme `{statusCode, code, message}` n'était contractuelle **que parce que** `relayer`
   republiait le corps amont **tel quel** : le contrat interne était devenu le contrat
   public. Le filtre traduit — les pacts continuent de décrire le 409 interne, inchangés,
   pendant que le navigateur reçoit un problème. Corollaire : les services gardent leurs
   quatre formes entre eux (`AM-70`), et le critère d'`AM-37` disait bien « à la gateway ».
2. **Le vrai défaut n'était pas le nombre de formats, mais qu'aucune ne soit celle attendue**
   (`AN-21`). Le front lisait un **tableau à la racine** que la passerelle n'a jamais émis :
   `BadRequestException([{champ,message}])` l'enveloppe. **Aucune erreur par champ n'a jamais
   atteint un écran**, sur les huit formulaires qui en dépendent — et sept tests verts
   l'affirmaient, chacun fabriquant son corps à la main (`LE-39`).
3. **Le document OpenAPI ne décrivait aucun corps d'erreur** — 50 réponses, 50 fois rien.
   Le schéma est attaché par **dérivation** (`avecProblemes`) et non recopié 50 fois ; la
   règle « une réponse qui porte déjà de la donnée garde la sienne » exempte le 503 de
   `/api/health` **sans avoir à le nommer**, et se voit dans `openapi-types.gen.ts`.
4. **Le format unifié ne suffit pas à unifier le contenu** (`AM-69`). `capturerCorpsErreur`
   est opt-in et seuls `foyer` et `referentiel` le posent : sur les routes servies par les
   trois autres clients, le `code` et les erreurs par champ des services n'atteignent même
   pas la passerelle. Hors périmètre ici — c'est un changement de comportement sur ~20
   routes, pas de la mise en forme.
5. **Le seul endroit qui prouve le format est le test E2E API.** Aucune spec unitaire ne
   peut montrer que le `Content-Type` survit à `res.json()` d'Express (qui pose
   `application/json` si personne ne l'a devancé) : l'assertion vit sur le bundle réel.

## Lot 5 — validation d'environnement (`AM-44`) ✅ LIVRÉ

**Fait le 2026-08-12**, branche `feat/standards-lot5-validation-environnement`.

Une **trousse partagée** (`libs/nest-commons/src/lib/config/env.ts` : `champEnv`,
`lireEnv`, `RegleProduction`) déclarée par un `CHAMPS_ENV` dans chacun des six
`config.ts` ; `loadConfig()` valide ce qu'il lit, et `main.ts` l'appelle avant de rien
monter. Porte `pnpm environnement` (6 sondes) + refus prouvé sur le **bundle réel**
(`refus-config.e2e.spec.ts`, gateway et notifications).

L'énoncé demandait « un schéma zod unique **par app** ». Il y en a un par app —
mais la **règle de lecture** est partagée, et c'est le seul écart qui compte.

**Six écarts à l'énoncé, constatés contre le code :**

1. **Six schémas indépendants auraient été six miroirs** (`LE-40`). `PORT` est lu six
   fois, `DATABASE_URL`/`NATS_URL`/`ASSERTION_IDENTITE_SECRET` cinq fois, les URL amont
   dans trois services chacune. Ce qui se partage n'est pas le _nom_ mais ce qui compte
   comme un entier, comme absent, et ce qu'on ose citer dans un refus — recopié six
   fois, cela divergerait, et c'est exactement ainsi qu'`AN-20` est né. Ce qui reste
   local est la **déclaration**.
2. **Il y avait trois `verifierConfigProduction()` homonymes, pas deux** (gateway,
   `svc-foyer`, `svc-notifications`) ; aucune au registre `MIROIRS`, et **trois services
   sans aucun garde-fou**. Elles deviennent des `RegleProduction` nommées portées par la
   déclaration : il n'y a plus de garde qu'un `main.ts` puisse oublier d'appeler.
3. **Le défaut coûtait déjà plus que le `NaN` sur `PORT` annoncé.** `RATE_LIMIT_MAX=cent`
   donnait `NaN`, et `recents.length >= NaN` est **toujours faux** : le rate-limit était
   désactivé en silence. Et **trois specs affirmaient le `NaN` de `PORT`**, motivé en
   commentaire (`LE-41`) : le défaut n'était pas ignoré, il avait rang de contrat.
4. **`estUrlEmailPublique` reste une règle métier explicite**, pas un `z.url()` : la
   validation de forme accepterait `https://192.168.1.129`, et les liens d'e-mail
   seraient injoignables hors-LAN. Sondée sur le bundle réel (piège `MO-2` désamorcé).
5. **Le repli fail-safe de `RATE_LIMIT_PROXY_HOPS` disparaît** : `0` sur valeur illisible
   était sûr côté confiance, mais rouvrait `AN-15` sans le dire (fenêtre de rate-limit
   unique partagée). Une valeur qu'on ne sait pas lire est une panne de configuration.
6. **`AM-30` est rendue visible, pas fermée** : les quatre bascules fail-open sont
   déclarées nommément avec leur défaut. Les fermer est un geste d'exploitation.

**Ce que la porte a trouvé en naissant** : `INTERSERVICE_AUTHZ_ENFORCE` était posée sur
`api-gateway` dans `docker-compose.server.yml`. La passerelle **signe** les assertions,
elle ne les vérifie jamais — la ligne était inerte, mais laissait croire que basculer
l'enforce (geste PO du chantier fondations) se règle sur la passerelle. Retirée.

Consigné : `AM-44` ✅, `AM-71`/`AM-72` ouvertes, `LE-41`/`LE-42`, `EM-12`.

## Lot 6 — piste d'audit acteur (`AM-45`) ✅ LIVRÉ

**Fait le 2026-08-14**, branche `feat/standards-lot6-piste-audit-acteur`.

Table `journal_audit` dans `svc-foyer` (ajout seul, rattachée au foyer), écrite dans la
**transaction de la mutation** pour les dix routes de mutation du dossier — ressources,
enfants, parents, préférences. L'acteur arrive par un **paramètre explicite**
(`@ActeurCourant()`, `libs/nest-commons`) tiré de l'assertion HMAC déjà vérifiée. La
piste sort dans l'**export de portabilité** (c'est le sens donné à « consultable »), et
se borne à 3 ans (doc 37 §3, T9, avec sa tâche de purge).

**Trois écarts à l'énoncé, constatés contre le code :**

1. **« Colonne acteur » était impossible pour la moitié du périmètre** (`LE-47`). Les
   suppressions sont des mutations sensibles à part entière — `retirerEnfant` est un
   `DELETE` réel, et le **retrait d'un parent est la révocation de l'accès d'une
   personne au foyer**. Une colonne disparaît avec sa ligne, ou perd son sens avec le
   soft-delete. D'où un journal en ajout seul, et non des colonnes éparpillées.
2. **Une action ne peut pas être tracée du tout, et il fallait le trouver avant de
   l'écrire** : l'effacement du foyer. La table part en `ON DELETE CASCADE` avec lui —
   insérée avant, la ligne est emportée ; après, elle viole la clé étrangère. Le journal
   applicatif (T5) est le seul lieu où cette action survit. C'est la classe
   « journal seul » du §7, et elle n'a qu'un membre.
3. **L'acteur est un paramètre, pas un `AsyncLocalStorage`.** La passerelle n'a pas le
   choix (ses clients sont des singletons) ; ici le chemin est direct, et un paramètre
   est **constatable de l'extérieur** — c'est ce qui permet à la porte d'exiger
   `@ActeurCourant()` sur le handler de toute route déclarée auditée.

**Ce que le lot a vraiment trouvé, au-delà de l'énoncé** : la section d'export ajoutée
côté service aurait été **silencieusement effacée** du document téléchargé. Le client de
la passerelle valide par un `z.object`, qui strippe les clés inconnues, et `pnpm
portabilite` s'arrête au service — son périmètre déclaré était exact, la chaîne est plus
longue que lui (`LE-48` → `MO-1`, remède en `AM-78`).

**Décision de conception à retenir : on écrit la ligne même sans acteur.** Tant que
`INTERSERVICE_AUTHZ_ENFORCE` reste à 0, une requête sans assertion valide mute quand
même. Ne rien écrire rendrait la piste indiscernable d'une piste vide ; on écrit donc
`acteur_type = 'inconnu'`, et le compteur `foyer_audit_actions_total{acteur="inconnu"}`
devient l'indicateur de la bascule enforce — même lecture que
`gateway_authz_refus_total` pour l'appartenance foyer.

Porte **`pnpm acteur`** (5 sondes `--autotest` + 2 négatifs réels joués à la main) : les
30 routes de mutation des cinq services sont classées au §7 de doc 37, une route auditée
nomme une action réellement consignée **et** reçoit son acteur, une action déclarée que
plus personne ne nomme est morte, et un report `différée` doit nommer une piste
**encore ouverte** — fermer `AM-76` sans auditer `svc-planification` fait rougir la CI.

Consigné : `AM-45` ✅, `AM-76`/`AM-77` (extension aux deux autres services),
`AM-78` (traversée passerelle), `LE-47`, `LE-48`.

## Lot 7 — sémantique HTTP restante (`AM-39`, `AM-40`, `AM-41`) — ✅ livré 2026-08-14

L'énoncé prévoyait un traitement « opportuniste, quand un lot fonctionnel touche les routes
concernées ». Il a été traité d'un bloc, parce que le périmètre s'est avéré **plus petit
qu'annoncé sur deux des trois pistes et plus grand sur la troisième** :

- **`AM-39` — outillée.** Le décompte d'entrée était faux : Nest pose un 201 **par défaut**
  sur tout `@Post`, l'univers réel est donc les **treize `@Post` du BFF**, pas les trois
  `@HttpCode(CREATED)` écrits. Deux d'entre eux répondaient 201 en promettant 200 au
  contrat, sans rien créer. `Location` posé sur les **cinq** créations qui exposent une URI
  (chemin **dérivé** de l'URL de requête, référence relative), cinq autres 201 laissées sans
  `Location` avec leur raison — dont `POST /contrats/{id}/versions`, qui crée une version
  mais rend le **contrat** : l'identifiant créé ne quitte jamais `svc-planification`.
  Garde : `openapi.couverture.spec.ts` confronte le statut de succès dérivé des métadonnées
  Nest et l'en-tête `Location` au contrat, dans les deux sens (3 sondes négatives jouées).
- **`AM-40` et `AM-41` — écart et renoncement écrits**, [ADR-0008](../../docs/adr/0008-ecarts-semantique-http-pagination-et-concurrence.md).
  Les déclencheurs de réouverture sont, pour deux d'entre eux, **mot pour mot les seuils de
  l'ADR-0007** : ce qui ferait tomber l'exemption domestique est aussi ce qui ferait
  apparaître des collections longues et des écrivains qui ne se parlent pas.
  ⚠️ La prémisse d'`AM-41` ne tenait pas : `foyer_version` est un versionnement **temporel**
  (une ligne par date d'effet), pas un numéro de révision — deux saisies à la même date
  écrasent la même ligne. Et « en silence » est faux là où la perte coûte le plus.

Consigné : `AM-39`/`AM-40`/`AM-41` ✅, `LE-49`, `AM-80`.

## Lot 8 — durcissements ops (`AM-47` ⏸, `AM-48`, `AM-50`) — ✅ livré 2026-08-15

Deux des trois axes sont soldés ; le troisième reste à la décision du PO. Les deux traités
avaient un énoncé qui **désignait le mauvais endroit**, chacun à sa façon.

- **`AM-48` — outillée.** Le durcissement est posé dans le compose de **base**, pas dans
  l'override de production comme le demandait le critère de sortie : les trois piles le
  fusionnent, donc la posture est la même partout **et** elle est exercée par `smoke-stack`
  et `e2e-stack` à chaque PR. Posée côté serveur, elle n'aurait été éprouvée qu'en
  déployant. 29 services en `no-new-privileges` + `cap_drop: [ALL]`, 26 en `read_only`
  à la livraison du lot puis **29 sur 29** (les 3 exemptions sont tombées avec `AM-83`,
  le 2026-08-15, volume nommé posé), 6 services
  reprenant une capacité nommée. ⚠️ Le `user: 1000` que le `Dockerfile` et le doc 06
  annonçaient « porté par le compose serveur » n'a **jamais existé** : défense en profondeur
  écrite, absente — les deux mentions sont corrigées.
  **Ce que le lot a vraiment trouvé : un durcissement peut passer le premier boot et tuer
  tous les suivants** (`LE-53`). Le jeu de capacités minimal de Postgres démarre sur un
  volume vide et meurt au second boot, quand les données existent en `0700` pour l'uid 70.
  Les deux jobs de pile de la CI lèvent des piles **neuves** : ils auraient été verts sur un
  compose qui casse la production au premier redémarrage. D'où le protocole de vérification
  du lot : `up --wait`, **puis redémarrage complet**, puis smoke.
  Porte : **`pnpm conteneurs`** (6 sondes), périmètre déclaré au registre §5.
- **`AM-50` — outillée, mais pas dans `.npmrc`.** Depuis la version 10.16 de pnpm les réglages pnpm se
  lisent dans `pnpm-workspace.yaml` ; posée où l'énoncé la demandait, la ligne aurait été
  **ignorée sans message** (`LE-54`, mesuré : 350 jours de délai en `.npmrc` laissent
  résoudre une version publiée depuis 318 jours). Délai posé à 4320 min (3 j), **accordé au
  `cooldown.default-days` de Dependabot**, désormais écrit en clair. Impact instruit par la
  mesure : `--frozen-lockfile` n'est pas concerné (CI et images Docker inchangées), et pnpm 10
  n'échoue jamais — il se rabat en silence sur une autre version. C'est donc une mesure
  d'hygiène, pas une garde, et c'est écrit comme telle.
  Porte : **`pnpm quarantaine`** (5 sondes).
- **`AM-47` — toujours ⏸, non ouverte.** SPF/DKIM/DMARC supposent un **domaine d'envoi** ; les
  courriels partent aujourd'hui d'un compte Gmail personnel. Le geste est une décision PO
  (rester sur Gmail, ou prendre un domaine), et les enregistrements DNS vivent hors du dépôt.

**Trouvé en lisant les checks de la PR elle-même :** les trois jobs de pile étaient **`skipping`** — ils ne se déclenchent que si `nx affected` trouve un projet déployable touché, et un diff purement Compose n'en touche aucun. La pile n'était donc **jamais bootée par les PR qui changent la pile**, et le commentaire de `config-changes` décrivait ce trou mot pour mot depuis sa création (`LE-55`). Corrigé par un filtre de chemins `pile`.

Consigné : `AM-48`/`AM-50` ✅, `AM-82`/`AM-83`, `LE-53` et `LE-55` (→ `MO-1`), `LE-54` (→ `MO-2`), `EM-14`.

**Suite immédiate — `AM-82` et `AM-83` soldées le 2026-08-15 (décisions PO), hors lot.** Les
trois états d'infrastructure ont leur volume nommé (`nats-data`, `prometheus-data`,
`alertmanager-data`), et les **trois exemptions de racine inscriptible sont tombées** :
29/29 services en lecture seule. Motif PO : la semaine d'observation qui précède la bascule
INTERSERVICE exige une TSDB qui survive aux déploiements. Le plugin Grafana Infinity est
installé par `GF_PLUGINS_PREINSTALL` **dans le compose de base**, version épinglée sur celle
que la production porte (`3.11.1`). ⚠️ **Les deux énoncés étaient partiellement faux, et
c'est le résultat principal** (`LE-56`) : `GF_INSTALL_PLUGINS` n'était pas inerte (le lot 8
avait lu un répertoire de plugins **trop tôt** — l'installation est asynchrone) et la
production avait bien son plugin ; côté volumes, Prometheus et Alertmanager avaient depuis
toujours un volume **anonyme** hérité de leur image, ce qui rendait leur exemption de
`read_only` infondée. Nouvelles pistes : `AM-84` (personne ne surveille la version épinglée
du plugin), `AM-85` (le durcissement fait échouer la mise à jour des plugins embarqués de
Grafana à chaque démarrage).

## Lot 9 — WCAG 2.2 (`AM-49`) — ✅ livré 2026-08-15

Les neuf critères ajoutés par WCAG 2.2 sont statués un par un en
[doc 11 §8](../../docs/11-spec-accessibilite-ct-ut.md) : six dans la cible (A/AA), trois
AAA écartés par écrit. **Deux échecs réels, deux angles morts d'outillage** — et les deux
angles morts sont le résultat principal, parce qu'ils rendaient les deux échecs invisibles.

**L'outil ne regardait pas.** L'audit `axe-core` ne demandait que
`wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa` : **69 règles, aucune de 2.2**. `target-size`
(SC 2.5.8) est la seule règle 2.2 qu'axe sache exécuter, elle y est déclarée
`enabled: false`, et **seul** le tag `wcag22aa` la met en route. Un audit vert ne disait
donc rien de 2.2 — et rien dans son verdict ne le laissait deviner. Second angle mort :
`playwright.config.ts` n'a qu'un projet `Desktop Chrome`, donc l'audit n'avait **jamais**
vu la présentation mobile ; or la barre d'onglets fixe, la feuille « Plus » et la modale
en bottom-sheet n'existent que sous 768 px (`display: contents` les dissout au-dessus).

- **SC 2.4.11 « Focus non masqué (minimum) », AA — échec, corrigé.** Le panneau « Plus »
  est un _disclosure_ posé en `position: fixed` au-dessus du contenu : ni piège de focus,
  ni `inert`. `Tab` depuis son dernier lien continuait **dans le contenu, sous la feuille**.
  Mesuré par parcours clavier réel (Pixel 5) sur 8 routes : **6 à 31 contrôles entièrement
  recouverts par écran**, dont « Créer ma famille », « Enregistrer », « Supprimer le
  contrat ». Le panneau se referme désormais dès qu'un focus arrive hors de la nav, et sur
  `Échap`. **Sans panneau ouvert, le critère passait déjà** — `scroll-padding-bottom`
  couvre la barre fixe, et le bandeau hors-ligne collant n'a produit **aucun** recouvrement.
- **SC 3.3.7 « Saisie redondante », A — échec, corrigé.** Le formulaire de création
  redemandait l'adresse **vérifiée** avec laquelle la personne venait de s'authentifier.
  L'enjeu dépasse le confort : `moi.foyers` est résolu côté serveur depuis les lignes
  parent portant cette adresse, donc une ligne absente ou mal orthographiée fait créer un
  foyer dont son auteur **n'est pas parent** — et qu'il ne retrouve pas en mode borné.
- **SC 2.5.8, 2.5.7 et 3.2.6 — conformes, et vérifiés plutôt que supposés.** 0 violation
  `target-size` sur 10 routes desktop et 3 mobiles ; les 8 cibles rendues sous 24 px
  relèvent toutes de l'exception d'espacement (plus de 24 px entre centres, la plus serrée
  à 50 px). Aucun geste de glissement n'existe (FullCalendar en `dateClick` seul).
  Le mécanisme d'aide (`/mentions` par `PiedPage`) occupe le même rang relatif partout.
- **SC 3.3.8 — écarté par écrit.** L'application n'a **aucune** étape d'authentification :
  tout est délégué à Cloudflare Access, hors dépôt. Ce que la porte garde est cette
  absence — le jour où l'app fait naître son propre écran de connexion, le renoncement
  devient faux et la CI le dit.

Porte : **`pnpm wcag`** (7 sondes `--autotest` + une sonde réelle jouée à la main : un
`input type="password"` posé dans `apps/web/src` fait refuser la porte, qui nomme le
fichier). Périmètre déclaré au registre §5 — elle ne **mesure** aucun critère, c'est
`e2e-web` qui le fait ; elle garde l'accord entre la cible écrite, les gardes citées et
le périmètre de l'outil.

Consigné : `AM-49` ✅, `AM-86`, `LE-59`, `EM-15`.
