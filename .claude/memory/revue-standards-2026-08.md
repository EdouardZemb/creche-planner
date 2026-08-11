# Revue standards industriels — août 2026

## État courant

- **2026-08-10** (session distante) : revue complète de l'application contre les
  standards externes (sécurité, API/observabilité, données/RGPD/frontend). Constats
  consignés `AM-33` → `AM-51` + `LE-29` (doc 34) ; veille pérennisée en doc 36
  (cadence trimestrielle, rituel doc 34 §6) ; plan par lots dans
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

## Ce que la revue a établi (résumé)

- **Angle mort n° 1 : RGPD** — aucune des obligations (art. 13/17/20/30) n'était
  traitée hors droit d'opposition (ADR-0006), alors que l'app stocke mineurs et
  revenus. Cause racine en `LE-29` : les revues confrontaient le processus, jamais le
  produit, aux référentiels externes.
- Solide et confirmé : OTel complet, liveness/readiness disciplinés, supply chain CI
  (SHA-pinning, SBOM, cosign), sauvegardes avec restauration prouvée.
- Détail des faits par domaine : voir les critères des lignes `AM-33`…`AM-51`.

## Pièges pour les lots suivants

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
