# 41 — SFD Cantine, périscolaire & ALSH : réserver, tarifer, rapprocher (ABCM)

> Statut : **BROUILLON — NE PAS DÉMARRER · en attente de validation PO** · Version 0.2 · 2026-09-01
> Pièce centrale du domaine associatif ABCM (40 → 44). Étend le
> [modèle de coût](02-modele-de-cout.md) §4, s'appuie sur le versionnement à date d'effet
> ([doc 30](30-sfd-versionnement-dates-effet.md)) et sur le calendrier d'ouverture
> ([SFD 31](31-sfd-calendriers-vacances-scolaires.md)). **Porte la note d'architecture
> « deux moteurs de tarification » (§7)**, à laquelle les quatre autres SFD renvoient.
> **Amendée le 2026-09-01 par deux décisions PO** : le **site tarifaire** est distinct du **lieu**
> (§0, décision 6), et la **carence de 48 h** est tranchée en faveur du règlement (§0, décision 5).
> Consigne `AM-110`, `AM-111`, `AM-113`, `AM-114`, `AM-115`, `AM-116`, `AM-117`
> ([doc 34](34-registre-ameliorations.md)).

## 0. Ce que ça demande au PO

Sept décisions. La première renverse la prémisse du chantier ; les suivantes bornent le périmètre.
**Les décisions 5 et 6 ont été tranchées par le PO le 2026-09-01** et sont conservées écrites avec
leur réponse — une question effacée redevient une question six mois plus tard.

### 1. Le « second moteur de tarification » n'est pas à écrire — il tourne en production

L'énoncé de ce chantier demandait un **deuxième moteur de tarification**, distinct du taux
d'effort de la crèche. Il existe depuis la première version du produit, il est spécifié en
[doc 02](02-modele-de-cout.md) §4, versionné depuis la SFD 30, et il facture réellement chaque
mois : `libs/tarification/domain/src/lib/abcm/` porte la grille, les trois politiques tarifaires
(cantine, périscolaire, ALSH), les frais fixes et les unités associatives ; les tranches RFR sont
un barème versionné du Référentiel.

Ce qui manque n'est pas un moteur, c'est **une dimension de sa grille** : `grille_abcm` est
indexée par la **seule tranche**, alors que les tarifs 2026 varient par **site** (Mulhouse /
Lutterbach) **et par niveau scolaire** (maternelle / élémentaire). Le vrai travail est un
élargissement de clé, pas une écriture. Détail, chiffres et conséquences au **§7**.

> Cette correction n'est pas cosmétique : elle change l'ordre de grandeur du chantier, et elle
> évite de reconstruire à côté un moteur concurrent de celui qui facture — ce qui aurait produit
> deux vérités tarifaires dans le même produit.

### 2. Le jeudi 12 h : Martha rappelle, ou Martha interdit ?

Le règlement est net — pas d'inscription passé le **jeudi 12 h 00 pour la semaine suivante**,
enfant non inscrit non accueilli. Martha ne réservant rien (§2), elle ne peut pas faire respecter
ce délai ; elle peut le **rendre visible**. Deux formes possibles : signaler (« il te reste 6 h
pour transmettre la semaine du 12 »), ou refuser toute saisie au-delà.
**Recommandation : signaler, jamais refuser.** Une dérogation écrite du responsable existe
(`alsh.regioschule@abcmzwei.org`) et rend l'inscription tardive parfaitement valide : un refus
d'écran produirait un planning **faux** dans exactement le cas où la famille a fait ce qu'il
fallait.

### 3. Le rapprochement de facture appartient à un chantier qui existe déjà

`.claude/plans/factures-reelles.md` spécifie déjà la facture réelle, le rapprochement ligne à
ligne et le crédit d'impôt, avec son propre service. Cette SFD **ne le redouble pas** : elle
s'arrête au **réservé** et lui livre les deux choses qu'il n'a pas — le **détail par service et
par jour** de ce qui aurait dû être facturé, et les **règles ABCM d'écart** (absence facturée,
carence 48 h, sanctions). **Recommandation : déléguer**, et prévoir un lot de branchement.
La décision inverse (tout absorber ici) est tenable, mais elle rend cette SFD dépendante d'un
service qui n'existe pas.

### 4. Les sanctions de l'annexe 2 : calculées, ou seulement redoutées ?

Présence non inscrite en cantine : rappel, puis repas **+ 5 €**, puis entretien, puis suspension
de un à trois jours. Retard du soir après 18 h 15 : rappel, puis **+ 15 €**, puis suspension de un
à cinq jours. Ce sont des **décisions d'un responsable**, pas des formules : les calculer
d'office produirait des montants que personne n'a prononcés.
**Recommandation : ne pas les calculer, les rendre prévisibles** — quand une présence n'a pas été
transmise, l'écran dit ce que le règlement prévoit. Le montant, lui, n'entre dans le coût que
s'il apparaît sur une facture (chantier facture, décision 3).

### 5. ✅ Tranchée — la carence de 48 h se lit dans le règlement, pas dans le flyer

Les deux sources se contredisaient : le **règlement intérieur** (voté en CA le 11/12/2025) écrit
que les 48 premières heures **restent dues** ; le flyer écrit qu'une annulation prévenue 48 h à
l'avance **annule la facturation**. Les deux ne donnent pas le même montant.

**Décision PO du 2026-09-01 : la source de vérité est le RÈGLEMENT**, en tant que texte voté par
le conseil d'administration. La règle canonique du produit est donc :

> **Réservé ⇒ facturé**, sauf **maladie de l'enfant** ou **force majeure** — appréciées par le
> responsable — avec un **délai de carence de 48 h** : **les 48 premières heures restent dues**,
> la déduction ne porte que sur la suite. Une **interruption totale du service** exonère sans
> carence.

C'est ce que le produit implémente déjà (doc 02 §4.4 bis) : la décision **confirme** le
comportement au lieu de le changer. Elle ne clôt pourtant pas complètement la question, et c'est
délibéré (`Q-41-04` reformulée, `AM-117`) : **la facture est le seul témoin de ce qui est
réellement appliqué**. Un règlement dit ce qui devrait se passer ; deux ou trois factures Delta
Enfance réelles diront ce qui se passe. C'est précisément l'usage du rapprochement réservé /
facturé de cette SFD — et si l'écart apparaît, c'est la **pratique** qu'il faudra écrire, pas le
règlement qu'il faudra corriger.

### 6. ✅ Tranchée — Dornach n'est pas un site tarifaire

**Décision PO du 2026-09-01 : il n'y a que deux sites tarifaires — Mulhouse et Lutterbach.**
Dornach est un **lieu** (une classe, un événement, une adresse), pas une structure au tarif propre :
ce qui s'y passe **facture en Mulhouse**.

La conséquence de modèle est nette, et elle évite une erreur qui aurait été coûteuse : **le lieu et
le site tarifaire sont deux notions séparées** (`RM-41-13`). Confondre les deux aurait ajouté une
troisième colonne à la grille — donc une combinaison sans tarif, donc un calcul refusé sur un cas
parfaitement normal. Les dimensions de la clé de grille sont donc, définitivement :

> **tranche** × **site tarifaire** `{ Mulhouse | Lutterbach }` × **niveau** `{ maternelle |
élémentaire }` × **date d'effet**

### 7. Ce qui est déjà décidé et qu'il suffit de confirmer

- **« Réservé ⇒ facturé »** est déjà la règle du produit (doc 02 §4.4 bis) et déjà implémentée.
- **Le PAI panier-repas** est déjà modélisé : seule la part « garde » est facturée.

### Ce que cette spécification ne décide pas

**L'ordonnancement.** Elle dépend du calendrier d'ouverture (SFD 31, lot 2 en revue, lots 3 à 5
non écrits) pour savoir quels jours sont réservables : la démarrer avant rendrait la moitié de ses
règles indémontrables.

## 1. Contexte & problème

Trois services rythment la semaine d'un enfant scolarisé à la Regio Schule :

- **la pause méridienne** (cantine), lundi, mardi, jeudi et vendredi de 12 h 00 à 13 h 50 —
  l'inscription porte désormais sur **toute** la pause, la « garde de midi » seule n'existe plus ;
- **le périscolaire du matin**, 7 h 30 – 8 h 20, **à Mulhouse uniquement** ;
- **le périscolaire du soir**, 16 h 30 – 18 h 15 à Mulhouse, **16 h 00 – 18 h 15 à Lutterbach** ;
- et, hors temps scolaire, **l'ALSH** — mercredis et vacances, traité par la
  [SFD 42](42-sfd-vacances-alsh.md).

Tout se réserve sur le **portail famille Delta Enfance**, au plus tard le **jeudi 12 h pour la
semaine suivante**, et tout se facture **mensuellement, à terme échu**, sur ce même portail.

Le problème de la famille n'est pas de calculer un coût — Martha le fait déjà. Il est en trois
temps : **a-t-on transmis la semaine à temps ?**, **la facture correspond-elle à ce qui a été
réservé ?**, et **pourquoi ce mois coûte-t-il plus cher que le précédent ?**

### 1.1 Constat négatif — relevé sur `main` (`80e2875`), le 2026-09-01

| Ce qu'on croyait manquant                         | État réel                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un moteur de tarification ABCM                    | **Existe et facture.** Grille, cantine, périscolaire, ALSH, frais fixes, UA — `libs/tarification/domain/src/lib/abcm/`. Aucune valeur tarifaire n'est plus figée dans le domaine depuis la SFD 30 (`RM-30-04`).                                                                               |
| Les tranches RFR (20 k€ / 50 k€)                  | **Existent et sont versionnées** : `libs/shared-kernel/src/lib/tranche.ts` classe un RFR contre un barème résolu à la date du fait ; les seuils vivent au Référentiel, plus dans le code.                                                                                                     |
| La saisie des jours de cantine et de périscolaire | **Existe** : semaine type ABCM + exceptions datées, `libs/planification/domain/src/lib/inscription-abcm.ts`, avec la règle « réservé ⇒ facturé » et l'exclusion des jours non facturables.                                                                                                    |
| La grille par site et par niveau                  | **N'existe pas.** `apps/svc-referentiel/src/database/schema.ts` indexe `grille_abcm` sur la **seule** tranche : deux établissements aux tarifs distincts ne peuvent pas coexister, et le niveau scolaire n'est nulle part. → `AM-110`, `AM-115`.                                              |
| Les services offerts par site                     | **N'existent pas.** Rien n'empêche de saisir un périscolaire du matin à Lutterbach, qui n'en propose pas. → `AM-114`.                                                                                                                                                                         |
| Un état « transmis au portail »                   | **N'existe pas.** Le produit calcule un attendu ; rien ne dit qu'il a été saisi sur Delta Enfance, ni quand, ni avant quelle échéance. → `AM-113`.                                                                                                                                            |
| Les frais fixes ABCM versionnés                   | **Non.** `apps/svc-tarification/src/tarification/cout.service.ts` instancie les frais fixes **sans paramètres** : 286 € et 150 € restent des défauts du domaine, et la cotisation à deux ou trois enfants (473 €, 616 €) n'est pas modélisée. Violation résiduelle de `RM-30-04`. → `AM-111`. |
| Une facture, un paiement, un écart                | **Rien.** Le produit est un moteur de calcul ; la vérité terrain fait l'objet d'un plan distinct, à l'état de brouillon non démarré.                                                                                                                                                          |

## 2. Périmètre

### Dans le périmètre (v1)

- **Dimensionner la grille ABCM** par tranche **×** établissement **×** niveau scolaire, avec sa
  date d'effet (les tarifs sont révisables au 1er janvier).
- **Porter le niveau scolaire de l'enfant** (maternelle / élémentaire) comme une donnée à date
  d'effet — un enfant passe en CP, son tarif change le même jour.
- **Déclarer les services offerts par établissement** : pas de périscolaire du matin à
  Lutterbach, horaires du soir distincts.
- **Suivre la transmission d'une semaine** au portail : état, date, échéance du jeudi 12 h,
  rappel tant que la semaine à venir n'est pas marquée transmise.
- **Restituer le détail réservé** d'un mois, service par service et jour par jour — la matière
  première du rapprochement de facture.
- **Écrire les règles d'absence** (facturée par défaut, exceptions maladie / force majeure avec
  carence, interruption de service) de façon **paramétrée**, pas codée.

### Hors du périmètre (v1) — et pourquoi

| Écarté                                                    | Raison                                                                                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Réserver sur Delta Enfance depuis Martha                  | Aucune API, et le portail est le système de l'association. Martha suit, rappelle, vérifie — elle n'inscrit pas.                              |
| Saisir, importer ou payer une facture                     | Chantier distinct (`.claude/plans/factures-reelles.md`), avec son service et son modèle. Cette SFD lui livre le **réservé**, pas le facturé. |
| Calculer une sanction de l'annexe 2                       | Décision d'un responsable, pas une formule (§0, décision 4). Le règlement est **affiché**, jamais appliqué d'office. → `AM-116`.             |
| Demander une dérogation par courriel depuis l'application | Un envoi sortant vers l'association engage la famille. Martha affiche l'adresse, elle n'écrit à personne.                                    |
| L'ALSH (mercredis et vacances)                            | [SFD 42](42-sfd-vacances-alsh.md) — même barème, autre parcours de réservation.                                                              |
| Les dates du calendrier 2026/27                           | [SFD 43](43-sfd-calendrier-scolaire-abcm.md) : ce sont des **données** injectées dans le calendrier versionné, pas des règles.               |

**Frontière portail** — rappel : Martha est une couche de suivi, de rappel, de miroir et de
vérification par-dessus Delta Enfance et le site travaux. Voir [SFD 40](40-sfd-unites-associatives.md) §2.

## 3. Abstractions & modèle

### 3.1 Ce que le modèle gagne

```
Etablissement (entité libre, existante) = un LIEU                     ← Dornach en est un
   ├─ servicesOfferts : [CANTINE, PERI_MATIN?, PERI_SOIR, ALSH]     ← nouveau (AM-114)
   ├─ siteTarifaire : MULHOUSE | LUTTERBACH                          ← nouveau (décision 6)
   └─ horaires par service (informatif, affiché)

Enfant (existant) ──< NiveauScolaireVersion                          ← nouveau (AM-115)
   └─ { dateEffet, niveau: MATERNELLE | ELEMENTAIRE }

GrilleAbcm (existante) — clé élargie                                 ← nouveau (AM-110)
   avant : (tranche, valideDu → valideAu)
   après : (tranche, siteTarifaire, niveau, valideDu → valideAu)

SemaineReservation                                                   ← nouveau (AM-113)
   ├─ (foyer, enfant, semaine ISO)
   ├─ echeance : jeudi 12 h de la semaine précédente (dérivée, jamais saisie)
   ├─ etat : A_TRANSMETTRE | TRANSMISE | DEROGATION_DEMANDEE | HORS_DELAI
   └─ transmiseLe (horodatage déclaré par le parent)
```

> **Pourquoi `siteTarifaire` est un attribut du lieu, et non le lieu lui-même.** Un foyer peut
> avoir affaire à plus de lieux qu'il n'y a de tarifs : Dornach en est la preuve immédiate. Faire
> porter la grille par l'établissement aurait exigé une grille par lieu — donc une combinaison
> vide, donc un calcul refusé, pour une classe qui facture normalement. Le lieu dit **où**, le site
> tarifaire dit **selon quel barème** ; l'un se multiplie librement, l'autre est une énumération
> fermée à deux valeurs (`RM-41-13`).

Trois principes, hérités et non renégociés ici :

1. **Aucun tarif, aucun horaire, aucun nom d'établissement en dur** (doc 30 §4, `RM-31-05`). Le
   site tarifaire est une **énumération de données**, pas une constante de code : ses deux valeurs
   se saisissent au Référentiel comme le reste du barème.
2. **Le passé facturé est intouchable** : une grille corrigée s'applique à sa date d'effet, jamais
   rétroactivement (doc 30).
3. **Réservé ⇒ facturé** reste la règle de base, et le produit la tient déjà.

### 3.2 Annexe tarifaire — les valeurs au 1er janvier 2026

Reproduites ici parce qu'elles montrent **pourquoi** la clé de grille doit changer : six lignes
cantine et cinq lignes périscolaire là où le schéma actuel n'en accepte qu'une par tranche. Elles
sont des **données à saisir au Référentiel**, jamais du contenu de code.

**Cantine — total par jour** (repas selon l'âge + encadrement 12 h – 13 h 50 selon la tranche) :

| Ligne                                    | T1    | T2    | T3    |
| ---------------------------------------- | ----- | ----- | ----- |
| Maternelle (Mulhouse et Lutterbach)      | 10,50 | 11,65 | 12,68 |
| Élémentaire (Mulhouse)                   | 10,24 | 11,24 | 12,42 |
| dont repas maternelle (toutes tranches)  | 4,66  | 4,66  | 4,66  |
| dont repas élémentaire (toutes tranches) | 5,30  | 5,30  | 5,30  |
| dont garde maternelle                    | 5,83  | 6,99  | 8,01  |
| dont garde élémentaire (Mulhouse)        | 4,94  | 5,94  | 7,12  |

> La part « garde » est ce qui est facturé en cas de **PAI panier-repas** — déjà implémenté.
> Les totaux se recomposent bien (repas + garde), à un centime d'arrondi près en maternelle T1 et
> T3 : le **total** est la valeur facturée, pas la somme recalculée.

**Périscolaire — par séance :**

| Ligne                              | T1   | T2   | T3   |
| ---------------------------------- | ---- | ---- | ---- |
| Mulhouse maternelle — matin        | 2,31 | 2,87 | 3,33 |
| Mulhouse maternelle — soir (2 h)   | 5,01 | 6,01 | 7,05 |
| Lutterbach maternelle — soir (2 h) | 5,01 | 6,01 | 7,05 |
| Mulhouse élémentaire — matin       | 1,92 | 2,35 | 2,93 |
| Mulhouse élémentaire — soir (2 h)  | 4,11 | 5,10 | 6,12 |

> **Pas de périscolaire du matin à Lutterbach** — c'est une absence de service, pas un tarif nul.
> Et le soir est libellé « 2 h » des deux côtés alors que les amplitudes diffèrent (1 h 45 à
> Mulhouse, 2 h 15 à Lutterbach) : forfait ou horaire, c'est `Q-41-03`.

**ALSH — toutes structures** (détail et parcours en [SFD 42](42-sfd-vacances-alsh.md)) :

| Ligne            | T1    | T2    | T3    |
| ---------------- | ----- | ----- | ----- |
| Journée complète | 23,50 | 25,00 | 26,50 |
| Demi-journée     | 8,50  | 9,00  | 9,50  |
| Repas            | 6,50  | 7,00  | 7,50  |

**Tranches de RFR** : T1 sous 20 000 €, T2 de 20 000 à 50 000 €, T3 au-delà. Sans RFR ni quotient
fourni, **le tarif maximal s'applique, sans effet rétroactif** — une règle qui appartient au
dossier ([SFD 44](44-sfd-inscription-reinscription-pieces.md)). Le foyer de référence est en T3.

## 4. Acteurs

| Acteur               | Rôle                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Parent**           | Saisit la semaine type et ses exceptions, marque une semaine transmise, consulte le coût et le détail, compare à sa facture. |
| **Système**          | Résout les jours ouverts, calcule les quantités et le coût, dérive l'échéance du jeudi 12 h, rappelle, restitue le détail.   |
| **Delta Enfance**    | **Hors périmètre.** Système de réservation et de facturation de l'association.                                               |
| **Responsable ALSH** | Destinataire des dérogations écrites. Martha affiche son adresse ; elle ne lui écrit jamais.                                 |

## 5. User stories

### US-41-01 — Tarifer selon le site et le niveau

En tant que parent de deux enfants, l'un en maternelle à Lutterbach, l'autre en élémentaire à
Mulhouse, je vois deux coûts justes.

- **CA1** : la grille applicable se résout par (tranche, établissement, niveau, date), et non par
  la seule tranche.
- **CA2** : une grille manquante pour une combinaison donnée **refuse** le calcul avec un message
  qui nomme la combinaison — jamais un tarif d'une autre combinaison « par défaut ».
- **CA3** : le passage d'un enfant en élémentaire à la rentrée change le tarif **à la date
  d'effet**, et ne modifie pas les mois déjà facturés.

### US-41-02 — Ne proposer que ce que le site offre

En tant que parent d'un enfant à Lutterbach, on ne me propose pas un périscolaire du matin qui
n'existe pas.

- **CA1** : la semaine type n'offre que les services déclarés par l'établissement.
- **CA2** : une saisie existante devenue impossible (service retiré) est **signalée**, pas
  supprimée en silence.

### US-41-03 — Savoir qu'il reste à transmettre la semaine prochaine

En tant que parent, le mercredi soir, je sais si la semaine suivante est transmise au portail.

- **CA1** : chaque semaine à venir porte un état, et son échéance (**jeudi 12 h de la semaine
  précédente**) est **dérivée du calendrier**, jamais saisie.
- **CA2** : marquer « transmise » est un geste d'un tap, horodaté, réversible.
- **CA3** : passé l'échéance sans transmission, l'écran dit ce que dit le règlement — enfant non
  inscrit non accueilli — et rappelle la voie de dérogation écrite.
- **CA4** : Martha **n'empêche jamais** la saisie tardive (§0, décision 2).

### US-41-04 — Comprendre ce que le mois va coûter

En tant que parent, je vois pour un mois le détail par service et par jour, et le total.

- **CA1** : chaque ligne dit son service, sa quantité, son tarif unitaire et sa tranche.
- **CA2** : un jour fermé (férié, vacances, fermeture) n'est jamais compté, et l'écran dit
  pourquoi il ne l'est pas.
- **CA3** : le mois affiche les frais fixes rattachés quand il y en a (cotisation en septembre).

### US-41-05 — Comparer la facture reçue à ce qui était réservé

En tant que parent, la facture mensuelle arrive sur le portail ; je veux savoir si elle
correspond.

- **CA1** : Martha restitue le **réservé** du mois dans une forme comparable ligne à ligne
  (service, nombre, tarif).
- **CA2** : le rapprochement lui-même — saisie de la facture, écarts, crédit d'impôt — appartient
  au chantier facture ; cette US en est le **fournisseur**, pas l'auteur (§0, décision 3).
- **CA3** : le délai de contestation (**deux mois**) est affiché à côté du mois concerné.

### US-41-06 — Déclarer une absence, et savoir ce qu'elle coûte

En tant que parent dont l'enfant est malade, je déclare l'absence et je vois si elle reste
facturée.

- **CA1** : par défaut, l'absence **ne réduit rien** — c'est la règle ABCM.
- **CA2** : un motif d'exonération (maladie, force majeure, interruption de service) et sa
  **carence** sont des **paramètres**, pas des branches de code.
- **CA3** : l'écran dit que l'exonération relève de l'**appréciation du responsable** et n'est
  jamais acquise du seul fait de la déclaration.

### US-41-07 — Changer une catégorie de repas

En tant que parent, je modifie la catégorie de repas choisie à l'inscription annuelle.

- **CA1** : la modification porte une **date d'effet** et respecte la même échéance du jeudi 12 h.
- **CA2** : le catalogue des catégories est une **donnée** (`Q-41-02`), pas une énumération de
  code.

### US-41-08 — Voir venir une sanction plutôt que la subir

En tant que parent, quand une présence n'a pas été transmise, je sais ce que le règlement prévoit.

- **CA1** : l'écran énonce l'échelle de l'annexe 2 (rappel, majoration, entretien, suspension)
  sans calculer aucun montant.
- **CA2** : aucune ligne de coût n'est créée par Martha à ce titre (`AM-116`).

## 6. Règles métier

- **RM-41-01 — Réservé ⇒ facturé.** Règle de base, déjà en vigueur (doc 02 §4.4 bis). L'absence ne
  déduit rien par défaut.
- **RM-41-02 — L'exonération est un paramètre à motif et à carence**, appréciée par le
  responsable. **Décision PO du 2026-09-01** : la source de vérité est le **règlement intérieur**
  voté en CA, pas le flyer — donc **les 48 premières heures restent dues** et la déduction ne
  porte que sur la suite ; l'interruption totale du service exonère **sans** carence. La valeur
  « 48 h » reste un **paramètre**, jamais une constante de code, pour que la pratique constatée
  puisse la corriger sans déploiement (`Q-41-04`, `AM-117`).
- **RM-41-03 — L'échéance est dérivée, jamais saisie** : jeudi 12 h de la semaine précédant la
  semaine réservée, calculée sur le calendrier de l'établissement.
- **RM-41-04 — Martha ne bloque jamais une saisie tardive.** Elle la qualifie (« hors délai ») et
  rappelle la voie de dérogation.
- **RM-41-05 — La grille est indexée par (tranche, site tarifaire, niveau, date d'effet).** Une
  combinaison sans grille **refuse** le calcul ; aucun repli sur une autre combinaison. Le site
  tarifaire vaut `Mulhouse` ou `Lutterbach`, et rien d'autre (`RM-41-13`).
- **RM-41-06 — Le niveau scolaire est une donnée à date d'effet** de l'enfant, jamais déduite de
  son âge : un maintien ou un saut de classe est un fait, pas un calcul.
- **RM-41-07 — Les services offerts sont déclarés par établissement.** Ce que le site n'offre pas
  n'est ni proposé, ni tarifé, ni comptable dans un écart de facture.
- **RM-41-08 — L'inscription cantine porte sur toute la pause méridienne.** La « garde de midi »
  seule n'existe plus ; la part « garde » demeure uniquement comme **tarif du cas PAI**.
- **RM-41-09 — Les frais fixes deviennent des données versionnées** (cotisation selon le nombre
  d'enfants inscrits, frais de première inscription), au même titre que la grille. Tant que ce
  n'est pas fait, `RM-30-04` est violée par un chemin résiduel (`AM-111`).
- **RM-41-10 — Aucune sanction n'est calculée** (§0, décision 4). Le règlement est affiché ; un
  montant n'entre dans les comptes que par une facture.
- **RM-41-11 — Aucun envoi sortant vers l'association.** Ni dérogation, ni contestation, ni
  inscription : Martha n'écrit à personne au nom de la famille.
- **RM-41-12 — Traçabilité.** Toute mutation d'inscription, de grille ou d'état de transmission
  s'inscrit à la piste d'audit acteur dès le premier commit — la mémoire du projet relève déjà
  que les mutations de contrat ne sont **auditées nulle part**, cette SFD n'aggrave pas le cas.
- **RM-41-13 — Le lieu n'est pas le site tarifaire.** Un établissement est un **lieu** et porte un
  **attribut** `siteTarifaire` valant `Mulhouse` ou `Lutterbach`. Les lieux se multiplient
  librement (Dornach en est un) ; les sites tarifaires sont **deux**, et la grille n'est indexée
  que sur eux. Un lieu sans site tarifaire déclaré **refuse** le calcul plutôt que d'en deviner un
  — la sonde négative de la règle est là : ajouter un lieu ne doit **jamais** créer une
  combinaison de grille vide.

## 7. Note d'architecture — deux moteurs de tarification, et un seul à écrire

### 7.1 Ce qui existe

Le produit porte **deux politiques tarifaires distinctes, coexistantes et déjà séparées** :

| Moteur                          | Ce qu'il calcule                                                                          | Où il vit                                | État                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| **Crèche PSU / CNAF**           | Taux d'effort horaire × ressources mensuelles, mensualisé                                 | `libs/tarification/domain/src/lib/psu/`  | En production, barème versionné au Référentiel                    |
| **ABCM — forfaits par tranche** | Cantine, périscolaire, ALSH, frais fixes annuels, unités associatives, par tranche de RFR | `libs/tarification/domain/src/lib/abcm/` | En production, grille versionnée, **clé trop étroite** (`AM-110`) |

Ils ne se mélangent pas : le mode du contrat (`CRECHE_PSU`, `CANTINE`, `PERISCOLAIRE`, `ALSH`)
choisit la politique, et la liste des modes a **une source de vérité unique** gardée par
`scripts/verifier-frontieres.mjs`. La séparation demandée par l'énoncé est donc **déjà acquise**,
et depuis longtemps.

### 7.2 Ce qui manque vraiment

Trois écarts, tous de **forme de données**, aucun de moteur :

1. **La grille ABCM n'a qu'une clé** — la tranche. Les tarifs 2026 en exigent deux de plus, la
   date d'effet étant déjà présente : le **site tarifaire** (`Mulhouse` ou `Lutterbach`, décision
   PO du 2026-09-01) et le **niveau scolaire**. Sans cet élargissement, un foyer à cheval sur les
   deux sites ne peut pas être tarifé correctement, et l'erreur serait **silencieuse** : la grille
   de l'un s'appliquerait à l'autre.
2. **Le niveau scolaire n'existe pas** dans le modèle. Il change deux tarifs sur trois.
3. **Les frais fixes restent codés** : le service les instancie sans paramètres, donc 286 € et
   150 € vivent encore dans le domaine — le dernier endroit où `RM-30-04` n'est pas tenue.

### 7.3 Ce qu'il ne faut pas faire, et pourquoi

**Écrire un second moteur ABCM à côté de l'existant** produirait deux vérités tarifaires dans le
même produit : celle qui facture et celle qui affiche. C'est le mode de défaillance que la SFD 30
a précisément corrigé, quand le calcul lisait des constantes pendant que le Référentiel projetait
des grilles décoratives. Le remède est le même qu'alors : **une seule source, élargie**.

**Modéliser le site comme une variante de tarif** (« tarif Lutterbach ») plutôt que comme une
dimension de la grille reviendrait à écrire un nom d'établissement dans une clé de barème —
exactement ce que `RM-31-05` interdit. Le **site tarifaire** est une dimension à deux valeurs, et
l'établissement le **porte** comme attribut : la grille référence la dimension, pas le lieu.

**Indexer la grille sur l'établissement lui-même** est l'autre faute, et c'est celle que la
décision du 2026-09-01 vient d'éviter. Dornach est un lieu réel qui facture en Mulhouse ; une
grille par établissement lui aurait demandé son propre barème, donc aurait refusé le calcul sur un
cas parfaitement normal. La règle générale, valable au-delà de ce cas : **ce qui se multiplie
librement (les lieux) n'indexe jamais ce qui est fermé (les barèmes)**.

### 7.4 Conséquence de découpage

L'élargissement de clé est **un lot en soi**, avec migration, projection et reprise des grilles
existantes. Il est le **préalable** de tout le reste de cette SFD : sans lui, une saisie
multi-site produit des montants faux sans rien signaler.

## 8. Cadre de sécurité & données personnelles

- **Aucun tiers nouveau, aucun flux sortant.** Delta Enfance n'est ni appelé, ni scruté. Le seul
  identifiant tiers manipulé est celui que la famille possède déjà.
- **Aucune donnée sensible ajoutée.** Le **PAI** reste un drapeau de facturation sans motif ni
  pièce jointe ; le qualifier autrement rouvrirait `ADR-0007` et la
  [doc 37](37-registre-des-traitements.md). Écrit ici pour que le lot ne le franchisse pas par
  inadvertance : une catégorie de repas médicale, un motif d'absence détaillé ou un certificat
  attaché **franchiraient** ce seuil, et relèveraient de la
  [SFD 38](38-sfd-rattachement-documentaire.md).
- **Un motif d'absence est un texte libre potentiellement médical** : la v1 le prend dans un
  **catalogue fermé** (maladie, force majeure, interruption de service), sans champ libre. C'est
  une contrainte de conception, pas une commodité.
- **Portabilité et rétention** : chaque table nouvelle porte sa ligne au registre des traitements,
  sinon les portes dédiées échouent.

## 9. Découpage en lots

| Lot   | Contenu                                                                                                              | Ce qui le clôt                                                                                                                                      |
| ----- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0** | Trancher `Q-41-01` à `Q-41-05`. Zéro code.                                                                           | Les cinq questions sont closes ou explicitement reportées.                                                                                          |
| **1** | **Élargir la clé de grille** (tranche × site tarifaire × niveau × date) : schéma, projection, reprise, contrat Pact. | Deux sites aux tarifs distincts coexistent, une combinaison manquante **refuse** le calcul, et **ajouter un lieu ne crée aucune combinaison vide**. |
| **2** | Niveau scolaire de l'enfant à date d'effet ; attribut de site tarifaire et services offerts par établissement.       | Un passage en élémentaire change le tarif à sa date, sans toucher aux mois passés ; Dornach facture en Mulhouse.                                    |
| **3** | Frais fixes versionnés (cotisation selon le nombre d'enfants, première inscription).                                 | Plus aucune valeur monétaire ABCM dans le domaine — `RM-30-04` tenue sur tout le chemin.                                                            |
| **4** | Semaine de réservation : état, échéance dérivée, rappel dans le récapitulatif existant.                              | Une semaine non transmise à J−1 de l'échéance est visible sans ouvrir l'application.                                                                |
| **5** | Détail réservé d'un mois, exportable ligne à ligne pour le rapprochement.                                            | Le chantier facture peut le consommer sans rien recalculer.                                                                                         |
| **6** | Absences : catalogue de motifs, carence paramétrée, affichage du règlement des sanctions.                            | Une absence maladie déclarée produit le bon montant **et** dit que l'exonération n'est pas acquise.                                                 |

> Les lots 1 à 3 sont des lots de **fondation tarifaire** : ils bénéficient aussi aux
> [SFD 42](42-sfd-vacances-alsh.md) et [43](43-sfd-calendrier-scolaire-abcm.md), qui ne les
> refont pas.

## 10. Questions ouvertes

- **Q-41-01** — Lutterbach accueille-t-il des **élémentaires** ? Les tarifs fournis ne donnent
  d'élémentaire qu'à Mulhouse. Si oui, il manque deux lignes de grille ; si non, c'est une
  combinaison qui doit **refuser** le calcul plutôt que retomber sur Mulhouse.
- **Q-41-02** — Quelles sont les **catégories de repas** du prestataire et leurs prix ? Le
  règlement impose de choisir une catégorie à l'inscription annuelle ; les tarifs publiés ne
  distinguent que maternelle et élémentaire. Tant que la réponse manque, la catégorie est une
  donnée d'affichage sans effet sur le montant.
- **Q-41-03** — Le périscolaire du soir est-il **forfaitaire** ou **horaire** ? Le tarif est
  libellé « 2 h » pour deux amplitudes différentes (1 h 45 à Mulhouse, 2 h 15 à Lutterbach).
  Hypothèse par défaut : forfait par séance, ce que fait déjà le produit.
- ~~**Q-41-04** — La **carence de 48 h** se lit-elle « les 48 premières heures restent dues » ou
  « prévenir 48 h à l'avance annule la facturation » ?~~ → **tranchée le 2026-09-01** : la source
  de vérité est le **règlement intérieur** voté en CA, donc **les 48 premières heures restent
  dues** (§0, décision 5). Le flyer est écarté comme source.
  **Reste ouverte, volontairement, la vérification** : confronter la règle à **deux ou trois
  factures Delta Enfance réelles**, parce que la facture est le seul témoin de ce qui est
  **réellement appliqué** — c'est l'objet du rapprochement réservé / facturé de cette SFD
  (`AM-117`). Si la pratique diffère du texte, c'est la **pratique** qu'on écrit, et le paramètre
  de carence est fait pour ça (`RM-41-02`).
- **Q-41-05** — La **facture individualisée en garde alternée** (demande signée des deux parents)
  est-elle un besoin du foyer ? Si non, écarter par écrit : le modèle de foyer actuel n'a qu'un
  redevable, et l'ouvrir aurait des effets bien au-delà de cette SFD.

## 11. Ce que cette spécification engage

- **Une migration de la clé de grille**, avec reprise des données existantes et rejeu de
  projection — le geste le moins réversible du lot.
- **Une donnée nouvelle sur l'enfant** (niveau scolaire), versionnée.
- **Une donnée nouvelle sur l'établissement** (`siteTarifaire`, deux valeurs), et la règle qui va
  avec : ajouter un lieu ne crée jamais une combinaison de grille vide (`RM-41-13`).
- **Une règle d'absence tranchée, mais pas close** : la carence suit le règlement, et sa
  vérification sur factures réelles reste due (`Q-41-04`, `AM-117`).
- **La fin d'une exception à `RM-30-04`** : plus aucun montant ABCM dans le domaine.
- **Aucun appel, aucun envoi vers l'association** — dans aucune version.
- **Une dépendance ferme au calendrier d'ouverture** ([SFD 31](31-sfd-calendriers-vacances-scolaires.md)) :
  sans lui, « jour réservable » n'a pas de définition opposable.
- **Une frontière tenue avec le chantier facture** : cette SFD fournit le réservé, elle ne modélise
  ni facture, ni paiement, ni écart.
