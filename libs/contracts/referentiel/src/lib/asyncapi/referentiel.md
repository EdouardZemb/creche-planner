# Canal AsyncAPI — contexte Référentiel

Événements publiés par **`svc-referentiel`** sur NATS JetStream via l'**outbox**
(écriture transactionnelle puis relais idempotent, clé = `id` d'enveloppe).
Schémas source de vérité : [`../events/referentiel-events.ts`](../events/referentiel-events.ts).

## Sujets (subjects NATS)

| Sujet                          | Événement                   | Déclencheur                              |
| ------------------------------ | --------------------------- | ---------------------------------------- |
| `referentiel.GrillePubliee.v1` | `referentiel.GrillePubliee` | Publication d'une grille ABCM versionnée |

Stream JetStream : `REFERENTIEL` (sujets `referentiel.>`). Enveloppe commune :
`IntegrationEvent` (`id`, `type`, `source`, `version`, `occurredAt`, `traceId`,
`payload`). `id` sert de **clé d'idempotence** côté consommateur.

## `referentiel.GrillePubliee.v1` — payload

| Champ      | Type                                  | Notes                              |
| ---------- | ------------------------------------- | ---------------------------------- |
| `grilleId` | uuid                                  | Identité de la grille publiée      |
| `mode`     | `PERISCOLAIRE` \| `CANTINE` \| `ALSH` | Mode ABCM couvert                  |
| `tranche`  | `1` \| `2` \| `3`                     | Tranche RFR ABCM                   |
| `valideDu` | `YYYY-MM-DD`                          | Début de validité                  |
| `valideAu` | `YYYY-MM-DD` \| `null`                | Fin de validité (`null` = ouverte) |

> Consommateurs (Phase 6, `svc-tarification`) : traitement **idempotent** sur `id`.
> La grille complète se relit via l'API « grille applicable à (date, tranche, mode) ».
