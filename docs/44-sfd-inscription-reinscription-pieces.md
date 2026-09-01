# 44 — SFD Inscription & réinscription : le dossier annuel et ses pièces

> Statut : **BROUILLON — NE PAS DÉMARRER · en attente de validation PO** · Version 0.2 · 2026-09-01
> Dernière des cinq spécifications du domaine associatif ABCM (40 → 44). **Amendée le 2026-09-01
> par une décision PO qui renverse sa position de départ** : le stockage des pièces médicales est
> désormais **autorisé**, sous les cinq conditions de l'[ADR-0010](adr/0010-donnees-de-sante-du-dossier-conditions-de-stockage.md)
> — lequel révise l'[ADR-0007](adr/0007-exemption-domestique-et-demarche-volontaire.md) sur son
> seuil « donnée de santé » et renverse la fermeture décidée par la
> [SFD 38](38-sfd-rattachement-documentaire.md) le 2026-08-17 (`Q-38-01`). Le versionnement du
> RFR, lui, est **déjà livré** ([SFD 30](30-sfd-versionnement-dates-effet.md)). Consigne `AM-121`,
> `AM-122`, `AM-123`, `AM-124` ([doc 34](34-registre-ameliorations.md)).

## 0. Ce que ça demande au PO

Quatre décisions. **La première est tranchée depuis le 2026-09-01** ; les trois autres restent
ouvertes.

### 1. ✅ Tranchée — le stockage des pièces médicales est autorisé, sous conditions

La v0.1 de ce document recommandait de **ne pas** franchir le seuil de l'article 9 : tenir la
liste des pièces, jamais leur contenu. **Le PO a décidé l'inverse le 2026-09-01**, et a rouvert
l'`ADR-0007` pour le faire proprement.

Ce qui est décidé, en une phrase : **les pièces médicales du dossier — fiche sanitaire, copie des
vaccins obligatoires, PAI — sont stockées dans la GED du foyer, et nulle part ailleurs**, sous
**cinq conditions cumulatives** qui sont des **préalables techniques** et non des intentions.
L'écrit qui porte la décision est l'[ADR-0010](adr/0010-donnees-de-sante-du-dossier-conditions-de-stockage.md).

| Condition                                        | Ce qu'elle exige ici                                                                                            | Règle opposable |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | --------------- |
| **(a)** Service par le **tailnet exclusivement** | Aucune route médicale — ni contenu, ni métadonnée — servie par le bord public, qui répond **404**               | `RM-44-09`      |
| **(b)** **Chiffrement au repos**                 | Le volume qui porte la base et les médias de la GED est chiffré, vérifié par redémarrage réel                   | `RM-44-10`      |
| **(c)** **Accès restreint**                      | Le type médical est marqué restreint : hors catalogue commun, hors recherche ordinaire, hors écrans de synthèse | `RM-44-11`      |
| **(d)** **Consentement des deux parents, tracé** | Explicite, horodaté, nommant les catégories, **révocable**                                                      | `RM-44-12`      |
| **(e)** **Conservation bornée à la scolarité**   | Durée + **purge effective** (une corbeille n'est pas un effacement)                                             | `RM-44-13`      |

⚠️ **Ce que cette décision coûte, et qu'il faut garder sous les yeux.** Aucune des cinq conditions
n'existe aujourd'hui, et deux d'entre elles sont du travail à part entière : le **chiffrement au
repos** (la GED a _retiré_ sa fonction de chiffrement, voir `AM-122`) et le **consentement tracé**
(aucun mécanisme équivalent dans le produit, `AM-123`). La cinquième bute sur un fait connu : la
GED **ne purge rien** (`AM-124`). Le lot médical n'est donc pas un lot de plus — c'est le plus
lourd des cinq SFD.

> **Correction de référence.** La v0.1 renvoyait à un « `ADR-0009` » pour cette décision, en
> reprenant l'anticipation de la [SFD 38](38-sfd-rattachement-documentaire.md) §7.1. Ce numéro a
> depuis été pris par le **nom du produit** (ADR-0009, 2026-08-17). L'écrit de cette décision est
> l'**ADR-0010**.

### 2. Le RFR est déjà versionné — ce qui manque, c'est le rappel

Le foyer porte déjà ses ressources et son RFR **en versions à date d'effet**, et les tranches sont
un barème versionné du Référentiel : « une nouvelle tranche s'applique à telle date » est un
problème **résolu**. Ce qui n'existe pas, c'est le fait que **rien ne signale qu'un RFR a
vieilli** : un avis d'imposition non renouvelé laisse la tranche de l'an dernier s'appliquer
indéfiniment, en silence (`AM-121`). C'est ce que cette SFD ajoute — un rappel, pas un modèle.

### 3. Quelle date d'effet pour une nouvelle tranche ?

L'énoncé dit « au 1er janvier **ou** à réception ». Ce sont deux dates différentes, donc deux
montants différents pour les mois intermédiaires, et le passé facturé n'est pas réécrit
(`RM-30-04`). **Recommandation : à réception, sauf mention contraire de l'association** — c'est la
date que la famille peut prouver. Mais c'est un choix, et il doit être prononcé (`Q-44-01`).

### 4. Le rendez-vous de remise : suivi, ou pas du tout ?

La remise du dossier se fait **sur rendez-vous**, pris sur un service tiers (TidyCal).
**Recommandation : Martha en garde la date comme un simple repère**, sans intégration ni prise de
rendez-vous — même frontière que pour les portails.

### Ce que cette spécification ne décide pas

**L'ordonnancement.** Et la décision du 2026-09-01 a **durci** la dépendance qui était douce : le
volet médical **ne peut pas exister** sans la [SFD 38](38-sfd-rattachement-documentaire.md)
livrée en variante `a1` (second bord Tailscale), ni sans son préalable humain — **la seconde
personne du foyer rejoint le tailnet**. Le reste du dossier, lui, reste livrable seul (§8).

## 1. Contexte & problème

Le dossier d'inscription est **annuel** et **par enfant**. Il n'est traité que s'il est
**complet**, et il se remet **sur rendez-vous**. Il contient :

- une **fiche sanitaire** et une copie des **vaccins obligatoires** ;
- la liste des **personnes majeures autorisées** à récupérer l'enfant et des personnes à prévenir ;
- une **attestation d'assurance responsabilité civile** — obligatoire ;
- une copie du **dernier avis d'imposition** ou une attestation de quotient familial CAF, qui
  détermine la tranche tarifaire ;
- des **coordonnées téléphoniques**, et un **PAI** en cas de restriction médicale.

Toute modification en cours d'année — coordonnées, situation familiale, redevable — doit être
signalée par écrit. Et l'accès aux services suppose une famille **à jour de cotisation**, avec une
attribution prioritaire aux foyers dont les adultes travaillent (attestation employeur de moins de
trois mois).

Le problème, chaque été, est le même : **on ne sait pas ce qui manque**. Et pendant l'année, une
pièce périme sans que personne ne le remarque — l'assurance en premier.

### 1.1 Constat négatif — relevé sur `main` (`80e2875`), le 2026-09-01

| Point                                              | État réel                                                                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Le RFR et son effet sur la tranche                 | **Livrés.** Versions de ressources à date d'effet (`apps/svc-foyer/src/database/schema.ts`), barème de tranches versionné, classification par `libs/shared-kernel/src/lib/tranche.ts`.           |
| Le rappel de renouvellement annuel du RFR          | **Inexistant.** Une tranche périmée s'applique sans que rien ne le dise. → `AM-121`.                                                                                                             |
| La notion de dossier annuel                        | **Inexistante.**                                                                                                                                                                                 |
| Le stockage de pièces                              | **Absent, et il le reste côté application** : aucun octet de document dans creche-planner (`RM-38-01`). Le coffre est la GED — c'est lui qui gagne le droit de porter du médical (ADR-0010).     |
| Le chiffrement au repos de la GED                  | **Inexistant, et retiré du produit amont** : la GED a supprimé sa fonction de chiffrement (SFD 38 §7.7). La condition (b) est donc un travail d'exploitation, pas un réglage. → `AM-122`.        |
| Le consentement tracé                              | **Inexistant** — aucun mécanisme de consentement horodaté et révocable dans le produit. → `AM-123`.                                                                                              |
| Une purge effective côté coffre                    | **Inexistante** : une suppression y est une corbeille ; l'effacement réel laisse des médias orphelins (SFD 38 §7.5). Une durée de conservation sans purge serait décorative. → `AM-124`.         |
| La cible de rattachement `ENFANT`                  | **Fermée en v1** par la décision PO du 2026-08-17 — **rouverte** le 2026-09-01 par l'[ADR-0010](adr/0010-donnees-de-sante-du-dossier-conditions-de-stockage.md), pour le type médical seulement. |
| Les personnes autorisées à récupérer l'enfant      | **Inexistantes** — et ce sont des données personnelles de **tiers** (§7.2).                                                                                                                      |
| L'adhésion, la cotisation, l'attestation employeur | **Inexistantes.** Seule la cotisation apparaît, comme **frais fixe** de septembre, sans notion d'adhésion à jour.                                                                                |

## 2. Périmètre

### Dans le périmètre (v1)

- **Un dossier par enfant et par année**, avec son état (en préparation, remis, complet) et la
  date de son rendez-vous de remise.
- **Une liste de pièces attendues**, paramétrée : libellé, obligatoire ou non, **durée de
  validité** quand elle en a une, état (à fournir, fournie, périmée).
- **Le contenu des pièces, y compris médicales, rattaché depuis la GED** — dans la GED, jamais
  dans l'application, et **seulement** une fois les cinq conditions de l'ADR-0010 réunies.
- **Un rappel** avant la date de dossier et quand une pièce périme — par le canal existant.
- **Le renouvellement du RFR** : rappel annuel, saisie d'une nouvelle version à date d'effet,
  affichage de la tranche qui en découle et de la date à partir de laquelle elle s'applique.
- **Les personnes autorisées** à récupérer l'enfant, comme liste de noms et de téléphones.
- **Le consentement des deux parents** au stockage des pièces médicales, tracé et révocable.

### Hors du périmètre (v1) — et pourquoi

| Écarté                                                            | Raison                                                                                                                                                                                         |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stocker une pièce médicale **dans creche-planner**                | `RM-38-01` est intacte : l'application ne stocke aucun octet de document. L'ADR-0010 autorise le **coffre**, pas l'application.                                                                |
| Toute catégorie médicale hors des trois énumérées                 | L'ADR-0010 énumère limitativement : fiche sanitaire, vaccins, PAI. Un compte rendu, une ordonnance, un suivi **ne sont pas autorisés** et rouvriraient l'ADR.                                  |
| Saisir un motif médical, une allergie, un traitement en texte     | Le contenu vit dans la pièce, jamais dans un champ de l'application. Le drapeau PAI reste un booléen sans motif ; c'est ce qui garde les **écrans** hors de l'article 9 même après l'ADR-0010. |
| Afficher un intitulé médical dans un écran de synthèse ou un mail | Condition (c). Au plus « pièce médicale fournie ».                                                                                                                                             |
| Prendre un rendez-vous, écrire à l'association                    | Frontière commune aux cinq SFD : aucun envoi sortant, aucune intégration de portail.                                                                                                           |
| Suivre l'adhésion et la cotisation comme un compte                | Le produit connaît la cotisation comme une charge de septembre. En faire un statut d'adhésion ouvrirait un sujet associatif complet pour un bénéfice familial nul (`Q-44-04`).                 |
| Le dossier des autres enfants du foyer non inscrits ABCM          | Un dossier n'existe que pour un enfant inscrit.                                                                                                                                                |

## 3. Abstractions & modèle

```
Enfant ──< DossierInscription
              ├─ anneeScolaire (« 2026/2027 »)
              ├─ etablissementId
              ├─ etat : EN_PREPARATION | REMIS | COMPLET
              ├─ rendezVousLe?                    ← simple repère, aucune intégration
              └─< PieceDossier
                     ├─ typePiece      ← catalogue paramétré, jamais une énumération de code
                     │                   porte l'attribut `restreint` (condition (c))
                     ├─ obligatoire
                     ├─ valableJusquau?           ← ce qui rend le rappel de péremption possible
                     ├─ etat : A_FOURNIR | FOURNIE | PERIMEE
                     └─ documentGedId?            ← référence au coffre (SFD 38), jamais un octet

Foyer ──< ConsentementDonneesSante          ← nouveau (condition (d))
              ├─ categories : [FICHE_SANITAIRE, VACCINS, PAI]
              ├─ donnePar (les DEUX parents), donneLe
              └─ revoqueLe?                       ← une révocation ferme le dépôt et déclenche (e)

Foyer ──< PersonneAutorisee            ← nom, lien, téléphone. Données de TIERS (§7.2)
Foyer ──< VersionRessources (EXISTANTE — rien à construire)
              └─ rfrCentimes à dateEffet → tranche via le barème versionné
```

Trois principes :

1. **Martha connaît l'état d'une pièce et sa référence ; jamais son contenu.** `FOURNIE` veut dire
   « remise à l'association » ; `documentGedId` pointe le coffre. L'application ne stocke aucun
   octet, dans aucune version (`RM-38-01`, `RM-44-02`).
2. **Le catalogue de pièces est une donnée**, et il porte l'attribut `restreint` qui rend la
   condition (c) opposable — même règle que le catalogue de types de la
   [SFD 38](38-sfd-rattachement-documentaire.md) §3.1.
3. **Rien du RFR n'est reconstruit.** La saisie de la nouvelle année emprunte le chemin existant
   des versions de ressources ; cette SFD y ajoute un **rappel** et un **écran**, pas un modèle.

## 4. Acteurs

| Acteur           | Rôle                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Parent**       | Ouvre le dossier de l'année, coche les pièces, rattache les justificatifs, saisit le nouveau RFR, note le rendez-vous.   |
| **Système**      | Rappelle ce qui manque et ce qui périme, calcule la tranche applicable et sa date d'effet, tient la partition des bords. |
| **GED (coffre)** | Porte les pièces, y compris médicales, sur un volume chiffré. Jamais jointe directement par un navigateur.               |
| **Association**  | **Hors périmètre.** Reçoit le dossier sur rendez-vous ; Martha ne lui transmet rien.                                     |

## 5. User stories

### US-44-01 — Ouvrir le dossier de l'année

En tant que parent, j'ouvre le dossier 2027/2028 de ma fille et je vois d'un coup ce qui est
attendu.

- **CA1** : la liste de pièces est **préremplie** depuis le catalogue de l'établissement.
- **CA2** : les pièces encore valides de l'année précédente (assurance non expirée, par exemple)
  sont reportées avec leur date de validité — elles ne se redemandent pas pour rien.
- **CA3** : le dossier ne passe à `COMPLET` que si **toutes** les pièces obligatoires sont
  `FOURNIE` et non périmées.

### US-44-02 — Savoir ce qui manque avant le rendez-vous

En tant que parent, trois jours avant le rendez-vous, je sais ce qui manque encore.

- **CA1** : le rappel liste les pièces obligatoires non fournies, nommées par leur libellé — **sauf
  les pièces restreintes**, désignées par « pièce médicale » sans intitulé (`RM-44-11`).
- **CA2** : il passe par le **récapitulatif hebdomadaire existant** — aucun canal nouveau.
- **CA3** : il cesse dès que le dossier est complet.

### US-44-03 — Ne pas laisser périmer l'assurance

En tant que parent, je suis prévenu avant que l'attestation d'assurance expire.

- **CA1** : une pièce à durée de validité bascule en `PERIMEE` à sa date, et le dossier repasse de
  `COMPLET` à incomplet — le statut ne ment pas.
- **CA2** : le rappel arrive **avant** la péremption, avec un délai paramétrable.

### US-44-04 — Mettre à jour le RFR chaque année

En tant que parent, je saisis le RFR du nouvel avis d'imposition et je vois ce qu'il change.

- **CA1** : la saisie crée une **version de ressources à date d'effet** (mécanisme existant), et
  ne réécrit aucun mois déjà facturé.
- **CA2** : l'écran affiche la **tranche** qui en résulte et **la date à partir de laquelle** elle
  s'applique.
- **CA3** : tant qu'aucun RFR n'est fourni, l'écran dit que **le tarif maximal s'applique**, et
  qu'un RFR fourni plus tard n'aura **pas d'effet rétroactif** (`RM-44-05`).
- **CA4** : passé un an sans nouvelle version, l'écran et le rappel le signalent (`AM-121`).

### US-44-05 — Tenir la liste des personnes autorisées

En tant que parent, je note qui peut récupérer ma fille.

- **CA1** : nom, lien avec l'enfant, téléphone — rien de plus.
- **CA2** : cette liste est **exportée** avec le dossier du foyer et **effacée** avec lui (§7.2).
- **CA3** : aucun champ libre susceptible d'accueillir une information de santé.

### US-44-06 — Consentir, puis ranger les pièces médicales — **conditionnel (ADR-0010)**

En tant que parent, après avoir consenti avec l'autre parent, je range la fiche sanitaire et la
copie des vaccins avec le dossier de l'année.

- **CA1** : le dépôt d'une pièce restreinte est **impossible** tant que le consentement des
  **deux** parents n'est pas enregistré (`RM-44-12`).
- **CA2** : le dépôt, la consultation et la liste de ces pièces ne répondent **que** sur le bord
  tailnet ; le bord public rend **404**, y compris pour les métadonnées (`RM-44-09`).
- **CA3** : hors tailnet, l'écran dit « vos pièces médicales sont visibles depuis les appareils du
  foyer » — pas une erreur, pas un chargement infini.
- **CA4** : révoquer le consentement ferme immédiatement le dépôt et déclenche la procédure
  d'effacement de `RM-44-13`.
- **CA5** : aucun écran de synthèse, aucun récapitulatif, aucun courriel ne cite l'intitulé d'une
  pièce restreinte.

### US-44-07 — Voir expirer une pièce médicale sans la lire

En tant que parent, je vois qu'une pièce médicale arrive au terme de sa conservation.

- **CA1** : la borne est la **scolarité de l'enfant dans l'établissement**, plus l'année en cours.
- **CA2** : l'effacement est **effectif** dans le coffre, pas une mise à la corbeille, et les
  médias orphelins sont traités (`RM-44-13`, `AM-124`).

## 6. Règles métier

- **RM-44-01 — Un dossier est annuel et par enfant.** Le renouveler est une **création**, pas une
  modification : l'an dernier reste lisible.
- **RM-44-02 — Martha ne stocke aucun octet de document ; le coffre, lui, peut porter du médical.**
  L'application connaît un **état** et une **référence** (`documentGedId`), jamais un contenu.
  L'autorisation de l'[ADR-0010](adr/0010-donnees-de-sante-du-dossier-conditions-de-stockage.md)
  porte sur la GED, et **uniquement** sur les trois pièces qu'il énumère.
- **RM-44-03 — Le catalogue de pièces est une donnée** paramétrée par établissement, et il porte
  l'attribut `restreint`.
- **RM-44-04 — Une pièce périmée rend le dossier incomplet.** Un statut qui reste vert après
  péremption est un statut qui ment.
- **RM-44-05 — Pas de RFR, tarif maximal, sans rétroactivité.** Fournir le RFR plus tard ne
  recalcule pas les mois déjà passés — c'est la règle de l'association, et elle coïncide avec le
  principe d'immuabilité du passé de la [SFD 30](30-sfd-versionnement-dates-effet.md).
- **RM-44-06 — Le RFR se renouvelle chaque année, et son absence se voit.** Une version de plus
  d'un an est signalée, jamais tacitement reconduite.
- **RM-44-07 — Aucun envoi sortant, aucune prise de rendez-vous.** Le rendez-vous est une date
  notée à la main.
- **RM-44-08 — Traçabilité.** Les mutations de dossier, de pièces, de consentement et de personnes
  autorisées s'inscrivent à la piste d'audit acteur dès le premier commit.

### Les cinq conditions de l'ADR-0010, rendues opposables

Chacune est un **préalable** : tant qu'elle n'est pas vérifiable, aucune pièce médicale n'entre.

- **RM-44-09 — Bord tailnet exclusif.** Une route qui sert une pièce restreinte — contenu **ou**
  métadonnée — n'existe que sur le bord Tailscale. Le bord public répond **404**, jamais 403 :
  l'existence d'une pièce médicale n'est pas une information à donner. La partition est **gardée
  par la CI**, avec une **sonde négative** : déclarer une route restreinte sur le bord public doit
  faire échouer le job. Corollaire humain : sans la seconde personne du foyer sur le tailnet, un
  parent n'accède pas au dossier de son propre enfant — le volet médical ne démarre pas.
- **RM-44-10 — Chiffrement au repos.** Le volume portant la base et les médias du coffre est
  chiffré, et la vérification se fait par **redémarrage réel de la pile qui porte le réglage**,
  jamais par relecture de fichier (`LE-53`, `LE-58`). La limite est écrite avec la règle : cela
  protège un disque emporté, **pas** un serveur allumé — le prétendre serait un faux garde-fou.
- **RM-44-11 — Type restreint, hors du commun.** Une pièce restreinte n'apparaît ni au catalogue
  commun, ni dans la recherche plein texte ordinaire, ni dans un écran de synthèse, ni dans un
  courriel. Elle s'y désigne au plus par « pièce médicale ».
- **RM-44-12 — Consentement des deux parents, tracé et révocable.** Explicite, horodaté, nommant
  les catégories concernées. Sans lui, le dépôt est **refusé** — pas découragé. La révocation
  ferme le dépôt et déclenche `RM-44-13`.
- **RM-44-13 — Conservation bornée, purge effective.** Durée = scolarité dans l'établissement +
  l'année en cours. L'effacement est réel (pas une corbeille), et les médias orphelins qu'il laisse
  sont traités. **Une durée sans mécanisme de purge ne s'écrit pas** : le registre des traitements
  exige qu'une durée nomme la colonne qui la porte, et que cette colonne existe.

## 7. RGPD — deux points qui ne se règlent pas à l'exécution

### 7.1 Le seuil de l'article 9 est franchi — volontairement, et par écrit

L'[ADR-0007](adr/0007-exemption-domestique-et-demarche-volontaire.md) posait quatre seuils de
réouverture ; le quatrième — « une donnée de santé est stockée » — est **franchi par décision**,
ce qui n'était pas le cas qu'il envisageait : il le décrivait comme un accident possible, pas
comme un choix. L'[ADR-0010](adr/0010-donnees-de-sante-du-dossier-conditions-de-stockage.md) le
révise sur ce seul point ; les trois autres seuils restent en vigueur.

Ce que le franchissement rend **dû**, et qui n'est pas fait par cette SFD :

- la **base légale** et l'**analyse d'impact** que l'ADR-0007 annonçait en cas de réouverture ;
- la mise à jour du [registre des traitements](37-registre-des-traitements.md) **avant le premier
  commit** du lot : le traitement documentaire gagne une catégorie « données de santé », et la
  qualification du drapeau `pai` — tenue jusqu'ici pour une donnée de facturation « faute de
  pièce jointe » — est **rouverte par construction** ;
- les **droits non outillés** (effacement, portabilité) sur cette catégorie précisément.

Trois gardes de conception subsistent malgré l'autorisation, et elles ne sont pas facultatives :

- **aucun champ libre** sur une pièce ni sur une personne autorisée — le contenu médical vit dans
  le document, jamais dans une colonne de l'application ;
- **aucun libellé clinique** au catalogue : « fiche sanitaire » est un intitulé administratif,
  « allergie aux arachides » ne doit pouvoir s'écrire nulle part ;
- **aucune catégorie hors des trois énumérées** par l'ADR-0010.

### 7.2 Des données de tiers, une première pour ce produit

Les **personnes autorisées** (grands-parents, voisins, nourrice) sont des personnes qui ne sont
ni le parent ni l'enfant, et qui **n'ont pas de relation avec l'application**. C'est une catégorie
que le [registre des traitements](37-registre-des-traitements.md) ne connaît pas encore.

Trois conséquences à écrire dans le registre, avant le premier commit :

1. une **finalité** propre — savoir à qui l'enfant peut être confié ;
2. une **conservation** liée au dossier, pas au foyer : une personne retirée de la liste disparaît
   à la clôture de l'année ;
3. un **minimum de données** : nom, lien, téléphone. Pas d'adresse, pas de date de naissance, pas
   de photo.

Et une limite honnête : ces personnes ne seront jamais informées de leur inscription. Dans un
usage strictement domestique, c'est l'exemption d'`ADR-0007` qui le permet — la limite est écrite
ici pour qu'elle soit **visible**, comme les deux exceptions déjà documentées au registre.

## 8. Découpage en lots

Le chantier se coupe en deux : un **volet ordinaire**, livrable seul, et un **volet médical** qui
ne démarre qu'une fois ses cinq préalables réunis.

| Lot   | Contenu                                                                                                                                            | Ce qui le clôt                                                                               |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **0** | Trancher `Q-44-01`. Écrire les lignes du registre des traitements (§7).                                                                            | Le registre porte les nouvelles finalités, données de tiers et santé comprises.              |
| **1** | Rappel de renouvellement du RFR sur le mécanisme existant, et affichage de la tranche.                                                             | Une version de ressources de plus d'un an est signalée ; aucun modèle nouveau n'a été écrit. |
| **2** | Dossier annuel, catalogue de pièces (attribut `restreint` compris), états, report des valides.                                                     | Un dossier ne passe `COMPLET` qu'avec toutes ses obligatoires valides.                       |
| **3** | Rappels : avant le rendez-vous, avant péremption — par le récapitulatif existant.                                                                  | Une sonde négative prouve qu'aucun second courriel n'est émis.                               |
| **4** | Personnes autorisées, avec le minimum de données et l'export/effacement associés.                                                                  | `pnpm portabilite` et `pnpm retentions` verts sans exception ajoutée.                        |
| **5** | Rattachement d'un justificatif **non médical** au dossier, via la SFD 38.                                                                          | Ne démarre que si la SFD 38 est livrée. Ne touche aucune pièce restreinte.                   |
| **6** | **Préalables du volet médical** : bord tailnet exclusif + porte de CI, chiffrement du volume, type restreint, consentement tracé, purge effective. | Les cinq `RM-44-09` → `RM-44-13` sont vérifiées, **chacune par sa sonde négative**.          |
| **7** | Volet médical : dépôt, consultation, révocation, expiration (US-44-06 et US-44-07).                                                                | Une pièce médicale existe dans le coffre et **aucune route publique ne l'admet**.            |

> **Le lot 6 ne se scinde pas.** Livrer trois conditions sur cinq et stocker « en attendant » ferait
> exactement ce que l'ADR-0010 interdit : les cinq sont cumulatives.
>
> **Le lot 1 reste livrable seul**, sans le reste : c'est le plus petit morceau de valeur réelle du
> bloc 40 → 44, et il ne dépend d'aucune décision ouverte.

## 9. Questions ouvertes

- ~~**Q-44-05** — Faut-il stocker les pièces médicales du dossier ?~~ → **tranchée le 2026-09-01** :
  **oui**, dans la GED seulement, sous les cinq conditions cumulatives de l'ADR-0010, pour trois
  catégories limitativement énumérées. Conservée écrite : une question effacée redevient une
  question six mois plus tard.
- **Q-44-01** — Une nouvelle tranche s'applique-t-elle **au 1er janvier** ou **à la réception** du
  justificatif ? Les deux dates donnent des montants différents pour les mois intermédiaires.
  Défaut proposé : à réception.
- **Q-44-02** — Quelles pièces ont une **durée de validité** opposable ? L'attestation d'assurance
  et l'attestation employeur (« moins de trois mois ») en ont une ; les autres sont annuelles par
  construction. À confirmer avant d'écrire des rappels de péremption qui sonneraient à tort.
- **Q-44-03** — Le dossier est-il **par enfant et par établissement**, ou par enfant seulement ?
  Un enfant scolarisé sur un site et à l'ALSH d'un autre changerait la clé.
- **Q-44-04** — Faut-il suivre l'**adhésion** et l'**attestation employeur** (attribution
  prioritaire) ? Ce sont des conditions d'accès, pas des coûts. Recommandation : les traiter comme
  des pièces du dossier, sans en faire un statut d'adhérent.
- **Q-44-06** — **Comment chiffrer au repos, concrètement ?** Volume chiffré par dm-crypt sur le
  serveur, conteneur de fichiers chiffré, ou changement de GED pour une qui chiffre nativement ?
  L'ADR-0010 pose l'exigence ; le moyen se tranche à l'exécution, avec son coût d'exploitation et
  son effet sur les sauvegardes déjà chiffrées.

## 10. Ce que cette spécification engage

- **Un ADR** — l'[ADR-0010](adr/0010-donnees-de-sante-du-dossier-conditions-de-stockage.md) — écrit
  **avant** le premier commit du volet médical, et les cinq conditions qu'il pose comme préalables.
- **Deux finalités nouvelles** au [registre des traitements](37-registre-des-traitements.md), dont
  l'une porte des **données de tiers** et l'autre des **données de santé** ; plus la réouverture de
  la qualification du drapeau `pai`.
- **Un geste d'exploitation irréversible en pratique** : le chiffrement du volume qui porte le
  coffre, avec la reprise des données déjà présentes.
- **Un préalable humain bloquant** : la seconde personne du foyer rejoint le tailnet, sinon le
  volet médical ne sert qu'un des deux parents.
- **Aucun modèle nouveau pour le RFR** : le versionnement existe, on lui ajoute un rappel.
- **Aucune intégration** : ni prise de rendez-vous, ni envoi à l'association.
- **Une dépendance devenue dure à la [SFD 38](38-sfd-rattachement-documentaire.md)** en variante
  `a1` : sans le second bord, la condition (a) est invérifiable, donc le volet médical n'existe pas.
