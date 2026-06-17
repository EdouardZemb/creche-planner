# Canal AsyncAPI — contexte Planification

Événements publiés par **`svc-planification`** sur NATS JetStream via l'**outbox**
(écriture transactionnelle puis relais idempotent, clé = `id` d'enveloppe).
Schémas source de vérité : [`../events/planification-events.ts`](../events/planification-events.ts).

## Sujets (subjects NATS)

| Sujet                              | Événement                       | Déclencheur                                   |
| ---------------------------------- | ------------------------------- | --------------------------------------------- |
| `planification.ContratCree.v1`     | `planification.ContratCree`     | Création d'un contrat de garde                |
| `planification.ContratModifie.v1`  | `planification.ContratModifie`  | Modification des champs d'un contrat de garde |
| `planification.ContratSupprime.v1` | `planification.ContratSupprime` | Suppression d'un contrat de garde             |
| `planification.PlanningModifie.v1` | `planification.PlanningModifie` | Modification du planning mensuel d'un contrat |

Stream JetStream : `PLANIFICATION` (sujets `planification.>`). Enveloppe commune :
`IntegrationEvent` (`id`, `type`, `source`, `version`, `occurredAt`, `traceId`,
`payload`). `id` sert de **clé d'idempotence** côté consommateur.

## `planification.ContratCree.v1` — payload

| Champ       | Type                                                  | Notes                              |
| ----------- | ----------------------------------------------------- | ---------------------------------- |
| `contratId` | uuid                                                  | Identité du contrat créé           |
| `foyerId`   | uuid                                                  | Foyer de rattachement              |
| `enfant`    | string non vide                                       | Prénom de l'enfant                 |
| `mode`      | `CRECHE_PSU` \| `PERISCOLAIRE` \| `CANTINE` \| `ALSH` | Mode de garde du contrat           |
| `valideDu`  | `YYYY-MM-DD`                                          | Début de validité                  |
| `valideAu`  | `YYYY-MM-DD` \| `null`                                | Fin de validité (`null` = ouverte) |

## `planification.ContratModifie.v1` — payload

| Champ       | Type                                                  | Notes                              |
| ----------- | ----------------------------------------------------- | ---------------------------------- |
| `contratId` | uuid                                                  | Identité du contrat modifié        |
| `foyerId`   | uuid                                                  | Foyer de rattachement              |
| `enfant`    | string non vide                                       | Prénom de l'enfant                 |
| `mode`      | `CRECHE_PSU` \| `PERISCOLAIRE` \| `CANTINE` \| `ALSH` | Mode de garde (peut changer)       |
| `valideDu`  | `YYYY-MM-DD`                                          | Début de validité                  |
| `valideAu`  | `YYYY-MM-DD` \| `null`                                | Fin de validité (`null` = ouverte) |

## `planification.ContratSupprime.v1` — payload

| Champ       | Type | Notes                        |
| ----------- | ---- | ---------------------------- |
| `contratId` | uuid | Identité du contrat supprimé |

## `planification.PlanningModifie.v1` — payload

| Champ       | Type      | Notes                           |
| ----------- | --------- | ------------------------------- |
| `contratId` | uuid      | Contrat concerné                |
| `mois`      | `YYYY-MM` | Mois du planning modifié        |
| `simule`    | boolean   | `true` = simulé, `false` = réel |

> Consommateurs (Phase 6, `svc-tarification`) : traitement **idempotent** sur `id`.
> Le détail du contrat et du planning se relit via l'API de `svc-planification`.
