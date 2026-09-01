# 44 — SFD Inscription & réinscription : le dossier annuel et ses pièces

> Statut : **BROUILLON — NE PAS DÉMARRER · en attente de validation PO** · Version 0.1 · 2026-09-01
> Dernière des cinq spécifications du domaine associatif ABCM (40 → 44). **Se heurte volontairement
> à deux décisions déjà prises** : la fermeture de la cible `ENFANT` et l'absence de type médical au
> catalogue documentaire ([SFD 38](38-sfd-rattachement-documentaire.md) §0, `Q-38-01`), et
> l'exemption domestique d'`ADR-0007`. Le versionnement du RFR, lui, est **déjà livré**
> ([SFD 30](30-sfd-versionnement-dates-effet.md)). Consigne `AM-121`
> ([doc 34](34-registre-ameliorations.md)).

## 0. Ce que ça demande au PO

Quatre décisions, dont une qui peut arrêter le chantier.

### 1. La décision qui peut tout arrêter : Martha ne doit pas devenir un dossier médical

Le dossier d'inscription exige une **fiche sanitaire**, une **copie des vaccins obligatoires**, et
un **PAI** le cas échéant. Ce sont des données de santé au sens de l'article 9 — la catégorie que
le produit s'interdit depuis `ADR-0007`, et que la [SFD 38](38-sfd-rattachement-documentaire.md)
a explicitement refermée le 2026-08-17 en décidant **aucun type médical au catalogue** et
**cible `ENFANT` fermée**.

Trois positions, et une seule tient sans rouvrir un ADR :

- **(a) Tenir la liste, pas les pièces.** Martha sait **qu'une** attestation d'assurance est
  attendue, qu'elle a été remise, et qu'elle expire ; elle ne sait **rien** de son contenu et ne
  stocke aucun fichier. Pour les pièces médicales, elle ne connaît qu'un état — « fournie » ou
  « à fournir » — sans intitulé détaillé.
- **(b) Rouvrir `ADR-0009`** pour ouvrir la cible `ENFANT` et un type médical, et faire le travail
  qui va avec (base légale, analyse d'impact, droits outillés).
- **(c) Ne pas traiter le dossier du tout.**

**Recommandation : (a), sans négociation.** C'est la seule qui délivre la valeur réelle — _ne rien
oublier avant le rendez-vous_ — sans franchir un seuil que deux documents ont fermé il y a deux
semaines. Et elle a une conséquence à écrire noir sur blanc : **ouvrir plus tard le stockage d'un
carnet de vaccination n'est pas une évolution, c'est une réouverture d'ADR** (`RM-44-02`).

### 2. Le RFR est déjà versionné — ce qui manque, c'est le rappel

Le foyer porte déjà ses ressources et son RFR **en versions à date d'effet**, et les tranches sont
un barème versionné du Référentiel : « une nouvelle tranche s'applique à telle date » est un
problème **résolu**. Ce qui n'existe pas, c'est le fait que **rien ne signale qu'un RFR a vieilli** :
un avis d'imposition non renouvelé laisse la tranche de l'an dernier s'appliquer indéfiniment, en
silence (`AM-121`). C'est ce que cette SFD ajoute — un rappel, pas un modèle.

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

**L'ordonnancement.** En position (a), elle ne dépend d'aucune autre SFD du bloc, mais elle
**perd la moitié de sa valeur** tant que la [SFD 38](38-sfd-rattachement-documentaire.md) n'est pas
livrée : une liste de pièces sans coffre reste une liste. Voir §7.

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

| Point                                              | État réel                                                                                                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le RFR et son effet sur la tranche                 | **Livrés.** Versions de ressources à date d'effet (`apps/svc-foyer/src/database/schema.ts`), barème de tranches versionné, classification par `libs/shared-kernel/src/lib/tranche.ts`. |
| Le rappel de renouvellement annuel du RFR          | **Inexistant.** Une tranche périmée s'applique sans que rien ne le dise. → `AM-121`.                                                                                                   |
| La notion de dossier annuel                        | **Inexistante.**                                                                                                                                                                       |
| Le stockage de pièces                              | **Volontairement absent** : le produit ne stocke aucun octet de document ; le coffre est Paperless, et la [SFD 38](38-sfd-rattachement-documentaire.md) l'a écrit.                     |
| La cible de rattachement `ENFANT`                  | **Fermée en v1** par décision PO du 2026-08-17 — avec le catalogue sans type médical, c'est la contrepartie explicite de l'exemption d'`ADR-0007`.                                     |
| Les personnes autorisées à récupérer l'enfant      | **Inexistantes** — et ce sont des données personnelles de **tiers** (§7).                                                                                                              |
| L'adhésion, la cotisation, l'attestation employeur | **Inexistantes.** Seule la cotisation apparaît, comme **frais fixe** de septembre, sans notion d'adhésion à jour.                                                                      |

## 2. Périmètre

### Dans le périmètre (v1)

- **Un dossier par enfant et par année**, avec son état (en préparation, remis, complet) et la
  date de son rendez-vous de remise.
- **Une liste de pièces attendues**, paramétrée : libellé, obligatoire ou non, **durée de
  validité** quand elle en a une, état (à fournir, fournie, périmée).
- **Un rappel** avant la date de dossier et quand une pièce périme — par le canal existant.
- **Le renouvellement du RFR** : rappel annuel, saisie d'une nouvelle version à date d'effet,
  affichage de la tranche qui en découle et de la date à partir de laquelle elle s'applique.
- **Les personnes autorisées** à récupérer l'enfant, comme liste de noms et de téléphones.

### Hors du périmètre (v1) — et pourquoi

| Écarté                                                        | Raison                                                                                                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stocker une fiche sanitaire, un carnet de vaccination, un PAI | Donnée de santé, seuil d'`ADR-0007`, cible `ENFANT` fermée (§0, décision 1). Martha n'en connaît que l'**état**.                                                               |
| Détailler un motif médical, une allergie, un traitement       | Même raison. Le drapeau PAI existant reste **sans motif ni pièce** — c'est ce qui le maintient hors de l'article 9.                                                            |
| Déposer une pièce depuis Martha                               | C'est le métier de la [SFD 38](38-sfd-rattachement-documentaire.md), non livrée. En attendant, la pièce vit là où la famille la range.                                         |
| Prendre un rendez-vous, écrire à l'association                | Frontière commune aux cinq SFD : aucun envoi sortant, aucune intégration de portail.                                                                                           |
| Suivre l'adhésion et la cotisation comme un compte            | Le produit connaît la cotisation comme une charge de septembre. En faire un statut d'adhésion ouvrirait un sujet associatif complet pour un bénéfice familial nul (`Q-44-04`). |
| Le dossier des autres enfants du foyer non inscrits ABCM      | Un dossier n'existe que pour un enfant inscrit.                                                                                                                                |

## 3. Abstractions & modèle

```
Enfant ──< DossierInscription
              ├─ anneeScolaire (« 2026/2027 »)
              ├─ etablissementId
              ├─ etat : EN_PREPARATION | REMIS | COMPLET
              ├─ rendezVousLe?                    ← simple repère, aucune intégration
              └─< PieceDossier
                     ├─ typePiece      ← catalogue paramétré, jamais une énumération de code
                     ├─ obligatoire
                     ├─ valableJusquau?           ← ce qui rend le rappel de péremption possible
                     └─ etat : A_FOURNIR | FOURNIE | PERIMEE

Foyer ──< PersonneAutorisee            ← nom, lien, téléphone. Données de TIERS (§7)
Foyer ──< VersionRessources (EXISTANTE — rien à construire)
              └─ rfrCentimes à dateEffet → tranche via le barème versionné
```

Trois principes :

1. **Martha connaît l'état d'une pièce, jamais son contenu.** `FOURNIE` ne veut pas dire
   « stockée » : il veut dire « la famille l'a remise à l'association ». C'est ce qui garde le
   dossier hors de l'article 9 (`RM-44-02`).
2. **Le catalogue de pièces est une donnée.** Ajouter « attestation employeur » est une ligne, pas
   un développement — même règle que le catalogue de types de la
   [SFD 38](38-sfd-rattachement-documentaire.md) §3.1.
3. **Rien du RFR n'est reconstruit.** La saisie de la nouvelle année emprunte le chemin existant
   des versions de ressources ; cette SFD y ajoute un **rappel** et un **écran**, pas un modèle.

## 4. Acteurs

| Acteur          | Rôle                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ |
| **Parent**      | Ouvre le dossier de l'année, coche les pièces, saisit le nouveau RFR, note le rendez-vous. |
| **Système**     | Rappelle ce qui manque et ce qui périme, calcule la tranche applicable et sa date d'effet. |
| **Association** | **Hors périmètre.** Reçoit le dossier sur rendez-vous ; Martha ne lui transmet rien.       |

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

- **CA1** : le rappel liste les pièces obligatoires non fournies, nommées par leur libellé.
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
- **CA2** : cette liste est **exportée** avec le dossier du foyer et **effacée** avec lui (§7).
- **CA3** : aucun champ libre susceptible d'accueillir une information de santé.

## 6. Règles métier

- **RM-44-01 — Un dossier est annuel et par enfant.** Le renouveler est une **création**, pas une
  modification : l'an dernier reste lisible.
- **RM-44-02 — Martha ne stocke aucune pièce, et aucune donnée de santé.** Elle connaît un état
  (`A_FOURNIR`, `FOURNIE`, `PERIMEE`), jamais un contenu. **Ouvrir cette porte est une réouverture
  d'`ADR-0007` et d'`ADR-0009`**, avec le travail que la [SFD 38](38-sfd-rattachement-documentaire.md)
  §7.1 décrit — pas une évolution incrémentale.
- **RM-44-03 — Le catalogue de pièces est une donnée** paramétrée par établissement.
- **RM-44-04 — Une pièce périmée rend le dossier incomplet.** Un statut qui reste vert après
  péremption est un statut qui ment.
- **RM-44-05 — Pas de RFR, tarif maximal, sans rétroactivité.** Fournir le RFR plus tard ne
  recalcule pas les mois déjà passés — c'est la règle de l'association, et elle coïncide avec le
  principe d'immuabilité du passé de la [SFD 30](30-sfd-versionnement-dates-effet.md).
- **RM-44-06 — Le RFR se renouvelle chaque année, et son absence se voit.** Une version de plus
  d'un an est signalée, jamais tacitement reconduite.
- **RM-44-07 — Aucun envoi sortant, aucune prise de rendez-vous.** Le rendez-vous est une date
  notée à la main.
- **RM-44-08 — Traçabilité.** Les mutations de dossier, de pièces et de personnes autorisées
  s'inscrivent à la piste d'audit acteur dès le premier commit.

## 7. RGPD — deux points qui ne se règlent pas à l'exécution

### 7.1 Le seuil de l'article 9, et pourquoi la position (a) le garde fermé

L'`ADR-0007` a quatre seuils de réouverture ; un seul est en cause ici — « une donnée de santé est
stockée ». La position (a) du §0 le laisse **fermé**, mais de justesse, et pour une raison qu'il
faut écrire : ce n'est pas le mécanisme qui franchit le seuil, **c'est ce que la personne y met**.
Trois gardes de conception en découlent, et elles ne sont pas facultatives :

- **aucun champ libre** sur une pièce ni sur une personne autorisée ;
- **aucun libellé détaillé** de pièce médicale au catalogue : « fiche sanitaire » est un intitulé
  administratif, « allergie aux arachides » ne doit pouvoir s'écrire nulle part ;
- **aucune pièce jointe**, dans aucune version — le jour où il en faut une, c'est la
  [SFD 38](38-sfd-rattachement-documentaire.md) qui la porte, avec la réouverture d'ADR qui va avec.

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

| Lot   | Contenu                                                                                           | Ce qui le clôt                                                                               |
| ----- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **0** | Trancher la décision 1 du §0, et `Q-44-01`. Écrire les lignes du registre des traitements (§7).   | La position est écrite, et le registre porte les deux nouvelles finalités.                   |
| **1** | Rappel de renouvellement du RFR sur le mécanisme existant, et affichage de la tranche applicable. | Une version de ressources de plus d'un an est signalée ; aucun modèle nouveau n'a été écrit. |
| **2** | Dossier annuel, catalogue de pièces, états, report des pièces encore valides.                     | Un dossier ne passe `COMPLET` qu'avec toutes ses obligatoires valides.                       |
| **3** | Rappels : avant le rendez-vous, avant péremption — par le récapitulatif existant.                 | Une sonde négative prouve qu'aucun second courriel n'est émis.                               |
| **4** | Personnes autorisées, avec le minimum de données et l'export/effacement associés.                 | `pnpm portabilite` et `pnpm retentions` verts sans exception ajoutée.                        |
| **5** | _Conditionnel_ — rattachement d'un justificatif **non médical** au dossier, via la SFD 38.        | Ne démarre que si la SFD 38 est livrée ; ne touche **jamais** la cible `ENFANT`.             |

> Le lot 1 est **livrable seul**, sans le reste : c'est le plus petit morceau de valeur réelle du
> bloc 40 → 44, et il ne dépend d'aucune décision ouverte.

## 9. Questions ouvertes

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

## 10. Ce que cette spécification engage

- **Une position écrite sur l'article 9** avant le premier commit — et le refus explicite de
  stocker la moindre pièce médicale (`RM-44-02`).
- **Deux finalités nouvelles** au [registre des traitements](37-registre-des-traitements.md), dont
  la première portant sur des **données de tiers**.
- **Aucun modèle nouveau pour le RFR** : le versionnement existe, on lui ajoute un rappel.
- **Aucune intégration** : ni prise de rendez-vous, ni envoi à l'association, ni dépôt de pièce.
- **Une dépendance douce à la [SFD 38](38-sfd-rattachement-documentaire.md)** : sans elle, la liste
  de pièces reste une liste — utile, mais moitié moins.
