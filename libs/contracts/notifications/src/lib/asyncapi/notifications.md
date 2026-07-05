# Canal AsyncAPI — contexte Notifications

Événements publiés par **`svc-notifications`** sur NATS JetStream via l'**outbox**
(écriture transactionnelle puis relais idempotent, clé = `id` d'enveloppe).
Schémas source de vérité : [`../events/notifications-events.ts`](../events/notifications-events.ts).

## Sujets (subjects NATS)

| Sujet                             | Événement                      | Déclencheur                                               |
| --------------------------------- | ------------------------------ | --------------------------------------------------------- |
| `notifications.SemaineValidee.v1` | `notifications.SemaineValidee` | Validation d'une semaine notifiée par un parent (BFF/web) |

Stream JetStream : `NOTIFICATIONS` (sujets `notifications.>`). Enveloppe commune :
`IntegrationEvent` (`id`, `type`, `source`, `version`, `occurredAt`, `traceId`,
`payload`). `id` sert de **clé d'idempotence** côté consommateur.

## `notifications.SemaineValidee.v1` — payload

Émis **une seule fois** par semaine notifiée, dans la même transaction que la
transition `A_VALIDER` → `VALIDEE`/`VALIDEE_AVEC_MODIFS` de `notification_hebdo`
(`ValidationService.valider`). Les revalidations idempotentes (semaine déjà
validée) **n'émettent rien**.

| Champ         | Type                               | Notes                                                                   |
| ------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| `contratId`   | uuid                               | Contrat de garde dont la semaine a été validée                          |
| `semaineIso`  | `YYYY-Www`                         | Semaine ISO 8601 validée (ex. `2026-W27`)                               |
| `statut`      | `VALIDEE` \| `VALIDEE_AVEC_MODIFS` | `AVEC_MODIFS` = planning modifié entre la notification et la validation |
| `deltaModifs` | objet (optionnel)                  | Présent uniquement pour `VALIDEE_AVEC_MODIFS` — jours modifiés, cf. bas |

`deltaModifs.jours[]` : `{ date: YYYY-MM-DD, avant, apres }` où `avant`/`apres`
sont le contenu du jour côté snapshot notifié / relecture (`null` = jour absent
d'un côté). Le contenu d'un jour reste **opaque** au contrat (catégories datées
possédées par le contexte planification).

> Consommateurs pressentis : audit / métriques de validation, futur récap
> automatique vers l'établissement. Traitement **idempotent** sur `id`.
