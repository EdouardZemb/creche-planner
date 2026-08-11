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

Suppression de foyer (cascade réelle), purge différée des parents soft-delete, borne
temporelle sur `correction_journal`/outbox/projections. Attention : les événements
`.v1` et les read models aval (`svc-tarification`, `svc-notifications`) portent des
copies — l'effacement est un **événement d'intégration**, pas un `DELETE` local.
Critère : parcours E2E stack réelle de bout en bout, résidus vérifiés en base.

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
