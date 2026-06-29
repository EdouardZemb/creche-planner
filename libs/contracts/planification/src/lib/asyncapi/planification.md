# Canal AsyncAPI — contexte Planification

Événements publiés par **`svc-planification`** sur NATS JetStream via l'**outbox**
(écriture transactionnelle puis relais idempotent, clé = `id` d'enveloppe).
Schémas source de vérité : [`../events/planification-events.ts`](../events/planification-events.ts).

## Sujets (subjects NATS)

| Sujet                                    | Événement                             | Déclencheur                                                                          |
| ---------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| `planification.ContratCree.v1`           | `planification.ContratCree`           | Création d'un contrat de garde                                                       |
| `planification.ContratModifie.v1`        | `planification.ContratModifie`        | Modification des champs d'un contrat de garde                                        |
| `planification.ContratSupprime.v1`       | `planification.ContratSupprime`       | Suppression d'un contrat de garde                                                    |
| `planification.PlanningModifie.v1`       | `planification.PlanningModifie`       | Modification du planning mensuel d'un contrat                                        |
| `planification.EtablissementCree.v1`     | `planification.EtablissementCree`     | Création d'un établissement (entité libre, ou à la volée à la création d'un contrat) |
| `planification.EtablissementModifie.v1`  | `planification.EtablissementModifie`  | Modification / archivage d'un établissement                                          |
| `planification.EtablissementSupprime.v1` | `planification.EtablissementSupprime` | Suppression d'un établissement                                                       |

Stream JetStream : `PLANIFICATION` (sujets `planification.>`). Enveloppe commune :
`IntegrationEvent` (`id`, `type`, `source`, `version`, `occurredAt`, `traceId`,
`payload`). `id` sert de **clé d'idempotence** côté consommateur.

## `planification.ContratCree.v1` — payload

| Champ             | Type                                                  | Notes                                                           |
| ----------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| `contratId`       | uuid                                                  | Identité du contrat créé                                        |
| `foyerId`         | uuid                                                  | Foyer de rattachement                                           |
| `enfant`          | string non vide                                       | Prénom de l'enfant                                              |
| `mode`            | `CRECHE_PSU` \| `PERISCOLAIRE` \| `CANTINE` \| `ALSH` | Mode de garde du contrat                                        |
| `valideDu`        | `YYYY-MM-DD`                                          | Début de validité                                               |
| `valideAu`        | `YYYY-MM-DD` \| `null`                                | Fin de validité (`null` = ouverte)                              |
| `etablissementId` | uuid \| `null` (optionnel)                            | Établissement rattaché (P2) ; absent/null toléré (rétro-compat) |

## `planification.ContratModifie.v1` — payload

| Champ             | Type                                                  | Notes                                                           |
| ----------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| `contratId`       | uuid                                                  | Identité du contrat modifié                                     |
| `foyerId`         | uuid                                                  | Foyer de rattachement                                           |
| `enfant`          | string non vide                                       | Prénom de l'enfant                                              |
| `mode`            | `CRECHE_PSU` \| `PERISCOLAIRE` \| `CANTINE` \| `ALSH` | Mode de garde (peut changer)                                    |
| `valideDu`        | `YYYY-MM-DD`                                          | Début de validité                                               |
| `valideAu`        | `YYYY-MM-DD` \| `null`                                | Fin de validité (`null` = ouverte)                              |
| `etablissementId` | uuid \| `null` (optionnel)                            | Établissement rattaché (P2) ; absent/null toléré (rétro-compat) |

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

## `planification.EtablissementCree.v1` / `EtablissementModifie.v1` — payload

État **complet** de l'établissement (entité libre par foyer). Même forme pour les
deux événements : le consommateur (`svc-notifications`) projette son read-model sans
relire la source. Les coordonnées internes (adresse / téléphone / contact) restent
dans `svc-planification` et **ne voyagent pas**.

| Champ             | Type                                     | Notes                                       |
| ----------------- | ---------------------------------------- | ------------------------------------------- |
| `etablissementId` | uuid                                     | Identité de l'établissement                 |
| `foyerId`         | uuid                                     | Foyer propriétaire (isolation par foyer)    |
| `nom`             | string non vide                          | Nom libre, unique par foyer                 |
| `emailService`    | email \| `null`                          | Destinataire des récaps (`null` si absent)  |
| `preavisRegle`    | `JOURS_OUVRES` \| `JOUR_HEURE` \| `null` | Règle de préavis (`null` si non définie)    |
| `types`           | tableau de modes                         | Sous-ensemble informatif des modes proposés |
| `actif`           | boolean                                  | Établissement actif (archivé = non notifié) |

## `planification.EtablissementSupprime.v1` — payload

| Champ             | Type | Notes                                |
| ----------------- | ---- | ------------------------------------ |
| `etablissementId` | uuid | Identité de l'établissement supprimé |

> Consommateurs (Phase 6, `svc-tarification`) : traitement **idempotent** sur `id`.
> Le détail du contrat et du planning se relit via l'API de `svc-planification`.
