# 31 — SFD Calendriers d'ouverture & vacances scolaires

> Statut : **Brouillon — à valider PO** · Version 0.1 · 2026-07-19
> S'appuie sur le versionnement à date d'effet (doc 30). Alimente le planning ABCM
> (doc 01 US-04), les coûts (doc 02) et le planning famille (doc 33).

## 1. Contexte & problème

Le planning scolaire ignore aujourd'hui les **vacances scolaires** : les jours d'école et
les jours ALSH ne sont distingués que par les « jours non facturables » saisis au
Référentiel, et la semaine scolaire (lundi/mardi/jeudi/vendredi, mercredi = ALSH) est
une constante de code quasi morte (`JOURS_OUVERTURE_ECOLE`). Résultat : rien ne matérialise
« du 18 avril au 4 mai c'est les vacances de printemps, l'école est fermée, l'ALSH prend
le relais », ni les fermetures propres de la crèche, ni les journées pédagogiques.

## 2. Abstraction : le calendrier d'ouverture

Chaque **établissement** (entité libre existante) est rattaché à un **calendrier
d'ouverture**, composé de trois couches, résolues dans cet ordre de priorité
(1 = la plus forte) :

1. **Exceptions ponctuelles** (saisies) : fermeture exceptionnelle, journée pédagogique,
   pont, ouverture exceptionnelle.
2. **Périodes** (importées ou saisies) : périodes scolaires vs vacances, période de
   fermeture annuelle (crèche en août), avec date de début/fin.
3. **Récurrence hebdomadaire** (paramétrée par établissement et par **régime**) : jours
   et services ouverts en période scolaire vs en période de vacances.

Le cas de référence est une **instanciation** de ce modèle, pas du code :

| Établissement (instance) | Récurrence période scolaire                                        | Récurrence vacances                        | Source des périodes                                       |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------- |
| École (type scolaire)    | École + périscolaire + cantine : lun/mar/jeu/ven ; ALSH : mercredi | ALSH journée/½ journée uniquement          | Calendrier officiel **zone B** importé + retouches        |
| Crèche (type PSU)        | lun→ven selon contrat                                              | idem (pas de notion de vacances scolaires) | Fermetures propres saisies (actuel `jour_non_facturable`) |

Un même « jour calendaire » peut donc offrir des **services différents selon la période** :
c'est le calendrier qui dit, pour un établissement et un jour J, quels services sont
réservables (école, périscolaire matin/soir, cantine, ALSH journée/½ journée… — services
issus du catalogue de modes ouvert, DV-04 doc 30).

## 3. Source du calendrier scolaire — validé PO 2026-07-19

**Import automatique + retouches manuelles.**

- Import depuis l'open data Éducation nationale (jeu « calendrier scolaire »,
  data.education.gouv.fr), **zone paramétrable par établissement** (zone B / académie de
  Strasbourg pour le cas de référence — c'est une donnée, pas une constante).
- L'import est **matérialisé localement** (pas de dépendance runtime à l'API) et
  versionné par année scolaire : réimporter une année met à jour les périodes non
  retouchées et **préserve les retouches manuelles** (les exceptions priment, couche 1).
- Les retouches couvrent : jours propres à l'école (journées pédagogiques, ponts),
  fermetures ALSH spécifiques, écarts entre le calendrier officiel et celui distribué
  par l'établissement.

## 4. Acteurs

| Acteur      | Rôle                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| **Parent**  | Déclenche l'import, retouche les exceptions, consulte                                                                 |
| **Système** | Résout « quels services ce jour-là », gère priorité des couches, alimente planification/tarification/planning famille |

## 5. User stories

### US-31-01 — Importer une année scolaire

En tant que parent, j'importe le calendrier officiel de la zone de l'établissement pour
l'année scolaire à venir.

- **CA1** : après import, les périodes (rentrée, Toussaint, Noël, hiver, printemps, été)
  apparaissent avec leurs dates zone B.
- **CA2** : un réimport ne détruit aucune retouche manuelle.
- **CA3** : l'échec de la source externe n'empêche pas l'app de fonctionner (l'import est
  différé, une saisie manuelle des périodes reste possible).

### US-31-02 — Retoucher le calendrier

En tant que parent, j'ajoute des exceptions : journée pédagogique le vendredi 13 mars,
pont de l'Ascension, fermeture ALSH une semaine donnée, semaine de fermeture crèche.

- **CA1** : une exception de fermeture rend les services concernés non réservables ce
  jour-là, même en période scolaire.
- **CA2** : chaque exception porte un libellé visible dans les plannings.

### US-31-03 — Sélectionner des jours cohérents avec le calendrier

En tant que parent, quand je planifie, seuls les jours/services réellement ouverts sont
sélectionnables (renforce CA1 US-04 doc 01).

- **CA1** : en période scolaire, l'école/périscolaire/cantine ne sont proposés que les
  jours d'ouverture (lun/mar/jeu/ven pour l'instance de référence) ; le mercredi propose
  l'ALSH.
- **CA2** : pendant les vacances, l'école/périscolaire/cantine ne sont pas proposés ;
  l'ALSH journée/½ journée l'est (si ouvert).
- **CA3** : un jour fermé (exception, férié) n'est pas sélectionnable et affiche son
  motif.
- **CA4** : les jours déjà réservés qui deviennent fermés après une retouche sont
  signalés (liste d'incohérences), pas supprimés silencieusement.

### US-31-04 — Visualiser les périodes

En tant que parent, je vois les périodes scolaires/vacances/fermetures sur les
calendriers mensuels (planning et dashboard) avec un langage clair (« Vacances de
printemps », « Crèche fermée »).

- **CA1** : la vue mensuelle distingue visuellement période scolaire, vacances, jour
  fermé.

### US-31-05 — Anticiper les vacances

En tant que parent, je suis alerté des périodes de vacances à venir pour lesquelles
aucune solution de garde n'est planifiée pour un enfant scolarisé (détail des conflits :
doc 33).

- **CA1** : à l'approche d'une période de vacances (délai paramétrable, défaut 4
  semaines), une notification récapitule les jours sans solution.

## 6. Règles métier

- **RM-31-01** Priorité des couches : exception > période > récurrence hebdomadaire.
- **RM-31-02** Les jours fériés français font partie du référentiel importé (fermeture
  par défaut de tous les établissements, surchargée par exception d'ouverture).
- **RM-31-03** Le calendrier est versionné à date d'effet (doc 30) : une retouche ne
  réécrit pas l'interprétation des jours passés déjà facturés.
- **RM-31-04** Tarification : un jour non ouvert n'est jamais facturable ; l'actuel
  `jour_non_facturable` du Référentiel devient une projection du calendrier d'ouverture
  (source unique, RM-30-04).
- **RM-31-05** La zone scolaire, les jours d'ouverture et l'association service↔période
  sont des **données par établissement** — aucune zone, aucun jour de semaine, aucun nom
  d'établissement en dur dans le code (principe doc 30 §4).

## 7. Questions ouvertes

- **Q-31-01** L'école du cas de référence (calendrier associatif bilingue) suit-elle
  exactement la zone B ou publie-t-elle son propre calendrier ? → à vérifier à la
  rentrée ; l'import + retouches couvre les deux cas.
- **Q-31-02** Année scolaire pivot : l'import doit-il chercher automatiquement l'année
  N+1 dès sa publication (été) ou sur action manuelle uniquement ?
- **Q-31-03** Les fermetures crèche annuelles (été/Noël) doivent-elles être importables
  d'un modèle réutilisable d'une année sur l'autre ?
