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
