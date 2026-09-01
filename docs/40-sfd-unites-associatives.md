# 40 — SFD Unités associatives : tenir l'engagement de bénévolat du foyer

> Statut : **BROUILLON — NE PAS DÉMARRER · en attente de validation PO** · Version 0.1 · 2026-09-01
> Première des cinq spécifications du **domaine associatif ABCM** (40 → 44). Prolonge le
> [modèle de coût](02-modele-de-cout.md) §4.5, qui décrit déjà les UA comme un coût
> conditionnel, et s'appuie sur le versionnement à date d'effet ([doc 30](30-sfd-versionnement-dates-effet.md)).
> Consigne les pistes `AM-112` et `AM-118` ([doc 34](34-registre-ameliorations.md)).

## 0. Ce que ça demande au PO

Quatre décisions. Aucune n'est technique ; toutes changent le périmètre.

1. **Le sujet est le SUIVI, pas la saisie.** Les créneaux se réservent sur le site travaux de
   l'association (`mulhouse-travaux.abcmzwei.eu`), et rien ici ne propose de le remplacer.
   Martha répond à une seule question : **« combien me reste-t-il à faire, et jusqu'à quand ? »**
   Si le PO attend au contraire une réservation depuis Martha, cette spécification est à jeter et
   à réécrire — ce ne serait pas la même. Voir §2.
2. **Le quota est-il celui que le dépôt affirme déjà ?** La [doc 02](02-modele-de-cout.md) §4.5
   écrit **20 UA / an**, **31,25 € l'UA**, caution **625 €**, période **1er juin → 31 mai**, en
   citant le RI de l'association (annexe 2, AG du 06/03/2026). L'énoncé de ce chantier présentait
   ces valeurs comme inconnues : elles ne le sont pas, elles sont **non revérifiées pour
   2026/27** (`Q-40-01`). La différence compte : ce n'est pas une spécification à trous, c'est une
   donnée à confirmer.
3. **Que fait-on du code qui existe déjà ?** `UnitesAssociativesAbcm` est écrit, testé, et
   **branché nulle part** (§1.1). Deux issues seulement : on le branche (ce que propose cette
   SFD), ou on le retire. Le laisser en l'état est la seule option que la spécification refuse —
   c'est du code qui donne l'impression d'une fonctionnalité livrée.
4. **Où sortent les alertes d'échéance ?** Le foyer a **un** canal sortant, le récapitulatif
   hebdomadaire, et le risque de confiance n° 1 en production est la tempête de courriels. Cette
   SFD propose donc de n'ouvrir **aucun second canal** : l'échéance du 31 mai s'affiche dans
   l'application et s'invite dans le récapitulatif existant (`RM-40-07`, `AM-118`).

### Ce que cette spécification ne décide pas

**L'ordonnancement.** Elle est la première du bloc 40 → 44 parce qu'elle est la plus petite et la
plus indépendante — elle ne dépend ni du calendrier, ni de la facturation, ni des pièces du
dossier. Elle reste en concurrence avec les chantiers déjà validés et non démarrés
([SFD 31](31-sfd-calendriers-vacances-scolaires.md), [SFD 38](38-sfd-rattachement-documentaire.md)).

## 1. Contexte & problème

Toute famille membre actif de l'ABCM doit un **volume annuel de bénévolat** — les **unités
associatives**. Une UA vaut une heure. Le foyer dépose une caution en début de période ; elle est
rendue si le quota est atteint, encaissée à hauteur des heures manquantes sinon. La période de
comptage ne suit pas l'année scolaire : elle court du **1er juin au 31 mai** suivant.

Les créneaux se prennent sur le **site travaux** de l'association, avec les mêmes identifiants que
le portail famille. Ils prennent plusieurs formes : créneaux de ménage réguliers, service de
cantine, grands ménages ponctuels (à la rentrée : deux sessions de quatre heures, douze personnes
par session), participation au comité des événements (CVE), et savoir-faire valorisables
(rénovation, peinture, plomberie, artistique).

Le problème n'est pas de calculer : c'est de **savoir où on en est**. Aujourd'hui, le reste-à-faire
vit dans la tête des parents et dans un site que personne n'ouvre entre deux inscriptions. Une
famille découvre son retard quand la caution est encaissée — c'est-à-dire deux mois après le
31 mai, quand il est trop tard pour agir.

### 1.1 Constat négatif — ce que le dépôt sait déjà, et ce qu'il ne sait pas

Relevé sur `main` (`80e2875`) le 2026-09-01, avant toute rédaction :

| Ce qu'on croyait à écrire                | État réel                                                                                                                                                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le calcul du coût des UA manquantes      | **Il existe.** `libs/tarification/domain/src/lib/abcm/unites-associatives-abcm.ts` : `max(0, quota − heures réalisées) × valeur d'UA`, quota 20 h et UA à 31,25 € par défaut, rattachement en fin de période.                                  |
| Le quota, la valeur de l'UA, la période  | **Écrits en [doc 02](02-modele-de-cout.md) §4.5**, avec leur source (RI, annexe 2) et leurs variantes (parent isolé 10 UA, double accès portail 10 UA par parent). Non revérifiés pour 2026/27 — c'est `Q-40-01`, et c'est tout ce qui manque. |
| Le branchement de ce calcul              | **Inexistant.** La classe n'est citée que par ses propres tests, l'index de la lib et trois documents. Aucune table, aucune route, aucun écran, **aucun endroit où saisir les heures réalisées**. → `AM-112`.                                  |
| Le suivi des créneaux (réservés / faits) | **Inexistant**, et c'est le cœur du besoin : il n'y a pas d'objet « session de bénévolat » dans le dépôt.                                                                                                                                      |
| Une alerte d'échéance                    | **Aucun porteur.** `svc-notifications` sait envoyer un récapitulatif hebdomadaire, pas une échéance datée. → `AM-118`.                                                                                                                         |

> **La leçon qui en sort** (`LE-93`) : un domaine pur peut être complet, spécifié, testé en
> mutation — et n'être atteignable par personne. Ce qui l'a montré n'est pas la couverture, c'est
> la question « qui appelle cette classe ? ».

## 2. Périmètre

### Dans le périmètre (v1)

- **Déclarer l'engagement** du foyer pour une période : quota d'UA, valeur de l'UA, dates de
  début et de fin, montant de la caution — **des données versionnées**, pas des constantes.
- **Tenir la liste des sessions** : une ligne par créneau, avec sa date, son type, sa durée en
  heures, l'établissement concerné, la personne du foyer qui s'y colle, et son **état**
  (prévue / réalisée / annulée).
- **Calculer et montrer le reste-à-faire** : heures dues, réservées, réalisées, restantes, et le
  coût résiduel si la période se terminait aujourd'hui.
- **Rappeler l'échéance** dans l'application et dans le récapitulatif hebdomadaire existant.
- **Brancher le calcul déjà écrit** sur des heures réellement saisies.

### Hors du périmètre (v1) — et pourquoi

| Écarté                                                      | Raison                                                                                                                                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Réserver un créneau depuis Martha                           | Le site travaux est le système de réservation de l'association. Le doubler exigerait une intégration qu'aucune API ne propose, et rendrait Martha responsable d'un engagement qu'elle ne contrôle pas. |
| Importer automatiquement les sessions du site travaux       | Aucune API connue, aucun export. Un raclage de page serait une dépendance invisible à un site tiers. La saisie est **manuelle**, assumée, et c'est le sujet de `Q-40-03`.                              |
| Suivre les UA d'une autre famille, ou le planning collectif | Martha est l'outil d'un foyer (ADR-0007). Ce n'est pas un produit associatif.                                                                                                                          |
| Valoriser un talent particulier à un taux différent         | Le RI évoque des savoir-faire valorisables sans barème public. Une conversion inventée serait un chiffre faux. `Q-40-04`.                                                                              |
| Encaisser, rembourser, suivre la caution comme un mouvement | Martha ne touche à aucun paiement. La caution est une **donnée de contexte** affichée, jamais un flux.                                                                                                 |

### La frontière, écrite une fois pour les cinq SFD

**Martha ne remplace ni le portail famille (Delta Enfance) ni le site travaux.** Pour ce foyer,
elle est une couche de **suivi, de rappel, de miroir et de vérification** : a-t-on réservé à
temps ? ce qui est facturé correspond-il à ce qui était réservé ? combien d'UA reste-t-il ? Toute
règle ci-dessous qui laisserait croire que Martha **inscrit** ou **paie** est une erreur de
rédaction, pas une intention.

## 3. Abstractions & modèle

```
Foyer ──< EngagementUa                     ← la période et ce qu'elle exige
             ├─ periode : { du: 2026-06-01, au: 2027-05-31 }
             ├─ quotaHeures            ← donnée, jamais une constante (RM-40-02)
             ├─ valeurUaCentimes       ← idem
             ├─ cautionCentimes        ← informatif
             └─ versionné à date d'effet (doc 30)

EngagementUa ──< SessionUa                 ← une ligne par créneau
             ├─ date, dureeHeures
             ├─ type : catalogue paramétré (ménage | cantine | grand ménage | CVE | talent | autre)
             ├─ etablissementId?      ← Mulhouse / Lutterbach, entité libre existante
             ├─ realisePar            ← un parent du foyer
             └─ etat : PREVUE | REALISEE | ANNULEE
```

Deux principes de conception, repris de la [doc 30](30-sfd-versionnement-dates-effet.md) §4 :

1. **Le cas réel est une instance.** « 20 h », « 31,25 € », « du 1er juin au 31 mai », « ménage »
   sont des **données**. Aucune ne s'écrit dans le code : un quota qui change à l'AG suivante se
   saisit, il ne se déploie pas.
2. **Le type de session est un catalogue paramétré**, pas une union de branches — même règle que
   le catalogue de types documentaires de la [SFD 38](38-sfd-rattachement-documentaire.md) §3.1.

### 3.1 Trois compteurs, jamais un seul

Le reste-à-faire n'est pas un nombre, c'en est trois, et les confondre est la première erreur
d'écran possible :

| Compteur    | Définition                                 | Ce qu'il sert à décider                                                      |
| ----------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| **Réalisé** | Σ des heures des sessions `REALISEE`       | Ce qui est acquis. Seul compteur qui alimente le calcul du coût.             |
| **Réservé** | Σ des heures des sessions `PREVUE` à venir | Ce qui est engagé mais pas encore fait — un créneau annulé le fait retomber. |
| **Restant** | `max(0, quota − réalisé − réservé)`        | Combien de créneaux il faut **encore aller chercher** sur le site travaux.   |

Le coût projeté, lui, se calcule sur le **réalisé seul** en fin de période, et sur
`réalisé + réservé` en cours de période — deux nombres différents, tous deux légitimes, et
l'écran doit dire lequel il montre (`RM-40-05`).

## 4. Acteurs

| Acteur           | Rôle                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Parent**       | Déclare l'engagement, saisit ses sessions, marque une session réalisée, consulte le reste-à-faire. Les deux parents voient tout.                |
| **Système**      | Calcule les trois compteurs, projette le coût résiduel, place l'échéance dans le récapitulatif existant.                                        |
| **Site travaux** | **Hors périmètre.** Système de réservation de l'association : Martha ne le lit pas, ne l'écrit pas, ne prétend pas le refléter automatiquement. |

## 5. User stories

### US-40-01 — Déclarer l'engagement de la période

En tant que parent, je saisis ce que le foyer doit pour la période en cours : quota, valeur de
l'UA, dates, caution.

- **CA1** : à la création, les valeurs connues de la [doc 02](02-modele-de-cout.md) §4.5 sont
  **proposées** (20 h, 31,25 €, 1er juin → 31 mai) et **modifiables** — proposées, jamais imposées.
- **CA2** : une période ne peut pas chevaucher une autre pour le même foyer.
- **CA3** : modifier un quota en cours de période crée une **version à date d'effet**, elle ne
  réécrit pas l'historique (doc 30) : ce qui a été affiché en février reste explicable.

### US-40-02 — Noter un créneau pris sur le site travaux

En tant que parent, je viens de réserver deux heures de ménage le samedi 17 octobre à Mulhouse ;
je le note dans Martha en trente secondes, depuis mon téléphone.

- **CA1** : la saisie tient en quatre champs — date, durée, type, qui s'y colle — le reste est
  facultatif.
- **CA2** : la session est créée à l'état `PREVUE` et compte immédiatement au compteur
  « réservé ».
- **CA3** : l'écran indique explicitement que **Martha n'a rien réservé** : la réservation reste
  celle du site travaux (`RM-40-01`).

### US-40-03 — Marquer une session réalisée, ou annulée

En tant que parent, après le créneau, je le marque fait — ou annulé s'il n'a pas eu lieu.

- **CA1** : passer à `REALISEE` déplace les heures du compteur « réservé » vers « réalisé », sans
  double comptage.
- **CA2** : `ANNULEE` retire les heures des deux compteurs et **remonte** le restant.
- **CA3** : une session passée encore `PREVUE` est **signalée** (« à confirmer »), jamais comptée
  d'office comme réalisée : Martha ne décide pas à la place du parent (`RM-40-06`).

### US-40-04 — Savoir où j'en suis

En tant que parent, je vois en un écran : réalisé, réservé, restant, jours avant le 31 mai, et le
coût si rien ne bouge.

- **CA1** : les trois compteurs du §3.1 sont affichés **distinctement**, avec leur définition en
  clair.
- **CA2** : le coût projeté annonce son hypothèse (« si tu réalises tes créneaux déjà réservés »
  ou « si tu t'arrêtes là »).
- **CA3** : quota atteint ⇒ l'écran dit « caution rendue, 0 € » — le sens métier, pas un zéro nu.

### US-40-05 — Ne pas découvrir le retard trop tard

En tant que parent, je suis prévenu pendant qu'il reste des créneaux à prendre.

- **CA1** : quand le restant est strictement positif et l'échéance à moins d'un seuil paramétrable
  (défaut **8 semaines**), le récapitulatif hebdomadaire **existant** porte une ligne « il reste
  X h d'UA, échéance le 31 mai ».
- **CA2** : **aucun courriel supplémentaire n'est créé** pour ce sujet (`RM-40-07`).
- **CA3** : le rappel cesse dès que le restant tombe à zéro, sans action du parent.

## 6. Règles métier

- **RM-40-01 — Martha ne réserve rien.** Toute session est une **recopie** d'un engagement pris
  ailleurs. Aucun écran ne doit laisser croire l'inverse ; c'est la frontière du §2.
- **RM-40-02 — Quota, valeur d'UA, période et types de session sont des données**, versionnées à
  date d'effet. Aucune valeur associative en dur dans le code (principe doc 30 §4, `RM-30-04`).
  Le défaut « 20 h / 31,25 € » du domaine actuel devient une **proposition d'écran**, pas une
  constante de calcul (`AM-112`).
- **RM-40-03 — Le calcul du coût ne change pas.** Il reste celui de la
  [doc 02](02-modele-de-cout.md) §4.5, déjà implémenté : heures manquantes × valeur d'UA,
  rattaché au dernier mois de la période. Cette SFD lui donne une **entrée réelle**, elle ne
  réécrit pas la formule.
- **RM-40-04 — Seul le réalisé solde l'obligation.** Un créneau réservé n'a rien acquitté.
- **RM-40-05 — Une projection annonce son hypothèse.** Un coût affiché sans dire s'il suppose les
  créneaux réservés réalisés est un chiffre qui ment par omission.
- **RM-40-06 — Aucune transition automatique d'état.** Le temps qui passe ne marque pas une
  session réalisée ; il la rend « à confirmer ».
- **RM-40-07 — Un seul canal sortant.** L'échéance UA emprunte le récapitulatif hebdomadaire
  existant et ses préférences de notification. Ouvrir un second envoi rouvrirait le risque de
  confiance n° 1 (tempête de courriels) pour un sujet qui n'a aucune urgence horaire.
- **RM-40-08 — Portée foyer et traçabilité.** Un engagement et ses sessions appartiennent au
  foyer (`@FoyerScope`), et leurs mutations s'inscrivent à la piste d'audit acteur
  ([doc 37](37-registre-des-traitements.md)) **dès le premier commit**, jamais « en différé ».

## 7. Cadre de sécurité & données personnelles

- **Aucun tiers nouveau.** Le site travaux n'est pas joint, aucune donnée ne sort. Le registre des
  traitements gagne au plus une **catégorie de données** au traitement existant du dossier de
  garde : « heures de bénévolat déclarées », portée foyer, conservation alignée sur celle du
  dossier — pas un traitement de plus.
- **Pas de donnée sensible.** Une session porte une date, une durée, un type et le prénom d'un
  parent. Rien qui relève de l'article 9. Le seuil d'`ADR-0007` n'est pas approché — écrit ici
  pour qu'aucune relecture ne conclue l'inverse.
- **Portabilité et rétention** : les deux tables nouvelles portent une ligne au registre
  ([doc 37](37-registre-des-traitements.md)), sans quoi `pnpm portabilite` et `pnpm retentions`
  — qui **dérivent leur attendu des schémas Drizzle** — échouent en CI. Classe proposée :
  **exportée**, purgée avec le foyer.

## 8. Découpage en lots

| Lot   | Contenu                                                                                                                       | Ce qui le clôt                                                                         |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **0** | Confirmer `Q-40-01` (quota et valeur 2026/27) et trancher `Q-40-02`. Zéro code.                                               | Les valeurs sont écrites dans la SFD, ou la SFD dit qu'elles restent celles de doc 02. |
| **1** | Modèle et persistance : engagement, sessions, versionnement, portée foyer, piste d'audit, lignes au registre des traitements. | `pnpm portabilite`, `pnpm retentions`, `pnpm acteur` verts sans exception ajoutée.     |
| **2** | Lecture et calcul : les trois compteurs, branchement du calcul existant sur le réalisé, route et contrat Pact.                | Un coût UA calculé depuis une saisie réelle, et non depuis un défaut de constructeur.  |
| **3** | Écran mobile : saisie en quatre champs, tableau de bord des compteurs, mention explicite « réservé sur le site travaux ».     | Parcours joué sur émulation mobile, pas seulement en desktop.                          |
| **4** | Échéance dans le récapitulatif existant, seuil paramétrable, arrêt automatique.                                               | Une sonde négative prouve qu'**aucun** second courriel n'est émis.                     |

> Le lot 1 ne démarre pas avant le lot 0 : brancher un calcul sur un quota faux coûte plus cher que
> de ne rien brancher.

## 9. Questions ouvertes

- **Q-40-01** — Le quota (20 UA), la valeur de l'UA (31,25 €) et la caution (625 €) valent-ils
  encore pour la période **2026/27** ? La [doc 02](02-modele-de-cout.md) §4.5 les tient du RI,
  annexe 2 (AG du 06/03/2026) ; le RI général de l'association n'a pas été relu depuis. **Ce qui
  est inconnu est étroit** : ce sont trois nombres à confirmer, pas un modèle à trouver.
  ⚠️ Voir `EM-20` : aucune session ne peut ouvrir ce document depuis le dépôt.
- **Q-40-02** — Quelle variante s'applique au foyer : accès unique (20 UA) ou **double accès
  portail** (10 UA par parent, doc 02 §4.5) ? La réponse change le quota de moitié et l'écran
  (un compteur, ou deux).
- **Q-40-03** — La saisie manuelle des sessions est-elle acceptable dans la durée, ou faut-il
  prévoir dès la v1 un **relevé de fin de période** (saisie d'un total plutôt que d'une liste) ?
  Recommandation : liste en v1 — un total ne dit pas ce qu'il reste à aller chercher.
- **Q-40-04** — Un talent valorisé (peinture, plomberie) se convertit-il en heures selon un
  barème ? À défaut de barème public, la v1 le saisit en heures comme les autres, type « talent ».

## 10. Ce que cette spécification engage

- **Deux tables nouvelles** et leurs lignes obligatoires au registre des traitements.
- **Une décision sur du code existant** : le calcul des UA est branché ou retiré ; le statu quo
  est explicitement refusé (`AM-112`).
- **Aucun canal de notification nouveau** — contrainte assumée, au prix d'un rappel moins visible.
- **Aucune intégration au site travaux**, ni en v1 ni en projet : la saisie manuelle est le
  contrat, pas un provisoire (`Q-40-03`).
- **Rien de ce qui suit ne dépend de cette SFD** : les [SFD 41](41-sfd-cantine-periscolaire-alsh-abcm.md)
  → [44](44-sfd-inscription-reinscription-pieces.md) peuvent avancer sans elle, et réciproquement.
