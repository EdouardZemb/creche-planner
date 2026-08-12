# Canal AsyncAPI — contexte Foyer

Événements publiés par **`svc-foyer`** sur NATS JetStream via l'**outbox**
(écriture transactionnelle puis relais idempotent, clé = `id` d'enveloppe).
Schémas source de vérité : [`../events/foyer-events.ts`](../events/foyer-events.ts).

## Sujets (subjects NATS)

| Sujet                                | Événement                         | Déclencheur                                                      |
| ------------------------------------ | --------------------------------- | ---------------------------------------------------------------- |
| `foyer.FoyerMisAJour.v1`             | `foyer.FoyerMisAJour`             | Création ou mise à jour des données du foyer                     |
| `foyer.FoyerMisAJour.v2`             | `foyer.FoyerMisAJour`             | Idem + `anneeRevenus` optionnelle (v2 rétrocompatible, ADR-0004) |
| `foyer.FoyerMisAJour.v3`             | `foyer.FoyerMisAJour`             | Une émission **par version de ressources** (SFD 30)              |
| `foyer.EnfantAjoute.v1`              | `foyer.EnfantAjoute`              | Rattachement d'un enfant au foyer                                |
| `foyer.EnfantModifie.v1`             | `foyer.EnfantModifie`             | Édition d'un enfant (prénom/date)                                |
| `foyer.EnfantRetire.v1`              | `foyer.EnfantRetire`              | Retrait d'un enfant (hard delete)                                |
| `foyer.ParentAjoute.v1`              | `foyer.ParentAjoute`              | Rattachement (ou réactivation) d'un parent — état complet        |
| `foyer.ParentModifie.v1`             | `foyer.ParentModifie`             | Édition d'un parent — état complet                               |
| `foyer.ParentRetire.v1`              | `foyer.ParentRetire`              | Retrait d'un parent (soft-delete `actif = false`)                |
| `foyer.PreferencesNotifModifiees.v1` | `foyer.PreferencesNotifModifiees` | Matrice type × canal d'un parent — état complet                  |
| `foyer.FoyerSupprime.v1`             | `foyer.FoyerSupprime`             | **Effacement du foyer entier** (cascade locale + copies aval)    |

> Cette fiche n'est adossée à **aucune porte de CI** (dette `AM-14`) : elle a
> silencieusement dérivé jusqu'à ne lister que 4 des 11 sujets. Toute addition
> d'événement doit y passer à la main.

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
est un **hard delete** côté `svc-foyer`. Un contrat de `svc-planification` référence
l'enfant par `enfant_id` (colonne encore **nullable** le temps du back-fill) : sur
`EnfantModifie`, la projection rafraîchit la dénormalisation `contrat.enfant` ; sur
`EnfantRetire`, **rien n'est fait** — le contrat survit à l'enfant qu'il désigne.

## `foyer.FoyerSupprime.v1` — payload

| Champ       | Type   | Notes                                            |
| ----------- | ------ | ------------------------------------------------ |
| `foyerId`   | uuid   | Foyer effacé                                     |
| `parentIds` | uuid[] | **Tous** les parents du foyer, actifs et retirés |

Émis **dans la transaction** qui supprime la ligne `foyer` (cascade SQL sur les
versions de ressources, le journal de corrections, les enfants et les parents).
Les `parentIds` sont collectés **avant** la suppression : sans eux, la boîte de
réception in-app de `svc-notifications` — clé par `parent_id`, sans `foyer_id` —
resterait orpheline.

**Tout consommateur du stream `FOYER` doit le traiter.** Les abonnements sont
posés sur `foyer.>` sans `filter_subject` : un service qui ne connaît pas un type
le range en `dead_letter` **avec son payload en clair** (`IGNORE_TYPE_INCONNU`).
Ignorer `FoyerSupprime` reviendrait donc à recopier le foyer effacé dans la table
des rebuts.
