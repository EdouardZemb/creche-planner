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
- `AM-51` veille standards (doc 36 + rituel doc 34 §6).

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

### Lot 2b — bornes temporelles (`AM-36` volet outillage, `AM-01`, `AM-03`)

Purge périodique par âge, sur le patron maison `setInterval` + garde de réentrance
(`OutboxRelay`/`SchedulerHebdo` — pas de `@nestjs/schedule`, refus documenté), horloge
injectée pour tester sans attendre. Durées : celles de doc 37 §3. Deux préalables écrits :
`processed_event` ne se borne qu'**après** avoir posé un `max_age` sur les streams
JetStream (sinon on rouvre le rejeu), et l'index sur les colonnes de date se pose **dans
la même migration** que la purge (première purge = balayage séquentiel sur des tables
jamais nettoyées). Critère : une ligne juste **sous** la borne survit — la sonde négative
est là, pas sur la ligne supprimée.

## Lot 3 — portabilité (`AM-35`)

Export JSON des données personnelles du foyer, téléchargeable par un parent authentifié.
Petit lot, dépend du lot 2 pour la liste exhaustive des données par foyer.

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
