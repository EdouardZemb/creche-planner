# 33 — SFD Planning famille : vue commune « qui fait quoi, où, avec qui »

> Statut : **Brouillon — à valider PO** · Version 0.1 · 2026-07-19
> Agrège les plannings de garde (docs 01/16), les calendriers d'ouverture (doc 31) et le
> travail des parents (doc 32). Dernier chantier de la séquence 30 → 33.

## 1. Contexte & vision

Chaque membre du foyer a aujourd'hui son planning en silo : les enfants côté garde
(crèche, école, ALSH), les parents nulle part. Le besoin : **une vue commune du foyer**
où, pour un jour ou une semaine, on voit qui est où (et avec qui), qui dépose et qui
récupère les enfants, et où le système **détecte les jours incohérents** — un enfant sans
solution de garde alors que les deux parents travaillent, des vacances scolaires sans
plan.

## 2. Abstraction : membres et engagements

La vue ne connaît ni « école », ni « bureau », ni « crèche » en dur : elle agrège des
**engagements**.

```
MembreDuFoyer (parent | enfant)
Engagement = { membre, jour, créneau (optionnel), catégorie, lieu/établissement,
               source, participants (optionnel) }
```

- **Sources dérivées** (lecture seule ici, éditées à leur écran d'origine) :
  - planning de garde d'un enfant → engagement « accueil » (crèche, école, ALSH…) ;
  - planning de travail d'un parent (doc 32) → engagement « travail » avec lieu
    (domicile, site, déplacement) ; une absence typée → engagement « congé »,
    « maladie »… ;
  - calendrier d'ouverture (doc 31) → contexte de jour (vacances, férié, fermeture).
- **Sources saisies** dans la vue famille :
  - **trajets** : dépose/récupération d'un enfant, affectés à un parent, avec horaire ;
  - **événements libres** : RDV médecin, activité, anniversaire — avec un ou plusieurs
    participants (le « avec qui »).

Une **règle de conflit** est un prédicat sur les engagements d'un jour (§6). Le catalogue
de règles est extensible sans toucher à la vue.

## 3. Périmètre

### Dans le périmètre (v1)

- Vue **jour** et vue **semaine** du foyer, tous membres, mobile d'abord (375 px).
- Trajets dépose/récupération par enfant et par jour.
- Événements libres multi-participants.
- Détection et affichage des conflits + notification (canal existant).

### Hors périmètre (v1) — backlog

- Partage/synchronisation calendrier externe (iCal, Google Calendar).
- Tiers de confiance hors foyer (grands-parents, nounou) comme membres invités — le
  modèle « membre » doit toutefois ne pas l'empêcher.
- Optimisation/suggestion automatique d'affectation des trajets.

## 4. Acteurs

| Acteur      | Rôle                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------- |
| **Parent**  | Consulte la vue commune, affecte les trajets, saisit les événements, résout les conflits |
| **Système** | Agrège les engagements, évalue les règles de conflit, notifie                            |

## 5. User stories

### US-33-01 — Voir la journée du foyer

En tant que parent, je vois pour un jour donné chaque membre du foyer avec ses
engagements ordonnés dans le temps.

- **CA1** : exemple de référence — un mardi scolaire : enfant 1 « École + cantine +
  périscolaire soir », enfant 2 « Crèche 8h30–16h30 », parent A « Travail (domicile) »,
  parent B « Travail (site) 8h–12h ».
- **CA2** : les libellés utilisent le langage parent (conventions existantes, doc 07) et
  les noms d'établissements du foyer — jamais de codes techniques.
- **CA3** : le contexte du jour est affiché (« Vacances de printemps », « Férié »).

### US-33-02 — Voir la semaine

En tant que parent, je vois la semaine en grille membres × jours, avec les badges de
conflits, et je navigue de semaine en semaine.

- **CA1** : lisible à 375 px (une journée dépliable), grille complète au-delà.
- **CA2** : un jour en conflit est signalé au niveau du jour et de la semaine.

### US-33-03 — Affecter les trajets

En tant que parent, j'affecte qui dépose et qui récupère chaque enfant, par jour, avec
un horaire.

- **CA1** : affectation rapide depuis la vue (choisir le parent, horaire prérempli par
  les horaires d'accueil).
- **CA2** : une semaine type de trajets est proposable puis ajustée par jour (même
  logique base + exceptions que doc 32).
- **CA3** : un trajet affecté à un parent indisponible sur ce créneau (absence,
  déplacement) déclenche un conflit (§6).

### US-33-04 — Ajouter un événement libre

En tant que parent, j'ajoute un événement ponctuel (RDV pédiatre, activité) avec ses
participants.

- **CA1** : l'événement apparaît chez chaque participant.
- **CA2** : il peut être marqué « nécessite un accompagnant adulte » → conflit si aucun
  parent participant n'est disponible.

### US-33-05 — Être alerté des conflits

En tant que parent, je suis alerté des jours incohérents, à la saisie et en anticipation.

- **CA1** : à la saisie d'un engagement créant un conflit, le conflit est visible
  immédiatement (pas de blocage : on peut enregistrer et résoudre plus tard).
- **CA2** : une notification hebdomadaire (canal préférences existant) récapitule les
  conflits des N prochaines semaines (N paramétrable, défaut 4) — inclut l'alerte
  vacances de US-31-05.
- **CA3** : un conflit est « acquittable » avec un motif (ex. « garde par la
  grand-mère ») : il reste visible mais n'alerte plus.

## 6. Règles de conflit (catalogue v1)

| ID    | Règle                                                                                                                                                                            |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CF-01 | **Enfant sans solution** : un jour où un enfant n'a aucun engagement d'accueil ni d'adulte du foyer disponible (les deux parents en engagement travail hors domicile ou absents) |
| CF-02 | **Établissement fermé** : un engagement d'accueil sur un jour où le calendrier d'ouverture (doc 31) dit fermé (recouvre CA4 US-31-03)                                            |
| CF-03 | **Vacances sans plan** : jour de vacances scolaires pour un enfant scolarisé, sans engagement d'accueil ni acquittement                                                          |
| CF-04 | **Trajet non affecté** : jour avec accueil mais dépose ou récupération sans parent affecté                                                                                       |
| CF-05 | **Trajet impossible** : trajet affecté à un parent indisponible sur le créneau                                                                                                   |
| CF-06 | **Chevauchement** : deux engagements incompatibles pour un même membre sur le même créneau                                                                                       |

- **RM-33-01** Les règles s'évaluent sur les engagements agrégés, quelle qu'en soit la
  source — ajouter une source (ex. futur membre invité) ne change pas les règles.
- **RM-33-02** Un conflit acquitté est journalisé (qui, quand, motif) et réévalué si les
  engagements du jour changent.
- **RM-33-03** « Disponible » pour un parent = sans engagement travail sur le créneau,
  ou travail à domicile si la règle du foyer l'autorise (**paramètre du foyer** :
  télétravail = disponible pour un trajet ? défaut : oui pour les trajets, non pour la
  garde en journée).
- **RM-33-04** La vue est en lecture agrégée : modifier un engagement dérivé renvoie
  vers son écran source (deep-links existants, pattern dashboard doc 16).

## 7. Questions ouvertes

- **Q-33-01** Le paramètre « télétravail = disponible » (RM-33-03) suffit-il, ou faut-il
  un réglage par créneau (pause méridienne dispo, réunions non) ? → v1 : paramètre
  foyer global.
- **Q-33-02** Les enfants doivent-ils pouvoir porter des engagements récurrents propres
  (activité hebdomadaire) dès la v1, ou événement libre répété suffit-il ?
- **Q-33-03** Faut-il un mode « planification de vacances » dédié (résoudre CF-03 en
  bloc sur une période) dès la v1 ?
