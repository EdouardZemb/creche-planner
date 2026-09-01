# 43 — SFD Calendrier scolaire ABCM : les dates qui décident de ce qui est réservable

> Statut : **BROUILLON — NE PAS DÉMARRER · en attente de validation PO** · Version 0.2 · 2026-09-01
> Quatrième des cinq spécifications du domaine associatif ABCM (40 → 44). **N'invente aucun
> modèle** : elle instancie le calendrier d'ouverture versionné de la
> [SFD 31](31-sfd-calendriers-vacances-scolaires.md) avec les dates réelles de l'année 2026/27, et
> **répond à sa question ouverte `Q-31-01`**. Ces dates pilotent la réservabilité des
> [SFD 41](41-sfd-cantine-periscolaire-alsh-abcm.md) et [42](42-sfd-vacances-alsh.md).
> Consigne `AM-120` ([doc 34](34-registre-ameliorations.md)).

## 0. Ce que ça demande au PO

Trois décisions, une réponse à une question qui traînait depuis juillet — et, depuis le
2026-09-01, **un arbitrage PO qui referme `Q-43-01`**.

### La réponse d'abord — `Q-31-01` est tranchée par les faits

La SFD 31 laissait ouverte une question : « l'école bilingue suit-elle exactement la zone B, ou
publie-t-elle son propre calendrier ? ». Les dates 2026/27 y répondent, et la réponse n'est ni
l'une ni l'autre :

- **les vacances scolaires suivent la zone B** — l'import automatique reste pertinent ;
- **mais l'ALSH n'ouvre pas sur toute la durée des vacances.** À la Toussaint, une seule semaine
  (du 19 au 23 octobre) sur les deux ; en été, deux fenêtres seulement (5 au 16 juillet, puis
  23 au 27 août), séparées par plus de cinq semaines de fermeture.

**Conséquence structurante** : le calendrier officiel donne les **vacances**, jamais les
**ouvertures d'ALSH**. Ces dernières sont des **retouches manuelles**, une par année, et
elles ne peuvent pas être dérivées d'une source publique. C'est exactement ce que l'architecture
« import plus retouches » de la SFD 31 prévoyait — cette SFD confirme que la moitié « retouches »
n'est pas une soupape, c'est le travail annuel principal (`AM-120`).

### ✅ Tranchée le 2026-09-01 — Dornach est un lieu, pas un site tarifaire

`Q-43-01` demandait si Dornach était un troisième établissement. **Non** : il n'y a que **deux
sites tarifaires**, Mulhouse et Lutterbach, et ce qui se passe à Dornach **facture en Mulhouse**.

Ce que ça change ici : un **lieu** peut entrer au calendrier sans qu'aucune grille tarifaire ne
lui soit due. Un établissement porte donc deux choses distinctes — son **calendrier d'ouverture**
(qui lui est propre) et son **site tarifaire** (qui ne prend que deux valeurs). La règle vit en
[SFD 41](41-sfd-cantine-periscolaire-alsh-abcm.md) `RM-41-13` ; elle est rappelée ici parce que
c'est **au moment de saisir les établissements** (lot 1) qu'on peut encore se tromper.

### Les trois décisions

1. **Un événement associatif n'est pas une fermeture.** Fête d'automne, Saint-Martin, portes
   ouvertes, assemblée générale, kermesse : ce sont des **repères**, pas des jours fermés. Les
   injecter comme exceptions de calendrier fermerait des jours réservables et fausserait des
   factures. **Recommandation : les tenir hors du calendrier d'ouverture** en v1, ou dans une
   couche purement informative qui ne peut pas rendre un jour non réservable (`RM-43-03`).
2. **Le régime de fériés est celui d'Alsace-Moselle.** Mulhouse et Lutterbach sont dans le
   Haut-Rhin : le Vendredi saint et le 26 décembre sont fériés. Le produit sait déjà le faire
   (régime de fériés par établissement), mais `AM-106` reste ouverte sur l'historisation de ce
   réglage. **Recommandation : saisir le bon régime dès la création des deux établissements**, ce
   qui évite d'avoir un jour à le corriger — c'est précisément la correction qu'`AM-106` redoute.
3. **Deux sites, deux calendriers, ou un seul ?** Certaines dates sont communes (vacances,
   fériés), d'autres non (réunions de rentrée, fêtes, et surtout les horaires et services). **Le
   modèle de la SFD 31 rattache un calendrier à un établissement** : la réponse est donc « deux »,
   et la question devient : que fait-on de la part commune ? **Recommandation : saisir deux fois
   les périodes de vacances plutôt que d'inventer un héritage de calendrier** — la v1 n'a que deux
   établissements, et un mécanisme d'héritage coûterait plus cher que la double saisie.

### Ce que cette spécification ne décide pas

**Rien de modèle.** Elle ne demande aucune table, aucune règle de résolution, aucune couche
nouvelle : tout cela est spécifié en SFD 31 et son lot 1 est livré. Elle demande une **saisie**,
un écran pour la faire, et une vérification.

## 1. Contexte & problème

Trois services de la [SFD 41](41-sfd-cantine-periscolaire-alsh-abcm.md) ne fonctionnent **ni les
jours fériés ni pendant les vacances** ; l'ALSH ne fonctionne **que** les mercredis et certaines
semaines de vacances. Tout ce qui décide « ce jour-là, ce service est réservable » vient donc du
calendrier — et le calendrier, aujourd'hui, ne contient **aucune date ABCM**.

Sans elles, deux défauts sont garantis, et ils sont silencieux : des jours de cantine facturés
pendant les vacances, et des semaines d'ALSH invisibles parce que rien ne dit qu'elles sont
ouvertes.

### 1.1 Constat négatif — relevé sur `main` (`80e2875`), le 2026-09-01

| Point                                      | État réel                                                                                                                                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le modèle de calendrier                    | **Livré en domaine pur** : `libs/planification/domain/src/lib/calendrier-ouverture.ts` — trois couches (exception > férié > période > récurrence), axe de connaissance, historisation par ligne. Lot 1 de la SFD 31, mergé. |
| La persistance et la lecture du calendrier | **En revue, non mergée** (lot 2 de la SFD 31). Tant qu'elle n'est pas là, **aucune date ne peut être saisie** : cette SFD est mécaniquement bloquée derrière elle.                                                          |
| L'import de la zone B                      | **Spécifié, non livré** (lots suivants de la SFD 31).                                                                                                                                                                       |
| Les jours fériés                           | **Calculés**, pas importés, avec un régime par établissement (Alsace-Moselle disponible). L'historisation du **choix du régime** reste ouverte en `AM-106`.                                                                 |
| Les jours non facturables actuels          | **Existent** (`jour_non_facturable` au Référentiel) et deviendront une projection du calendrier — la SFD 31 a déjà écrit que la reprise ne recréerait des exceptions que pour la crèche, et que l'écart est **attendu**.    |
| Les dates ABCM 2026/27                     | **Nulle part.** Ni vacances, ni ouvertures d'ALSH, ni réouverture du 31 août.                                                                                                                                               |

## 2. Périmètre

### Dans le périmètre (v1)

- **Saisir les deux établissements** Mulhouse (1 rue du Tunnel) et Lutterbach (20 rue des
  Chevreuils) avec leur régime de fériés, leurs services offerts et leurs horaires.
- **Saisir l'année 2026/27** : périodes scolaires et vacances, **fenêtres d'ouverture de l'ALSH**,
  réouverture du périscolaire, jours de rentrée.
- **Vérifier** que la réservabilité qui en découle est celle qu'on attend, mois par mois.
- **Documenter le geste annuel** : ce qui se réimporte, ce qui se ressaisit, et combien de temps
  ça prend.

### Hors du périmètre (v1) — et pourquoi

| Écarté                                            | Raison                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Le modèle de calendrier, ses couches, sa priorité | Spécifié et livré par la [SFD 31](31-sfd-calendriers-vacances-scolaires.md). Le redéfinir créerait un second calendrier. |
| L'import automatique de la zone B                 | Lot de la SFD 31. Cette SFD s'appuie dessus quand il existe, et saisit à la main en attendant.                           |
| Les événements associatifs comme jours fermés     | Un événement n'est pas une fermeture (§0, décision 1). Les injecter comme exceptions fausserait la facturation.          |
| Un héritage de calendrier entre établissements    | Deux établissements ne justifient pas un mécanisme. Double saisie assumée (§0, décision 3).                              |
| Le calendrier de la crèche                        | Déjà couvert : fermetures propres saisies, aucune notion de vacances scolaires.                                          |

## 3. Les données de l'année 2026/27

Ce sont des **données à saisir**, pas du contenu de code — principe doc 30 §4, `RM-31-05`. Elles
sont reproduites ici pour être vérifiables et datées.

### 3.1 Ce qui pilote la réservabilité

| Fait                        | Date                         | Effet sur le calendrier                                                               |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| Réouverture du périscolaire | **lundi 31 août 2026**       | Services périscolaires ouverts **avant** la rentrée : un jour d'ouverture sans école. |
| Rentrée scolaire            | **mardi 1er septembre 2026** | Début de la période scolaire (école, cantine, périscolaire).                          |
| ALSH — Toussaint            | **19 au 23 octobre 2026**    | **Une semaine sur deux** de vacances : la seconde reste fermée.                       |
| ALSH — hiver                | **22 au 26 février 2027**    | Idem, une semaine.                                                                    |
| ALSH — printemps            | **19 au 23 avril 2027**      | Idem, une semaine.                                                                    |
| ALSH — été, fenêtre 1       | **5 au 16 juillet 2027**     | Deux semaines.                                                                        |
| ALSH — été, fenêtre 2       | **23 au 27 août 2027**       | Une semaine, après plus de cinq semaines de fermeture.                                |
| Vacances scolaires (toutes) | zone B                       | Importées ; école, cantine et périscolaire fermés.                                    |
| Jours fériés                | régime **Alsace-Moselle**    | Calculés ; incluent le Vendredi saint et le 26 décembre.                              |

> **La lecture qui compte** : « vacances » et « ALSH ouvert » sont **deux informations
> différentes**. Une semaine de vacances sans ALSH n'offre **aucun** service — c'est un trou de
> garde, et c'est précisément ce que la famille doit voir venir.

### 3.2 Ce qui ne pilote rien — les repères de l'année

| Événement                       | Date              | Site                        |
| ------------------------------- | ----------------- | --------------------------- |
| Réunion de rentrée              | 18 septembre 2026 | Lutterbach                  |
| Réunion de rentrée              | 25 septembre 2026 | Mulhouse / Dornach          |
| Fête d'automne                  | 9 octobre 2026    | —                           |
| Halloween — _à confirmer_       | 21 octobre 2026   | Lutterbach                  |
| Saint-Martin, primaires         | 10 novembre 2026  | Dornach                     |
| Saint-Martin, maternelles       | 13 novembre 2026  | Lutterbach                  |
| Portes ouvertes                 | 21 novembre 2026  | —                           |
| Fête de Noël — _à confirmer_    | 29 novembre 2026  | Lutterbach                  |
| Portes ouvertes                 | 16 janvier 2027   | —                           |
| Assemblée générale Regio Schule | 12 mars 2027      | —                           |
| Chasse aux œufs                 | 20 mars 2027      | —                           |
| Portes ouvertes — _si besoin_   | 27 mars 2027      | —                           |
| Kermesse                        | 19 juin 2027      | Société d'Hygiène Naturelle |

⚠️ **Trois de ces lignes portent « à confirmer » ou « si besoin » dans la source.** Elles entrent
telles quelles, avec leur réserve visible : une date affichée comme certaine alors qu'elle ne l'est
pas est pire que pas de date du tout (`RM-43-04`).

## 4. Acteurs

| Acteur      | Rôle                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| **Parent**  | Déclenche l'import, saisit les fenêtres d'ALSH et les fermetures, vérifie le résultat mois par mois.     |
| **Système** | Résout la réservabilité d'un jour, signale les incohérences avec ce qui est déjà réservé et non facturé. |

## 5. User stories

### US-43-01 — Déclarer les deux établissements

En tant que parent, je crée Mulhouse et Lutterbach avec leur adresse, leur régime de fériés, leurs
services et leurs horaires.

- **CA1** : le régime de fériés est saisi **à la création** — jamais laissé au défaut national
  pour être corrigé plus tard (§0, décision 2 ; `AM-106`).
- **CA2** : les services offerts diffèrent (pas de périscolaire du matin à Lutterbach), et cette
  différence est **portée par la donnée**, pas par un écran.
- **CA3** : chaque établissement déclare son **site tarifaire** (`Mulhouse` ou `Lutterbach`) — un
  lieu supplémentaire, Dornach compris, se rattache à l'un des deux et n'appelle **aucune grille
  nouvelle** (`RM-43-07`).

### US-43-02 — Poser l'année 2026/27

En tant que parent, je saisis en une session les périodes et les fenêtres d'ALSH de l'année.

- **CA1** : les vacances viennent de la zone B (import quand il existe, saisie sinon).
- **CA2** : chaque fenêtre d'ALSH est une **ouverture explicite** sur une période de vacances,
  jamais une déduction.
- **CA3** : la réouverture du périscolaire au 31 août est représentable : un jour où les services
  périscolaires sont ouverts et l'école fermée.

### US-43-03 — Vérifier avant de s'y fier

En tant que parent, je contrôle mois par mois que ce qui est réservable correspond à la réalité.

- **CA1** : une vue mensuelle distingue période scolaire, vacances, jour fermé, ALSH ouvert.
- **CA2** : chaque jour fermé affiche **son motif** (férié, vacances, fermeture saisie).
- **CA3** : les jours **déjà réservés et non encore facturés** qui deviendraient fermés sont
  listés comme incohérences, jamais supprimés en silence — règle existante (`CA4` d'`US-31-03`).

### US-43-04 — Voir les repères de l'année sans qu'ils ferment quoi que ce soit

En tant que parent, je vois la kermesse et les portes ouvertes dans le calendrier.

- **CA1** : un repère est visuellement distinct d'une fermeture.
- **CA2** : aucun repère ne peut rendre un jour non réservable (`RM-43-03`).
- **CA3** : une date non confirmée le dit.

## 6. Règles métier

- **RM-43-01 — Aucune date en dur.** Toutes les dates de cette SFD sont des données saisies ou
  importées. Un test qui figerait « 19 octobre 2026 » dans du code recréerait la constante que la
  SFD 31 a supprimée.
- **RM-43-02 — « Vacances » et « ALSH ouvert » sont deux couches distinctes.** L'ouverture de
  l'ALSH est une **exception d'ouverture** sur une période de vacances, et rien ne permet de la
  déduire du calendrier officiel (`AM-120`).
- **RM-43-03 — Un événement associatif ne ferme rien.** Il n'a aucun effet sur la réservabilité ni
  sur la facturation.
- **RM-43-04 — Une date incertaine est affichée comme incertaine.** Les mentions « à confirmer » et
  « si besoin » de la source sont conservées jusqu'à confirmation.
- **RM-43-05 — Le régime de fériés se saisit à la création.** Le corriger après coup changerait
  l'interprétation de mois déjà facturés — ce que `RM-31-03` interdit, et ce qu'`AM-106` a laissé
  ouvert.
- **RM-43-06 — La saisie est annuelle et manuelle, et c'est assumé.** Aucune tâche de fond
  n'interroge de source externe (décision PO du 2026-08-16, `Q-31-02`).
- **RM-43-07 — Un lieu n'est pas un site tarifaire.** Le calendrier est propre à un
  établissement ; le **barème**, lui, n'est indexé que sur deux sites tarifaires. Saisir un lieu
  de plus ne doit jamais créer une combinaison de grille vide — la règle vit en
  [SFD 41](41-sfd-cantine-periscolaire-alsh-abcm.md) `RM-41-13`, et c'est **à la saisie** qu'elle
  se respecte ou se perd (décision PO du 2026-09-01).

## 7. Cadre de sécurité & données personnelles

- **Aucune donnée personnelle.** Ce document ne porte que des dates et des adresses
  d'établissements, déjà publiques.
- **Un import externe reste un import externe** : quand le lot d'import de la SFD 31 existera, son
  échec ne doit pas empêcher l'application de fonctionner (`CA3` d'`US-31-01`), et cette SFD ne
  change pas cette exigence.
- **Aucun tiers nouveau, aucun flux sortant.**

## 8. Découpage en lots

| Lot   | Contenu                                                                                         | Ce qui le clôt                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **0** | **Attendre** : le calendrier doit être persistant et interrogeable (SFD 31, lot 2 et suivants). | Une période saisie survit à un redémarrage et se relit par l'API.                              |
| **1** | Les deux établissements, avec régime de fériés, services et horaires.                           | Une saisie de périscolaire du matin à Lutterbach est **impossible**, pas seulement découragée. |
| **2** | L'année 2026/27 : périodes, fenêtres d'ALSH, réouverture du 31 août.                            | La vue mensuelle de novembre 2026 montre exactement ce que le courrier de rentrée annonce.     |
| **3** | Les repères de l'année, en couche informative sans effet.                                       | Une sonde négative prouve qu'aucun repère ne ferme un jour.                                    |
| **4** | Le mode d'emploi du geste annuel (ce qui s'importe, ce qui se ressaisit, en combien de temps).  | Le geste est écrit là où on le cherchera l'an prochain, pas dans une PR.                       |

## 9. Questions ouvertes

- ~~**Q-43-01** — **Dornach est-il un site distinct de Mulhouse ?**~~ → **tranchée le
  2026-09-01** : **non**. Deux sites tarifaires seulement — Mulhouse et Lutterbach ; Dornach est
  un **lieu** qui facture en Mulhouse. La clé de grille de la
  [SFD 41](41-sfd-cantine-periscolaire-alsh-abcm.md) ne gagne donc **pas** de troisième valeur, et
  la distinction lieu / site tarifaire devient une règle opposable (`RM-41-13`).
- **Q-43-02** — Les **deux sites ferment-ils aux mêmes dates** ? Les fenêtres d'ALSH fournies ne
  sont pas attribuées à un site en particulier. Si elles diffèrent, la double saisie du §0 devient
  une nécessité et non un choix.
- **Q-43-03** — Le **31 août** est-il une réouverture du périscolaire **et** de la cantine, ou du
  périscolaire seul ? Le courrier dit « périscolaire ». Sans école ce jour-là, une cantine ouverte
  serait un cas particulier à écrire.
- **Q-43-04** — Le calendrier de l'ALSH est-il stable d'une année sur l'autre (mêmes semaines
  relatives) ? Si oui, un modèle réutilisable ferait gagner la saisie annuelle — ce que la
  décision PO du 2026-08-16 a écarté en v1 (`Q-31-03`), et qu'il faudrait rouvrir avec cette
  donnée en main.

## 10. Ce que cette spécification engage

- **Aucun code de modèle** — c'est une SFD de **données** et d'écran de saisie.
- **Une réponse à `Q-31-01`** : la zone B suffit pour les vacances, jamais pour l'ALSH ; la
  retouche annuelle est le travail principal, pas l'exception (`AM-120`).
- **Un blocage assumé** : rien ici ne démarre avant le lot de persistance de la SFD 31.
- **Un geste annuel récurrent**, à documenter comme tel — sans quoi il sera redécouvert chaque
  été.
- **Une dépendance amont pour les [SFD 41](41-sfd-cantine-periscolaire-alsh-abcm.md) et
  [42](42-sfd-vacances-alsh.md)** : sans ces dates, leurs règles de réservabilité ne sont pas
  démontrables.
