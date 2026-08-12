# Revue standards industriels — août 2026

## État courant

- **2026-08-10** (session distante) : revue complète de l'application contre les
  standards externes (sécurité, API/observabilité, données/RGPD/frontend). Constats
  consignés `AM-33` → `AM-51` + `LE-29` (doc 34) ; veille pérennisée en doc 36
  (cadence trimestrielle, rituel doc 34 §7) ; plan par lots dans
  `.claude/plans/plan-standards-industriels.md`.
- Lot 0 livré dans la même PR : backoff+jitter+discrimination 4xx
  (`libs/resilience`), HSTS + garde en-têtes (`apps/web/src/nginx-headers.spec.ts`),
  `Retry-After` sur le 429 gateway.
- **2026-08-11 — lot 1 livré (PR #312, branche `feat/rgpd-lot1-registre-et-mentions`).**
  **Décision PO structurante : l'exemption domestique art. 2(2)(c) est ASSUMÉE**
  (ADR-0007) — les livrables sont tenus en **démarche volontaire**, le dépôt ne
  revendique aucune conformité. Cela clôt la contradiction entre le plan de juillet
  (qui écartait le registre) et celui d'août. L'ADR énonce les **4 seuils de
  révision** : plus d'un foyer, accès direct d'un établissement, cadre associatif,
  donnée de santé réelle. Livré : doc 37 (8 traitements, 8 tiers, durées), RPO 24 h /
  RTO 24 h en `sauvegardes.md` §10, page publique `/mentions` + pied de page, pied
  d'information sur les 2 courriels sortants. `AM-46` clos, `AM-36` recadré sur son
  volet outillage, `AM-52` et `LE-30` ouverts.

- **2026-08-12 — lot 2a livré (branche `feat/rgpd-lot2-effacement-foyer`).** Effacement
  du foyer de bout en bout : `DELETE /api/v1/foyers/:id` → cascade SQL → événement
  `foyer.FoyerSupprime.v1` → effacement des copies dans les 3 read-models. **Le lot 2 a
  été scindé** (2a effacement / 2b bornes temporelles) : deux risques sans dépendance
  mutuelle. Trouvaille structurante : **`dead_letter` archive des données personnelles en
  clair** parce que les abonnements n'ont pas de `filter_subject` — consigné `AM-53`, avec
  `AM-54` (index), `LE-31` (`Modale` cassait toute saisie) et `LE-32` (drizzle ne lie pas
  l'opérande d'un `like`).

- **2026-08-12 — lot 2b livré (bornes temporelles).** `PurgeModule` dans
  `libs/nest-commons` : `setInterval` + garde de réentrance, **horloge remontée dans la
  lib** (`CLOCK` vivait dans `svc-notifications` ; le patron partagé était justement celui
  qui appelait `new Date()` en dur), compteurs OTel, une tâche isolée par `try`. Neuf
  bornes dans les 5 services, chaque index posé dans la même migration ; `outbox` et
  `dead_letter` bornées **dans la lib** (prédicat unique, hérité). `AM-01` soldée (index de
  purge + index partiel du backlog).
  **Ce que le lot a vraiment trouvé : deux des huit durées de doc 37 §3 étaient FAUSSES,
  pas difficiles.** T1 ancrait la rétention sur la « date d'effet de la version » — or la
  fin d'une version n'existe pas en base, la dernière reste ouverte, donc la version **en
  vigueur** d'un foyer inactif tombe sous la borne, et l'aval **facture faux sans lever
  d'erreur**. T3bis demandait de purger la preuve d'un désabonnement dont la disparition
  **vaut réabonnement**. Corrigées en doc 37 v1.1, pas outillées.
  Porte née de là : **`pnpm retentions`** — une durée déclarée outillée doit nommer sa
  colonne, et celle-ci doit exister dans tous les schémas déclarant la table. Elle ferme
  `MO-2` à sa 3ᵉ occurrence. Vérifiée en rejouant l'énoncé v1.0 : refusé dans les 2 services.
  Consigné : `AM-55`→`AM-61`, `LE-34`, `LE-35` ; `AM-01` ✅, `AM-03`/`AM-36` avancées.

## Ce que la revue a établi (résumé)

- **Angle mort n° 1 : RGPD** — aucune des obligations (art. 13/17/20/30) n'était
  traitée hors droit d'opposition (ADR-0006), alors que l'app stocke mineurs et
  revenus. Cause racine en `LE-29` : les revues confrontaient le processus, jamais le
  produit, aux référentiels externes.
- Solide et confirmé : OTel complet, liveness/readiness disciplinés, supply chain CI
  (SHA-pinning, SBOM, cosign), sauvegardes avec restauration prouvée.
- Détail des faits par domaine : voir les critères des lignes `AM-33`…`AM-51`.

## Pièges pour les lots suivants

- **L'absence d'une ligne porte du sens ici — une purge est alors un changement de
  comportement, pas de l'hygiène (`LE-35`).** Quatre tables l'encodent : `processed_event`
  (absente ⇒ rejeu), `preference_notification` (absente ⇒ consentement, donc
  réabonnement), `notification_hebdo` (absente ⇒ action en attente effacée) et
  `envoi_etablissement` **côté sortant** (absente ⇒ second courriel réel vers une crèche —
  l'endpoint d'envoi n'est borné par aucune date et le front réarme son bouton à chaque
  montage). D'où l'**anonymisation en place** plutôt que la suppression sur cette dernière.
  Avant de borner une table : chercher qui interprète son **absence**, pas qui la lit.
- **Les sondes du registre écrites sur un littéral se périment en silence.** Trois ont
  cessé de mordre pendant ce lot, en touchant `MO-2` et en closant `AM-01` ; seule la garde
  « la mutation n'a rien changé » de `--autotest` l'a dit. Les 4 sondes qui visaient une
  propriété **mutable** sont désormais dérivées. **Rejouer `--autotest`, pas seulement la
  porte**, dès qu'on touche au registre.
- **Drizzle lie une borne `Date` en chaîne ISO**, pas en `Date` : les assertions de
  paramètre d'une purge se sondent (`.toISOString()`), elles ne se supposent pas.

- RFC 9457 (lot 4) : la forme d'erreur `{ statusCode, code, message }` est **figée
  dans les pacts** et lue par le front — migration contrat par contrat.
- Effacement (lot 2) : les read models aval portent des copies des données foyer —
  l'effacement doit voyager en événement d'intégration, pas en `DELETE` local.
  🔑 **Le mécanisme existe DÉJÀ et n'est pas à inventer** : `retirerEnfant`
  (`svc-foyer/src/foyer/foyer.service.ts`) est un `DELETE` réel suivi d'un événement
  `EnfantRetire` — même chose pour contrat et établissement. Le lot 2 généralise ce
  patron au foyer entier ; il ne part pas de zéro. Corollaire : la lecture « aucune
  suppression n'existe » (énoncé d'`AM-34`) est **trop grossière**, seule la purge
  liée au temps et l'effacement d'ensemble manquent.
- **Tout ajout au corps d'un courriel doit être réapposé côté serveur.**
  `RelectureEnvoi` envoie **toujours** le texte réécrit par le parent, qui remplace
  le corps rendu **en entier** : ce qui n'est ajouté qu'au gabarit ne part jamais
  dans un vrai message (constaté au lot 1, réglé dans `EnvoiService`).
- **Ne pas informer par la seule page web.** L'agent d'établissement et les enfants
  n'ouvrent jamais l'application ; la collecte les concernant est **indirecte**. Le
  pied de courriel est le seul canal qui les atteigne.
