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

## Lot 4 — erreurs RFC 9457 (`AM-37`)

Filter global gateway + format `application/problem+json` unifié. **Danger connu** :
la forme `{ statusCode, code, message }` est figée dans les pacts et lue par le front
(`code` métier) — migrer contrat par contrat (Pact + OpenAPI + web), pas en big-bang.

## Lot 5 — validation d'environnement (`AM-44`)

Schéma zod unique par app (les 6 `config.ts`), boot refusé sur config invalide avec le
champ nommé. Reprendre les garde-fous `verifierConfigProduction()` dans le schéma.
S'articule avec `AM-30` (bascules fail-open) : le schéma rend chaque bascule **visible**.

## Lot 6 — piste d'audit acteur (`AM-45`)

Colonne acteur sur les mutations sensibles (revenus, parents, enfants) + journalisation
des succès. L'identité existe déjà dans la gateway (`IdentiteGuard`) et se propage par
assertion HMAC : il s'agit de la **persister**, pas de la créer.

## Lot 7 — sémantique HTTP restante (`AM-39`, `AM-40`, `AM-41`)

`Location` sur les 201, pagination (ou écart écrit), `ETag`/`If-Match` (ou renoncement
écrit). À traiter en opportuniste quand un lot fonctionnel touche les routes concernées.

## Lot 8 — durcissements ops (`AM-47` ⏸, `AM-48`, `AM-50`)

Compose durci (`no-new-privileges`, `cap_drop`, `read_only` où possible) — vérification
sur la pile réelle = poste principal. `minimumReleaseAge` : instruire l'impact
Dependabot avant de poser. SPF/DKIM/DMARC : bloqué sur décision PO (domaine d'envoi).

## Lot 9 — WCAG 2.2 (`AM-49`)

Évaluation critère par critère des nouveautés 2.2, intégrée à la cible doc 11 ; à
coupler avec les chantiers mobile en cours (`/upgrade-qualite-mobile`).
