# Canal AsyncAPI — contexte Foyer

Événements publiés par **`svc-foyer`** sur NATS JetStream via l'**outbox**
(écriture transactionnelle puis relais idempotent, clé = `id` d'enveloppe).
Schémas source de vérité : [`../events/foyer-events.ts`](../events/foyer-events.ts).

## Sujets (subjects NATS)

| Sujet                    | Événement             | Déclencheur                                  |
| ------------------------ | --------------------- | -------------------------------------------- |
| `foyer.FoyerMisAJour.v1` | `foyer.FoyerMisAJour` | Création ou mise à jour des données du foyer |
| `foyer.EnfantAjoute.v1`  | `foyer.EnfantAjoute`  | Rattachement d'un enfant au foyer            |
| `foyer.EnfantModifie.v1` | `foyer.EnfantModifie` | Édition d'un enfant (prénom/date)            |
| `foyer.EnfantRetire.v1`  | `foyer.EnfantRetire`  | Retrait d'un enfant (hard delete)            |

Enveloppe commune : `IntegrationEvent` (`id`, `type`, `source`, `version`,
`occurredAt`, `traceId`, `payload`). `id` sert de **clé d'idempotence** côté
consommateur.

## `foyer.FoyerMisAJour.v1` — payload

| Champ                          | Type              | Notes                                 |
| ------------------------------ | ----------------- | ------------------------------------- |
| `foyerId`                      | uuid              | Identité du foyer                     |
| `ressourcesMensuellesCentimes` | int ≥ 0           | Ressources CNAF (centimes, `Money`)   |
| `rfrCentimes`                  | int ≥ 0           | Revenu fiscal de référence (centimes) |
| `nbEnfantsACharge`             | int ≥ 1           |                                       |
| `nbParts`                      | number > 0        | Quotient familial                     |
| `tranche`                      | `1` \| `2` \| `3` | Tranche RFR **dérivée** (transportée) |

## `foyer.EnfantAjoute.v1` — payload

| Champ           | Type            | Notes                 |
| --------------- | --------------- | --------------------- |
| `foyerId`       | uuid            | Foyer de rattachement |
| `enfantId`      | uuid            | Identité de l'enfant  |
| `prenom`        | string non vide |                       |
| `dateNaissance` | `YYYY-MM-DD`    | Date ISO              |

> Consommateurs (Phase 6, `svc-tarification`) : traitement **idempotent** sur
> `id`. La tranche est fournie pour éviter de redériver le barème côté consommateur.

## `foyer.EnfantModifie.v1` / `foyer.EnfantRetire.v1` — payloads

`EnfantModifie` transporte l'**état complet** de l'enfant (mêmes champs
qu'`EnfantAjoute` : `foyerId`, `enfantId`, `prenom`, `dateNaissance`).
`EnfantRetire` ne porte que les **identités** (`foyerId`, `enfantId`) — le retrait
est un **hard delete** côté `svc-foyer`. Ces événements ne cascadent pas vers les
plannings : un contrat de `svc-planification` référence l'enfant par **prénom
libre**, pas par `enfantId` (désynchro cosmétique seulement).
