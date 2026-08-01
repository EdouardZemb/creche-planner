# 30 — SFD Fondations : versionnement à date d'effet

> Statut : **Brouillon — à valider PO** · Version 0.1 · 2026-07-19
> Socle transverse des docs 31 (calendriers), 32 (travail & revenus) et 33 (planning famille).
> Décrit le _quoi_ et le _pourquoi_. Le _comment_ viendra dans un plan d'implémentation dédié.

## 1. Contexte & problème

Aujourd'hui, modifier un contrat de garde ou une grille tarifaire **remplace** la donnée :
le nouveau paramétrage s'applique rétroactivement à tout l'historique. Or la réalité est
temporelle : un avenant crèche prend effet à une date précise, les tarifs ABCM changent à
chaque rentrée (`TARIFS2627.pdf` vs grille 25/26), les ressources CNAF/RFR du foyer sont
revues chaque année. **Les jours passés doivent rester calculés avec les règles et tarifs
en vigueur à l'époque.**

L'audit du code (2026-07-19) montre que l'infrastructure existe déjà en partie mais est
**contournée** :

- Le svc-referentiel possède des tables versionnées (`grille_abcm`, `bareme_psu`,
  `jour_non_facturable` avec `valideDu`/`valideAu`) projetées vers la tarification
  (`grille_tarifaire`) — mais le calcul réel lit des **constantes du domaine**
  (`GRILLE_ABCM_2026`, `BAREME_EFFORT_PSU_2026`) : le read-model projeté est décoratif,
  et changer un tarif exige un déploiement de code.
- Les seuils de tranche RFR (20 k€ / 50 k€) sont en dur dans le shared-kernel, non
  versionnés.
- Les contrats de garde et le foyer (ressources, enfants à charge) ne sont pas versionnés
  du tout.

## 2. Concept central : l'entité versionnée

Toute donnée « à effet dans le temps » devient une **suite de versions contiguës** :

```
Entité (identité stable)
 └─ Version 1  [dateEffet: 2025-09-01 → 2026-08-31]  (paramètres A)
 └─ Version 2  [dateEffet: 2026-09-01 → ∞]           (paramètres B)
```

- **Résolution temporelle** : pour un jour J, la version applicable est celle dont la
  période de validité contient J. Tout calcul (coût d'un jour, solde de congés, revenu
  d'un mois) résout ses paramètres **à la date du fait**, jamais « à la version courante ».
- **Avenant** : créer une version à date d'effet clôt automatiquement la précédente la
  veille. Le passé n'est pas réécrit.
- **Le passé est immuable par défaut** : une correction rétroactive est possible mais
  **explicite** (action distincte de l'avenant), tracée, et signale les périodes déjà
  facturées/validées qu'elle impacte.

## 3. Périmètre

### Objets versionnés (v1) — validé PO 2026-07-19

| Objet                                                                                      | Exemples de changements à date d'effet                                                                      |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **Contrat de garde** (crèche PSU, inscriptions ABCM)                                       | Changement de semaine type, d'heures hebdo, de mensualité ; fin de contrat (départ crèche → école en sept.) |
| **Grilles tarifaires & barèmes** (grille ABCM, barème d'effort PSU, seuils de tranche RFR) | Nouvelle grille 2026/27 à la rentrée ; revalorisation CNAF au 1er janvier                                   |
| **Contrat de travail** (spécifié doc 32)                                                   | Avenant, changement de taux d'activité (Anna 40 % → 60 %), augmentation                                     |
| **Foyer** (ressources CNAF, RFR, nb enfants à charge, nb parts)                            | Révision annuelle → nouveau tarif horaire PSU et nouvelle tranche ABCM à partir de la date                  |

### Hors périmètre (v1)

- Bitemporalité complète (date de connaissance vs date d'effet) : on trace _qui/quand_ a
  saisi (audit), mais on ne rejoue pas « ce qu'on savait à l'époque ».
- Workflow d'approbation d'avenant (mono-foyer, le parent est souverain).

## 4. Principe de conception — le cas réel est une instance

Règle transverse à toutes les SFD 30→33 : **aucun objet du monde réel ne doit exister
dans le code métier**. « École ABCM », « Crèche Les Hirondelles », « grille Mulhouse
2026 », « Syntec », « Sulzer » sont des **instances** (données en base, seeds, config)
d'abstractions : `Établissement`, `GrilleTarifaire`, `RégimeCongés`, `Employeur`.

Le chantier « établissements entité libre » (2026-06-30) a déjà appliqué ce principe aux
établissements. La présente SFD l'étend au **paramétrage tarifaire** en résorbant la
dette identifiée :

| ID    | Dette                                                                                                        | Exigence                                                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DV-01 | `GRILLE_ABCM_2026` en constantes dans `libs/tarification/domain` (double source avec le seed du Référentiel) | Le calcul consomme la grille projetée du Référentiel (résolue à la date du jour calculé) ; les constantes du domaine deviennent le seed initial, puis disparaissent |
| DV-02 | `BAREME_EFFORT_PSU_2026` en constantes (idem)                                                                | Même traitement que DV-01                                                                                                                                           |
| DV-03 | Seuils de tranche RFR (20 k/50 k) en dur dans le shared-kernel                                               | Le barème de tranches devient une donnée versionnée du Référentiel, avec un nombre de tranches libre                                                                |
| DV-04 | `ModeGarde` = enum fermé, divergent entre libs ; famille « ABCM » redéfinie en 3 endroits                    | Catalogue de modes ouvert : un mode = une donnée (libellé, politique tarifaire associée, famille), l'ajout d'un mode n'exige plus de toucher des unions fermées     |

## 5. Acteurs

| Acteur      | Rôle                                                                             |
| ----------- | -------------------------------------------------------------------------------- |
| **Parent**  | Crée des avenants, met à jour grilles/ressources, consulte l'historique          |
| **Système** | Résout les versions à la date du fait, protège le passé, trace les modifications |

## 6. User stories

### US-30-01 — Créer un avenant de contrat de garde

En tant que parent, je modifie un contrat (semaine type, heures, mensualité) **à partir
d'une date d'effet** que je choisis, sans altérer les périodes antérieures.

- **CA1** : avenant au 2026-09-01 sur un contrat crèche → les coûts de juin-août 2026
  restent calculés avec l'ancienne version ; septembre utilise la nouvelle.
- **CA2** : la date d'effet peut être future (préparé à l'avance) ; jusqu'à cette date,
  la version courante reste appliquée.
- **CA3** : deux versions ne peuvent pas se chevaucher ; la clôture de la version
  précédente est automatique (veille de la date d'effet).

### US-30-02 — Publier une nouvelle grille tarifaire

En tant que parent, je saisis la grille d'une nouvelle année (ex. tarifs 2026/27 depuis
le PDF de l'établissement) avec sa période de validité.

- **CA1** : un jour de juin 2026 est chiffré avec la grille 25/26, un jour de septembre
  2026 avec la grille 26/27 — dans le même écran de projection annuelle.
- **CA2** : publier une grille ne modifie aucun montant déjà calculé sur des périodes
  couvertes par l'ancienne grille.
- **CA3** : le calcul lit la grille versionnée du Référentiel (DV-01/DV-02) — aucune
  constante de tarif dans le code.

### US-30-03 — Mettre à jour les ressources du foyer

En tant que parent, j'enregistre les nouvelles ressources CNAF / le nouveau RFR avec leur
date d'effet (typiquement le 1er janvier).

- **CA1** : le tarif horaire PSU et la tranche ABCM changent **à partir de** la date
  d'effet ; les mois antérieurs conservent leurs montants.
- **CA2** : l'historique des ressources est consultable (quelle tranche s'appliquait en
  mars 2026 ?).

### US-30-04 — Comprendre un coût passé

En tant que parent, je consulte le détail d'un mois passé et je vois **quelles versions**
(contrat, grille, ressources) ont servi au calcul.

- **CA1** : chaque ligne de coût référence la version de grille et de contrat utilisées.
- **CA2** : l'historique des versions d'une entité est listable (date d'effet, résumé du
  changement, date/auteur de saisie).

### US-30-05 — Corriger une erreur rétroactive

En tant que parent, je corrige une version passée erronée (faute de saisie) en assumant
le recalcul des périodes impactées.

- **CA1** : l'action est distincte de l'avenant (« corriger cette version » vs « créer un
  avenant ») et affiche la liste des mois impactés avant confirmation.
- **CA2** : la correction est tracée (avant/après, date, motif optionnel).
- **CA3** : les mois dont le récap hebdo a déjà été envoyé à l'établissement sont
  signalés comme « communiqués » dans l'avertissement.

### US-30-06 — Simuler un avenant

En tant que parent, je simule l'impact € d'un avenant futur (mode simulation existant,
US-06 doc 01) sans créer de version réelle.

- **CA1** : quitter sans enregistrer ne crée aucune version.

## 7. Règles métier

- **RM-30-01** Résolution temporelle : tout calcul daté résout ses paramètres à la date
  du fait calculé (jour de garde, jour travaillé, mois de revenu).
- **RM-30-02** Continuité : les versions d'une entité forment une suite sans trou ni
  chevauchement depuis la date de début de l'entité.
- **RM-30-03** Immutabilité par défaut : seule l'action explicite de correction (US-30-05)
  peut changer une version dont la période a commencé.
- **RM-30-04** Source unique : le Référentiel versionné est la seule source des grilles,
  barèmes et seuils ; le domaine ne porte plus de valeur tarifaire (DV-01→03).
- **RM-30-05** Traçabilité : chaque version porte auteur, horodatage de saisie, et motif
  optionnel ; chaque correction rétroactive est journalisée.
- **RM-30-06** Les événements publiés (NATS) référencent l'identité de l'entité **et** la
  version, pour que les projections restent cohérentes avec l'historique.

## 8. Questions ouvertes

- **Q-30-01** Granularité de la date d'effet : jour (recommandé, aligné sur le grain de
  planning) — un avenant en cours de journée a-t-il un sens métier ? (supposé non)
- **Q-30-02** Faut-il verrouiller les mois « validés » (semaine validée + récap envoyé)
  contre toute correction, ou seulement avertir (choix actuel : avertir, CA3 US-30-05) ?
- **Q-30-03** Rétention : conserve-t-on les versions au-delà de N années (RGPD vs besoin
  de recalcul historique) ?
