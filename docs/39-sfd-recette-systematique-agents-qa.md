# 39 — SFD Recette systématique & agents QA : jouer le parcours d'un vrai parent avant de livrer

> Statut : **Validée** · Version 1.0 · 2026-08-29
> Étend la [stratégie de test](21-politique-strategie-test.md) §2 d'un niveau qu'elle ne porte
> pas : la **recette de parcours**. Instruit les pistes `AM-110` → `AM-115` et l'empêchement
> `EM-20` ([doc 34](34-registre-ameliorations.md)). Déclenchée par les trois défauts trouvés par
> un vrai parent le **2026-08-29**, tous passés au travers de la suite existante. Reprend le
> cadre de sécurité de l'orchestrateur d'agents (§8).

## 0. Décision PO du 2026-08-29

Cette spécification est **validée** et passe de v0.1 à **v1.0**. Les **sept** questions ouvertes
de la v0.1 sont tranchées : cinq suivent la recommandation, **une la renverse** (`Q-39-05`), et
**une refuse le format de la question** (`Q-39-04`). Le découpage passe de 5 à **6 lots** :
la remise en état de staging cesse d'être un prérequis flottant pour devenir le **lot 0**.

### Le lot 1 est démarrable — dès que le lot 0 est levé

C'est la conséquence pratique de cette validation : plus rien n'attend une décision. Ce qui
attend est un **geste** (`Q-39-02`), et il est désormais nommé, découpé et daté par son propre
lot.

### Trois décisions qui changent le corps du document, pas seulement l'annexe

**1. La remise en état de staging est un préalable BLOQUANT** (`Q-39-02`, `RM-39-10`). Une
recette sans environnement de recette n'existe pas. Aucune campagne — rôle A comme rôle B — ne
démarre avant que staging reflète `main` et l'ait **prouvé**. Le lot 0 (§9) porte les trois
sous-questions à lever : le poller tourne-t-il encore ? les images qu'il surveille couvrent-elles
les **sept** services applicatifs actuels ? le geste de secours (`remote-deploy.ps1
-Environment staging`, ou un tick forcé côté serveur) suffit-il, ou faut-il un bootstrap ?

**2. Le persona n'est pas un foyer inventé : c'est le foyer réel, rejoué dans le temps**
(`Q-39-05`, `US-39-07`, `RM-39-03`). Le PO renverse ici la recommandation prudente de la v0.1.
Le socle du persona « parent mobile » est la **configuration réelle du foyer d'Anna-Louise et
d'Édouard**, avec leur consentement, **cantonnée à staging** — puis on **simule son évolution
dans le temps** : chaque rentrée et ses nouveaux contrats, les vacances scolaires, les périodes
de trou. Le persona n'est **pas un état figé**, c'est une **trajectoire**.

> ⚠️ **Cette décision amende `RM-39-03`.** La v0.1 écrivait « données synthétiques seulement,
> aucun jeu de données extrait de la production, même anonymisé ». C'est **abandonné**, et
> remplacé par une règle plus étroite et plus honnête : la configuration du **seul** foyer du PO,
> consentie, cantonnée à staging, jamais celle d'un autre foyer. Ce que cela coûte est écrit au
> §12 — une copie de données personnelles réelles dans un second environnement est un
> **traitement**, et [doc 37](37-registre-des-traitements.md) ne le porte pas encore (`AM-114`).

**3. Le budget ne se décrète pas, il se mesure** (`Q-39-04`, `RM-39-04`, lot 2). Le PO refuse de
poser un chiffre à l'aveugle : la valeur attendue est « **suffisante pour un niveau de qualité
satisfaisant** », ce qui est un **résultat**, pas une entrée. La question devient donc une
**démarche de calibration** : jouer la même campagne à **plusieurs niveaux de budget**, mesurer
le rendement (défauts trouvés par euro), et retenir le point où la courbe s'aplatit.

### Décisions confirmant la recommandation, sans changement

- **`Q-39-01` — moteur : option (c)**, le mélange (piloter pour explorer, écrire du Playwright
  pour figer), en **démarrant le lot 1 en (a)** : l'agent écrit et lance du Playwright, parce que
  le parcours d'Anna-Louise est déjà connu et n'a pas besoin d'être découvert.
- **`Q-39-03` — GO/NO-GO consultatif au premier train**, bloquant ensuite **si et seulement si**
  il a déjà trouvé quelque chose (`RM-39-08`).
- **`Q-39-06` — le verdict vit dans le dépôt** : un fichier court par train, versionné.
- **`Q-39-07` — le rôle B reste en suspens**, à statuer **après plusieurs trains**, avec le compte
  d'`US-39-06` en main. La réponse par défaut demeure **non**.

### Ce que la validation ne décide pas

**Le moment du lot 0.** Il dépend d'un accès au poste principal ou au LAN (`EM-20`), qu'aucune
décision ne fabrique. La validation rend le chantier **prêt**, elle ne le rend pas **joignable**.

---

## 1. Contexte & problème — le 29 août, trois défauts sont passés

Le 2026-08-29, **Anna-Louise** — vrai parent, compte non-administrateur, téléphone Android — a
créé dans l'application le contrat de rentrée de sa fille. Le parcours a produit **trois
défauts**. Aucun n'est exotique. Aucun n'a été trouvé par la suite de tests, qui compte pourtant
onze niveaux gouvernés ([doc 21](21-politique-strategie-test.md) §2), des tests de mutation à
99,55 % sur `tarification-domain`, une vérification bidirectionnelle Pact, treize scénarios E2E
sur pile réelle et onze portes bloquantes dans le job `ci`.

Ce tableau décrit l'état du dépôt **au 29 août**, jour du constat — les correctifs sont arrivés
depuis, et la dernière colonne dit lesquels :

| #   | Ce qu'a vu le parent                                                                                    | Ce qui aurait dû l'arrêter          | Pourquoi rien ne l'a arrêté, et où en est le correctif                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **1607 h/an** acceptées pour une semaine type de **27 h**, et facturées ainsi                           | Une règle métier de cohérence       | **Elle n'existait pas** : les seules bornes du volume annuel étaient `z.number().nonnegative()` et `≥ 0`. ✅ **Corrigé le 2026-08-30 (#359)** — la règle vit dans `shared-semaine`, et l'impossible est refusé des deux côtés. |
| 2   | Le **calendrier mensuel à onglets** cassé : deux contrats, un mois de trou entre l'ancien et le nouveau | Un scénario E2E sur données réelles | **Le défaut ne se révèle qu'avec ces données-là** : un contrat unique, ou deux contrats contigus, rendent correctement. ✅ **Corrigé le 2026-08-30 (#360)** — l'onglet est le contrat, et un mois vide dit pourquoi il l'est.  |
| 3   | Un **404 inter-services** rendu tel quel, avec un **UUID brut** affiché à un parent                     | Une garde sur les messages d'erreur | **Il n'y en a aucune**, et il n'y en a **toujours aucune** : 27 messages `introuvable` interpolent encore un identifiant dans `svc-foyer` et `svc-planification` seuls. L'instance a été traitée, la famille reste (`AM-113`). |

> **Ce que ces correctifs ne changent pas — et c'est tout le sujet.** Les trois défauts sont
> réparés, la cause de leur **non-détection** ne l'est pas : le 2026-08-30, aucune spec de pile
> réelle ne tourne toujours en émulation mobile, aucune ne visite `2026-08`, et rien n'empêche un
> UUID d'atteindre un écran (§1.1, mesures reprises sur `main` après le merge de #359, #360 et
> #361). Réparer trois défauts n'a jamais fermé le trou par lequel ils sont entrés.

### 1.1 Le constat négatif — ce que la suite ne joue pas

Les trois défauts ont **une seule cause de non-détection**, et elle est structurelle : la suite
teste des **unités** et des **contrats**, elle ne joue jamais le **parcours** d'une vraie
personne, sur un **vrai téléphone**, avec les **données d'une vraie famille**. Quatre mesures,
prises sur le dépôt et non supposées :

- **Aucune des 13 specs `*.stack.e2e.spec.ts` ne tourne en émulation mobile.**
  `apps/web/playwright.stack.config.ts` ne déclare qu'un seul projet : `Desktop Chrome`. La seule
  spec mobile du dépôt (`planning-creche-mobile.e2e.spec.ts`, `devices['Pixel 5']`) est **mockée
  par `page.route`**, ne touche aucun service, et ne porte **qu'un contrat**. → `AM-111`.
- **Le mois de trou existe déjà dans le jeu de démonstration, et aucune spec ne le regarde.**
  `scripts/seed-demo.mjs` pose Zoé en crèche jusqu'au **31/07/2026** puis en ABCM à partir du
  **01/09/2026** : le trou d'août est là. Les mois demandés par les specs stack sont `2026-01`,
  `03`, `06`, `07`, `09`, `10` — **jamais `2026-08`**. La donnée porte le cas, le scénario ne le
  visite pas. → `AM-112`.
- **Aucune garde ne refuse qu'un identifiant technique atteigne un écran.** Le motif
  `` `foyer introuvable : ${id}` `` se compte par dizaines dans `svc-foyer`, `svc-planification`
  et `svc-notifications`, et la passerelle relaie le message en `detail` (RFC 9457). Le défaut
  n° 3 n'est pas un cas isolé : c'est **une famille entière**. → `AM-113`.
- **La stratégie de test n'a pas de niveau où ces défauts auraient dû tomber.** Le tableau de la
  [doc 21](21-politique-strategie-test.md) §2 va de l'unitaire au smoke de performance ; son
  niveau le plus haut, « E2E stack réelle », a pour objectif l'**anti-régression d'intégration**,
  déclenché par « toute évolution touchant un parcours utilisateur ». Il garde donc ce qu'on a
  **déjà** écrit, jamais ce qu'on n'a **jamais** joué. → `AM-110`.

> **La leçon, en une phrase.** Une suite qui ne contient que les cas qu'on a su écrire ne trouve
> que les défauts qu'on a su imaginer. Les trois défauts du 29 août ne demandaient pas plus de
> tests : ils demandaient **quelqu'un qui se sert de l'application**.

### 1.2 Ce que ce document n'accuse pas

La suite existante n'est pas en défaut : elle fait ce qu'elle promet, et le registre d'anomalies
([doc 22](22-registre-anomalies.md)) montre qu'elle attrape beaucoup. Les trois défauts eux-mêmes
sont des **anomalies produit** : ils appartiennent au doc 22, pas à cette spécification. Ce
document ne parle que du **trou entre les niveaux**, et de ce qu'on y met.

> ⚠️ **Sauf qu'ils n'y sont pas entrés.** Les trois PR de correction (#359, #360, #361, mergées le
> 2026-08-30) n'ont **ouvert aucune ligne `AN-xx`** : le registre s'arrête toujours à `AN-21`, et
> `docs/22-registre-anomalies.md` n'a pas été touché. Ce n'est pas un détail de forme : le §3 de
> ce registre calcule le **DDP par niveau de détection** — la part des défauts trouvés à chaque
> étage. Trois défauts trouvés **en production par un utilisateur**, absents du calcul, font
> paraître la détection meilleure qu'elle n'est, précisément sur le niveau que cette
> spécification existe pour créer. `AM-115` le met en file.

---

## 2. Principe cardinal — l'agent explore, la CI juge

**À écrire noir sur blanc, parce que tout le reste en découle :**

> **L'agent EXPLORE. Chaque défaut trouvé est CONVERTI en test déterministe permanent
> (Playwright, Pact ou unitaire) qui vit en CI. L'agent n'est JAMAIS le portail de livraison.**

Un agent est **non déterministe** (deux campagnes identiques ne trouvent pas les mêmes choses),
**coûteux** (de quelques dizaines de centimes à quelques euros par campagne) et **faillible** (il
peut manquer aujourd'hui ce qu'il a trouvé hier). Aucune de ces trois propriétés n'est acceptable
pour une porte. Toutes les trois sont exactement ce qu'on attend d'un **explorateur**.

Cinq corollaires, qui deviennent des règles au §7 :

1. **Aucun job de `ci.yml` ne dépend d'un agent.** Une campagne rouge n'empêche aucun merge ;
   c'est le **test qu'elle a écrit** qui l'empêchera, une fois en CI.
2. **Un défaut trouvé et non converti est un défaut perdu.** La sortie d'une campagne n'est pas
   un rapport : c'est **un test qui échoue sur `main`**, puis une anomalie `AN-xx`.
3. **Un agent qui ne trouve rien n'est pas un succès.** C'est un signal à lire : soit le parcours
   est sain, soit la campagne n'a rien joué. Le journal (§8.4) doit permettre de distinguer les
   deux — sans quoi on retombe sur ce que toutes les portes du dépôt s'interdisent : une
   conclusion par défaut ([doc 35](35-politique-documentation.md) §5).
4. **La valeur se mesure en tests ajoutés, pas en campagnes lancées.** Le KPI du chantier est le
   nombre de **tests permanents nés d'une exploration**, et le nombre de défauts qu'ils ont
   retenus **ensuite**.
5. **Ce que l'agent produit est relu.** Un test écrit par un agent entre par une PR, passe les
   portes, et se lit comme n'importe quel test — y compris pour la règle maison : asserter le
   **message**, pas seulement la classe ([doc 21](21-politique-strategie-test.md) §2.4).

---

## 3. Périmètre

### Dans le périmètre (v1)

- La **remise en état de staging** (§9, lot 0) — **préalable bloquant** de tout le reste depuis la
  décision PO du 2026-08-29 (`RM-39-10`).
- Un **rôle d'agent de recette d'acceptation par persona** (§4.1), joué **avant un train de
  release**, sur **staging**, produisant un **GO/NO-GO écrit** qui vit **dans le dépôt**.
- Un **rôle d'agent de campagne système exploratoire** (§4.2), joué **hors train**, sur staging,
  sur des jeux de données réalistes semés exprès. **Son opportunité reste à statuer** après
  plusieurs trains (`Q-39-07`).
- Le **convertisseur** commun (§4.3) : la discipline et l'outillage qui font qu'un défaut trouvé
  devient un test permanent.
- Les **personas**, créés **par le dispositif lui-même** en base staging (`US-39-07`), à partir de
  la configuration réelle du foyer du PO et **rejoués dans le temps** — rentrées, vacances,
  périodes de trou —, dont le cas **« deux contrats, un mois de trou »** qui a révélé le défaut
  n° 2.
- La **calibration empirique du budget** (§9, lot 2) : des campagnes à budgets étagés, et
  l'analyse coût/défauts qui en tire un budget cible (`RM-39-04`).
- Le **branchement** sur les deux processus existants : les critères d'acceptation des SFD (§4.4)
  et le train de release
  ([doc 24](exploitation/24-plan-deploiement-serveur-ct-qdo.md) §12).

### Hors périmètre (v1) — et pourquoi

| Écarté                                                     | Raison                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tout agent qui touche la **production**                    | Le §8.1 en fait une règle absolue. La prod porte les données d'une vraie famille et un mailer réel, dont l'adresse d'une crèche réelle.                       |
| Un agent en **porte de PR**                                | Contredit le principe cardinal (§2). Non négociable en v1, et probablement jamais.                                                                            |
| Le remplacement d'un niveau de test existant               | Cette spécification **ajoute** un étage ; elle n'en retire aucun. La pyramide ne s'inverse pas ([doc 18](18-audit-gestion-tests-ctal-tm-tmmi.md) axe E.7).    |
| La **génération autonome de code de correction**           | L'agent écrit des **tests** et des **constats**. Corriger reste un lot, avec sa PR et sa revue.                                                               |
| Les tests de **charge** et la **sécurité offensive**       | Couverts ailleurs ([doc 23](23-smoke-performance.md), job `security`) et gouvernés autrement.                                                                 |
| Un **parc de vrais appareils** (BrowserStack et assimilés) | Coût récurrent sans rapport avec la taille du foyer. L'émulation `Pixel 5` de Playwright a déjà trouvé du vrai (`planning-creche-mobile`) — commencer par là. |

---

## 4. Les deux rôles d'agent

Ce sont **deux rôles**, pas deux programmes : ils partagent le même harnais, le même cadre de
sécurité (§8) et le même convertisseur (§4.3). Ce qui les distingue est **le déclencheur, la
consigne et la sortie**.

### 4.1 Rôle A — recette d'acceptation par persona

| Aspect          | Ce que c'est                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Déclencheur** | **Avant chaque train de release**, une fois staging aligné sur les images candidates                                                                 |
| **Cible**       | Staging uniquement (§8.1), et seulement après le **lot 0** (`RM-39-10`)                                                                              |
| **Moteur**      | **Playwright écrit et lancé par l'agent** au lot 1 — option (a) de `Q-39-01`, le parcours étant déjà connu ; le pilotage de navigateur vient ensuite |
| **Consigne**    | Rejouer les **critères d'acceptation** des SFD et des lots embarqués dans le train, **par persona** (parent mobile, gestionnaire, admin)             |
| **Sortie**      | Un **GO/NO-GO écrit**, daté, découpé par persona, **versionné dans le dépôt** — un fichier court par train (`Q-39-06`)                               |
| **Portée**      | **Consultatif au premier train**, bloquant ensuite si et seulement s'il a déjà trouvé quelque chose (`RM-39-08`)                                     |
| **Coût visé**   | Une campagne par train (≈ une tous les 10 à 20 jours), plafonnée à un budget **calibré** et non décrété (§8.2, `RM-39-04`)                           |

C'est **borné** : la liste des critères à rejouer est finie et connue à l'avance. C'est ce qui en
fait le premier lot exécutable (§9).

### 4.2 Rôle B — campagne système exploratoire

| Aspect          | Ce que c'est                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Déclencheur** | Hors train : à la demande, ou périodiquement (hebdomadaire, comme `mutation.yml`)                                                                   |
| **Cible**       | Staging uniquement, sur des **jeux de données semés exprès** (§10)                                                                                  |
| **Consigne**    | **Explorer** : se comporter comme un parent qui découvre, sortir des chemins écrits, chercher l'incohérent — un volume annuel absurde, un mois vide |
| **Sortie**      | Des **tests permanents** ajoutés à la suite stack, et des `AN-xx` pour ce qui n'est pas corrigeable tout de suite                                   |
| **Coût visé**   | Le budget cible **issu de la calibration du lot 2** (`RM-39-04`), jamais un chiffre posé à l'avance                                                 |

C'est **non borné**, donc c'est ce qui coûte — et c'est pour cela que ça vient **après**. La
décision PO du 2026-08-29 laisse d'ailleurs son **opportunité même** en suspens (`Q-39-07`) : le
rôle B ne se construit que si le rôle A a démontré, sur plusieurs trains, qu'il manque quelque
chose que seule l'exploration trouve.

### 4.3 Ce que les deux partagent — le convertisseur

Un défaut trouvé par une campagne suit **toujours** le même chemin, et ce chemin est la seule
partie du dispositif qui doit être outillée dès le lot 1 :

```
défaut observé → reproduction minimale → spec Playwright/Pact qui ÉCHOUE sur main
                                                     ↓
                    PR de test (rouge, sans correctif) → AN-xx en doc 22
                                                     ↓
                                  lot de correction → la spec passe au vert
```

Deux exigences de cette chaîne, toutes deux tirées de défauts réels du dépôt :

- **La spec doit échouer avant de passer.** Une spec écrite après le correctif ne prouve rien :
  c'est exactement le mode de défaillance d'`AN-21`, où six tests de composants « couvraient » un
  chemin en fabriquant eux-mêmes la forme du corps d'erreur qu'ils prétendaient éprouver.
- **La spec doit nommer ce qu'elle éprouve** (`AN-xx`, `CT-xx`, `US-39-xx`). La porte
  `pnpm tracabilite` ne juge que les familles `CT`/`UT` ; la discipline, elle, vaut pour tout.

### 4.4 Où ça se branche — sur le processus SFD, et sur le train

**Sur les SFD.** Chaque SFD du dépôt définit déjà ses critères d'acceptation, en creux : les
`CA1`/`CA2`/`CA3` de ses user stories. Personne ne les rejoue jamais **en bloc** après livraison —
ils sont couverts test par test, au fil des lots, et la question « ce que la SFD promettait
est-il vrai, aujourd'hui, dans l'application ? » n'est posée nulle part. Le rôle A la pose.

Le branchement tient donc en **une seule règle**, sans nouveau formalisme (`RM-39-06`) : une SFD
validée déclare, pour chaque `CA`, **quel persona** doit pouvoir le constater. C'est un mot par
critère, pas une section de plus.

**Sur le train.** Le train conduit aujourd'hui `merge → images → staging → smoke → promotion
prod`. Le GO/NO-GO s'insère **entre le smoke de staging et la promotion**, à l'endroit exact où
la [doc 24](exploitation/24-plan-deploiement-serveur-ct-qdo.md) §12.4 place déjà un geste humain
volontaire. Il ne remplace pas le smoke : le smoke dit « la pile répond », le GO/NO-GO dit
« **un parent y arrive** ».

---

## 5. Acteurs & personas

| Acteur                         | Rôle                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **PO (Édouard)**               | Tranche les questions du §11, lit le GO/NO-GO, décide de promouvoir ou non. **Le verdict ne décide pas à sa place** (`RM-39-08`). |
| **Agent de recette (rôle A)**  | Rejoue les critères d'acceptation par persona sur staging, produit le verdict écrit                                               |
| **Agent de campagne (rôle B)** | Explore, trouve, réduit à un cas minimal, écrit le test                                                                           |
| **La CI**                      | **Seul juge de livraison.** Ce qu'un agent a trouvé ne compte que quand elle le garde.                                            |

Les **personas** sont des rôles produit, et chacun exige un **compte dédié en base staging**.
Depuis la décision PO du 2026-08-29 (`Q-39-05`), ces comptes sont **créés par le dispositif
lui-même**, jamais à la main : c'est l'agent qui sème, donc c'est reproductible, donc c'est
rejouable après un `down -v`.

| Persona            | Ce qu'il éprouve, et que les autres ne voient pas                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Parent mobile**  | Le vrai parcours : petit écran, tactile, données de sa famille. **Non-administrateur** — le cas d'Anna-Louise, celui qui a trouvé les trois défauts         |
| **Gestionnaire**   | Le référentiel : grilles, barèmes, calendriers, fermetures. Il ouvre des écrans qu'un parent n'ouvre jamais                                                 |
| **Administrateur** | Les écrans gardés par `ADMIN_EMAILS`. C'est le persona **par défaut du poste de développement**, donc celui sous lequel presque tout a été essayé jusqu'ici |

> **Le persona qui manquait était le plus courant.** Tout ce qui a été vérifié à la main l'a été
> depuis un compte administrateur, sur un écran large. Le seul parcours jamais joué était celui de
> **la personne qui se sert du produit**.

### 5.1 Le persona est une trajectoire, pas un état — décision PO du 2026-08-29

C'est l'exigence centrale de la validation, et elle change la nature du jeu de données.

**Le socle est réel.** Le persona « parent mobile » part de la **configuration réelle du foyer
d'Anna-Louise et d'Édouard** telle qu'elle vit en production : leurs enfants, leurs
établissements, leurs contrats, leur semaine. Pas un foyer inventé, pas le foyer de démonstration
— celui dont les défauts du 29 août ont prouvé qu'il était le seul à dire la vérité. Les données
sont **celles du PO et de sa compagne**, versées **avec leur consentement**, et **cantonnées à
staging** (`RM-39-03`).

**Ce qu'on rejoue est son évolution.** Un foyer n'est pas un état, c'est une suite d'événements
datés — et c'est précisément là que les trois défauts se sont logés :

| Ce qu'on simule                         | Ce que ça met sous tension                                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chaque rentrée**                      | Contrats qui se terminent, contrats qui commencent, **période de trou** entre les deux — le défaut n° 2, exactement                            |
| **Les vacances scolaires**              | Le calendrier d'ouverture et ses régimes : périodes, exceptions, fériés — le chantier de la [SFD 31](31-sfd-calendriers-vacances-scolaires.md) |
| **Les avenants en cours d'année**       | Le versionnement à date d'effet ([SFD 30](30-sfd-versionnement-dates-effet.md)) : ce qu'on savait quand on a facturé                           |
| **Plusieurs configurations de comptes** | Un parent seul, deux parents, un foyer sans enfant scolarisé, un foyer à cheval sur deux établissements                                        |

Cette exigence **relie ce chantier au chantier vacances** : dès que la SFD 31 livre le calendrier
d'ouverture, la trajectoire du persona doit traverser une année scolaire entière — rentrée,
Toussaint, Noël, hiver, printemps, été — et non un mois isolé. Un persona figé au 15 juin n'aurait
jamais rencontré le trou d'août.

> **Ce que ça coûte, et qui est assumé.** Une copie de la configuration d'un foyer réel dans un
> second environnement est un **traitement de données personnelles**, que
> [doc 37](37-registre-des-traitements.md) ne porte pas aujourd'hui. Le §12 l'inscrit comme un
> engagement de cette spécification, et `AM-114` en porte le critère de sortie.

---

## 6. User stories

### US-39-01 — Obtenir un verdict avant de promouvoir

En tant que PO, avant de promouvoir un train en production, je dispose d'un **verdict écrit** qui
dit, persona par persona, si les critères d'acceptation embarqués sont constatables sur staging.

- **CA1** : le verdict est un fichier versionné, daté, nommant le train, la liste des critères
  rejoués et, pour chacun, `constaté` / `écart` / `non jouable`.
- **CA2** : un critère `non jouable` (donnée absente, écran inatteignable) est un **résultat**,
  jamais un blanc — il nomme ce qui manque.
- **CA3** : le verdict distingue **ce qui a été observé** de **ce qui en est déduit**.
- **CA4** : produire le verdict n'a modifié **aucune** donnée hors staging (§8.4, journal).

### US-39-02 — Rejouer le parcours de rentrée d'un parent sur mobile

En tant que parent mobile, je crée un contrat de rentrée, je saisis un planning, je valide ma
semaine — et ce parcours exact est rejoué avant chaque train.

- **CA1** : le parcours est joué en **émulation mobile** contre la **pile réelle** (aucun mock
  réseau), sous un compte **non-administrateur**.
- **CA2** : il porte le cas « **deux contrats, un mois de trou** » : ancien contrat finissant en
  cours de mois, nouveau démarrant après un mois non couvert.
- **CA3** : chaque écart constaté produit une spec permanente qui **échoue** avant correction.

### US-39-03 — Convertir un défaut en garde permanente

En tant qu'agent de campagne, quand je trouve un défaut, je le réduis à un cas minimal et j'en
fais une spec qui vit en CI.

- **CA1** : la spec échoue sur `main` **avant** tout correctif, et la PR le montre.
- **CA2** : la spec nomme l'anomalie (`AN-xx`) qu'elle éprouve.
- **CA3** : aucun défaut trouvé ne reste sans **soit** une spec, **soit** une ligne `AN-xx`
  motivée.

### US-39-04 — Explorer sur des données de vraie famille

En tant qu'agent de campagne, j'explore l'application sur un jeu de données réaliste, pas sur le
seul foyer de démonstration.

- **CA1** : au moins un jeu **au-delà** du cas nominal — trou de couverture, contrat sans terme,
  volume annuel incohérent avec la semaine type, mois sans aucun contrat.
- **CA2** : le jeu est **semé par script**, versionné, rejouable, et reste **cantonné à staging**
  (`RM-39-03`).

### US-39-05 — Ne rien pouvoir casser en explorant

En tant que PO, j'ai la garantie qu'une campagne ne peut ni toucher la production, ni envoyer un
courriel réel, ni dépasser un budget.

- **CA1** : l'agent ne dispose d'aucune voie d'accès à la production (§8.1).
- **CA2** : tout effet de bord sortant est **proposé et attendu**, jamais exécuté (§8.3).
- **CA3** : la campagne s'arrête d'elle-même au plafond de coût, et le **dit** (§8.2).
- **CA4** : le journal d'audit permet de rejouer ce que la campagne a fait (§8.4).

### US-39-06 — Lire l'effet du dispositif

En tant que PO, je peux dire, après quelques trains, si ce dispositif sert à quelque chose.

- **CA1** : un compte tenu des **tests permanents nés d'une exploration**, et des défauts que ces
  tests ont retenus **ensuite**.
- **CA2** : le coût cumulé des campagnes est lisible à côté de ce compte.
- **CA3** : si le compte reste à zéro sur trois trains, l'**arrêt** du dispositif est la
  recommandation par défaut (`RM-39-09`).

### US-39-07 — Le persona est un clone évolutif du foyer réel — décision PO du 2026-08-29

En tant que PO, je veux que la recette se joue sur **mon foyer**, pas sur un foyer inventé, et
qu'elle en rejoue **l'évolution dans le temps** plutôt qu'un instantané.

- **CA1** : le socle du persona « parent mobile » est la **configuration réelle du foyer
  d'Anna-Louise et d'Édouard** (enfants, établissements, contrats, semaine type), versée **avec
  leur consentement** et **cantonnée à staging** — jamais celle d'un autre foyer (`RM-39-03`).
- **CA2** : les comptes personas sont **créés par le dispositif**, pas à la main : le semis est un
  script versionné, rejouable à l'identique après un `down -v`.
- **CA3** : la trajectoire **simule le temps** et non un état — au minimum une **rentrée**
  (contrat qui finit, période de trou, contrat qui commence) et un **cycle de vacances
  scolaires**, les deux enchaînés sur le même foyer.
- **CA4** : **plusieurs configurations de comptes** sont éprouvées, pas une seule : parent seul,
  deux parents, foyer sans enfant scolarisé, foyer à cheval sur deux établissements.
- **CA5** : quand la [SFD 31](31-sfd-calendriers-vacances-scolaires.md) aura livré le calendrier
  d'ouverture, la trajectoire traverse une **année scolaire entière** — un persona figé au 15 juin
  n'aurait jamais rencontré le trou d'août.
- **CA6** : le traitement correspondant est **écrit** en [doc 37](37-registre-des-traitements.md)
  avant le premier semis (`AM-114`).

### US-39-08 — Disposer d'un staging qui dit la vérité — décision PO du 2026-08-29

En tant que PO, avant qu'une seule campagne ne tourne, je veux savoir que staging **reflète
`main`**, et le savoir par une preuve, pas par une supposition.

- **CA1** : l'alignement de staging sur `main` est **constaté**, pas déduit : version servie
  relevée, et comparée à la dernière coupe.
- **CA2** : les trois sous-questions de `Q-39-02` sont **répondues par écrit** — le poller
  tourne-t-il encore ? les images qu'il surveille couvrent-elles les **sept** services applicatifs
  actuels ? le geste de secours (`remote-deploy.ps1 -Environment staging`, ou un tick forcé côté
  serveur) suffit-il, ou faut-il un bootstrap complet ?
- **CA3** : un écart trouvé est **corrigé ou daté** — « staging est en retard de N jours, et
  voilà pourquoi » est un résultat acceptable ; « staging a l'air bon » ne l'est pas.
- **CA4** : tant que `CA1` n'est pas satisfait, **aucune campagne ne démarre** (`RM-39-10`).

---

## 7. Règles métier

- **RM-39-01** **L'agent n'est pas une porte.** Aucun job de `ci.yml`, aucune promotion
  automatique ne dépend de la sortie d'un agent. Le juge de livraison reste déterministe.
- **RM-39-02** **Tout défaut trouvé est converti**, en spec permanente ou en `AN-xx` motivée. Un
  rapport sans conversion ne clôt rien.
- **RM-39-03** **Staging seulement — et un seul foyer réel, consenti.** ⚠️ **Amendée par la
  décision PO du 2026-08-29** : la v0.1 exigeait des données **synthétiques seulement**. La règle
  est désormais plus étroite et plus honnête. Aucune campagne ne joint la production, jamais. Le
  socle des personas est la configuration **du seul foyer du PO**, versée avec le consentement de
  ses deux adultes, **cantonnée à staging**, et **jamais recopiée ailleurs** ; la configuration
  d'un autre foyer reste interdite, anonymisée ou non.
- **RM-39-04** **Le budget se calibre, il ne se décrète pas.** ⚠️ **Amendée par la décision PO du
  2026-08-29** : la valeur attendue est « suffisante pour un niveau de qualité satisfaisant » —
  un **résultat**, donc pas une entrée. Le budget cible est obtenu en jouant **la même campagne à
  plusieurs niveaux de budget**, en mesurant le rendement (défauts trouvés par euro) et en
  retenant le point où la courbe s'aplatit (lot 2). Jusqu'à ce que ce chiffre existe, tout
  plafond posé est **explicitement provisoire**. Le plafond reste appliqué par le **harnais** et
  non par la consigne, et une campagne coupée au plafond est un **échec explicite**, jamais un
  verdict partiel.
- **RM-39-05** **Propose et attend** pour tout effet de bord sortant : courriel, écriture hors du
  périmètre déclaré, mutation de configuration, ouverture de PR.
- **RM-39-06** Une SFD validée déclare, pour chaque critère d'acceptation, **quel persona** doit
  pouvoir le constater. Un critère sans persona n'est pas rejouable en recette.
- **RM-39-07** **Le verdict est écrit, versionné et daté — et il vit dans le dépôt.** Un GO/NO-GO
  oral n'existe pas : il ne se relit pas six mois plus tard, comme un statut sans date
  ([doc 35](35-politique-documentation.md) §4). Tranché le 2026-08-29 (`Q-39-06`) : **un fichier
  court par train**, versionné dans le dépôt et non déposé en artefact de release, qui disparaît.
- **RM-39-08** **Le GO/NO-GO informe, il ne promeut pas.** La promotion reste un geste humain
  volontaire ([doc 24](exploitation/24-plan-deploiement-serveur-ct-qdo.md) §12.4). Tranché le
  2026-08-29 (`Q-39-03`) : le verdict est **consultatif au premier train**, et ne devient
  bloquant qu'**après** avoir trouvé au moins un écart réel — un dispositif jamais éprouvé ne
  gagne pas le droit d'annuler un train sur son premier faux positif.
- **RM-39-09** **Le dispositif porte son propre critère d'arrêt** : zéro test permanent né d'une
  exploration sur trois trains consécutifs ⇒ on arrête, et on écrit pourquoi.
- **RM-39-10** **Rien ne démarre avant que staging dise la vérité.** Décidée le 2026-08-29
  (`Q-39-02`) : la remise en état de staging est un **préalable bloquant**, porté par le lot 0.
  Aucune campagne — rôle A comme rôle B — ne tourne tant qu'`US-39-08` `CA1` n'est pas satisfaite.
  Une recette jouée contre un environnement périmé ne mesure pas le produit : elle mesure son
  passé, et elle le fait sans le dire.

---

## 8. Cadre de sécurité — les garde-fous, repris de l'orchestrateur

Ce dispositif n'invente **aucun** garde-fou : il reprend ceux que l'orchestrateur d'agents du
foyer a déjà éprouvés en service, et dont les échecs sont documentés. C'est une **référence
croisée volontaire** — l'orchestrateur (étape 1 en service, étapes 2/3 non démarrées) est le seul
endroit du foyer où un agent tourne sans surveillance permanente, et il a déjà payé les leçons
ci-dessous.

### 8.1 Staging isolé — et ce que « isolé » exige vraiment

La pile `creche-planner-staging` est **déjà** un silo : nom de projet, réseaux, volumes et
`.env.staging` distincts, aucun secret de production, données jetables
([doc 24](exploitation/24-plan-deploiement-serveur-ct-qdo.md) §12.1). C'est le bon socle, mais
l'isolation doit être vérifiée **du point de vue de l'agent**, pas du compose :

- l'agent ne reçoit **aucun** identifiant de production, et **aucune** clé d'accès au serveur ;
- il reçoit une **URL de gateway staging**, et rien d'autre comme voie d'écriture ;
- le mailer de staging ne doit **pas** pouvoir joindre une adresse réelle. C'est le risque le plus
  concret du dépôt : la production porte l'adresse d'une crèche réelle, et l'allowlist du mailer a
  déjà été un défaut (`AN-14`). **La décision `Q-39-05` en fait un point dur** : depuis que le
  socle des personas porte les adresses réelles du foyer du PO, un mailer de staging mal bridé
  n'écrit plus dans le vide — il écrit à des personnes. À vérifier **avant** le premier semis, pas
  après.
- l'isolation vaut **dans les deux sens** : rien de ce qui est semé en staging ne remonte vers la
  production, et le semis ne lit la configuration réelle qu'**une fois**, pour en faire un script
  versionné (`US-39-07` `CA2`) — pas un tuyau permanent entre les deux bases.

> **Leçon de l'orchestrateur, applicable telle quelle.** Un egress qu'un compose **affirme** borné
> ne l'est pas — un réseau bridge Docker laisse sortir. Le rayon d'action d'un agent s'écrit en
> **capacités qu'on lui donne**, jamais en interdits qu'on lui énonce.

### 8.2 Plafond de coût par campagne — provisoire, puis calibré

L'orchestrateur plafonne chaque run et **mesure** ce qu'il dépense. Deux faits mesurés,
réutilisables ici :

- un brief quotidien coûte **≈ 0,39 $** avec `claude-opus-5` ; une campagne de recette, plus
  longue, coûtera davantage ;
- **compléter la liste d'outils interdits a divisé le coût par deux** (0,62 $ → 0,33 $) : les
  schémas d'outils absents du contexte ne sont plus payés à chaque tour. Un agent qu'on restreint
  coûte moins cher, en plus d'être plus sûr.

**Ce que la décision PO du 2026-08-29 change ici** (`Q-39-04`, `RM-39-04`) : il y a **toujours**
un plafond — c'est un garde-fou, et un garde-fou n'attend pas d'être optimal pour exister. Mais
le premier n'est qu'un **provisoire déclaré comme tel**, posé assez large pour ne pas fausser la
mesure. Le chiffre qui compte sort du **lot 2** :

| Étape de la calibration                | Ce qu'on en tire                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **La même campagne, budgets étagés**   | Un point de mesure par niveau — même parcours, même jeu de données, seul le plafond change                  |
| **Défauts trouvés par euro dépensé**   | Le rendement, et surtout **où il s'effondre** : le budget où doubler la dépense ne trouve plus rien de plus |
| **Budget cible retenu, écrit et daté** | Le plafond de service, avec la mesure qui le justifie — révisable, jamais deviné                            |

> **Pourquoi refuser de poser le chiffre maintenant est la bonne réponse.** Un plafond trop bas
> produit des campagnes coupées, donc des verdicts partiels — que `RM-39-04` interdit de lire
> comme des résultats. Un plafond trop haut achète du temps d'agent qui ne trouve rien. Aucun des
> deux ne se détecte **avant** d'avoir mesuré : c'est exactement le genre de valeur que ce dépôt
> refuse de recopier au jugé.

### 8.3 « Propose et attend » pour tout effet de bord

L'agent **peut** écrire sur staging — c'est son métier : créer un contrat, saisir un planning,
valider une semaine. Tout ce qui **sort** de ce périmètre est proposé et attendu : envoi de
courriel, écriture hors staging, modification de configuration, ouverture de PR.

> **Leçon de l'orchestrateur, à ne pas réapprendre.** Une liste d'interdits est **toujours**
> incomplète : une sonde du 2026-08-28 a relevé 26 outils publiés par le harnais, dont
> **quatorze** absents de la liste d'interdits du projet, et le mode restreint natif **ne retire
> pas** la famille d'outils sortants. Le rempart est le **hook `PreToolUse`**, qui passe avant les
> règles et avant le mode — pas l'énumération.

### 8.4 Journal d'audit

Chaque campagne produit un journal en ajout seul : consigne, jeu de données, actions, coût,
verdict. Il sert trois choses, dont la troisième est la moins évidente :

1. **rejouer** ce que la campagne a fait, quand elle trouve quelque chose ;
2. **prouver** qu'elle n'a rien fait hors périmètre ;
3. **distinguer « rien trouvé » de « rien joué »** — sans quoi une campagne à vide se lit comme un
   succès (corollaire 3 du §2).

### 8.5 L'agent lit des données qu'il n'a pas écrites

Un agent de recette lit des écrans, donc du **contenu** : libellés de contrats, noms
d'établissements, motifs de fermeture — tous saisis par un utilisateur. C'est exactement le canal
d'injection que l'orchestrateur a trouvé chez lui : un **titre de PR d'un dépôt public** entrait
chaque matin dans le contexte de l'agent.

La règle est la même ici : **ce que l'agent lit dans l'application est une donnée, jamais une
consigne.** Une instruction trouvée dans un champ saisi se **signale** dans le verdict — et c'est
d'ailleurs, en soi, un défaut à consigner.

---

## 9. Déploiement minimal d'abord — découpage en lots

**Recommandation forte : ne pas construire les deux rôles d'un coup.** Le budget réel du projet
est de l'ordre de **7 h par semaine**. Un dispositif d'agents QA complet — deux rôles, jeux de
données, intégration au train, garde-fous — est un chantier de plusieurs semaines dont la valeur
n'est **pas démontrée** : elle est plausible, ce qui n'est pas la même chose.

Le pari du lot 1 est délibérément **petit et falsifiable** : rejouer, avant le prochain train, le
parcours **exact** d'Anna-Louise, et voir ce qui tombe.

**Depuis la décision PO du 2026-08-29, le découpage passe de 5 à 6 lots** : la remise en état de
staging cesse d'être un prérequis flottant pour devenir le **lot 0**, bloquant (`RM-39-10`). Le
**lot 1 est démarrable dès que le lot 0 est levé** — plus aucune décision ne l'attend.

|  Lot  | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                              | Ce qui prouve que le lot est fini                                                                                                                                                                                                                                            |
| :---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0** | **PRÉALABLE BLOQUANT — remise en état de staging** (`US-39-08`, `RM-39-10`). Constater l'alignement sur `main` par une preuve ; répondre par écrit aux trois sous-questions : le poller tourne-t-il encore ? les images qu'il surveille couvrent-elles les **sept** services applicatifs actuels ? le geste de secours (`remote-deploy.ps1 -Environment staging`, ou tick forcé côté serveur) suffit-il, ou faut-il un bootstrap ?   | La version servie par staging est **relevée** et comparée à la dernière coupe ; les trois sous-questions ont une réponse écrite ; tout écart est **corrigé ou daté**. Exige un accès LAN ou le poste principal (`EM-20`).                                                    |
| **1** | **Le premier lot exécutable.** Agent de recette-persona « parent mobile », un seul parcours : **créer un contrat → saisir un planning → valider la semaine**, sur staging, en émulation mobile, compte non-administrateur, sur le jeu « deux contrats, un mois de trou ». Moteur : **Playwright écrit et lancé par l'agent** (option (a) de `Q-39-01`). Verdict GO/NO-GO écrit dans le dépôt, **consultatif** (`RM-39-08`).          | Un verdict écrit produit **avant un train réel**, et **au moins une spec** née de la campagne, **rouge avant correctif**, verte après. Si la campagne ne trouve aucun écart, le verdict le dit, et les trois défauts du 29/08 sont couverts par des specs écrites à la main. |
| **2** | **Les personas et la calibration du budget.** (a) Le semis du **clone évolutif du foyer réel** (`US-39-07`) : socle consenti, trajectoire dans le temps — rentrée, trou, vacances —, plusieurs configurations de comptes, script versionné, oracle. (b) La **calibration** : même campagne à **budgets étagés**, mesure du rendement défauts/euro, budget cible écrit et daté (`RM-39-04`). (c) L'entrée `T11` en doc 37 (`AM-114`). | Un semis qui rejoue une **trajectoire** (et non un état) à l'identique après un `down -v`, **avec son oracle** ; et une courbe coût/défauts qui **désigne** un budget cible, au lieu de le supposer.                                                                         |
| **3** | **Personas gestionnaire et administrateur** : comptes dédiés semés en base staging, et rejeu de leurs critères d'acceptation                                                                                                                                                                                                                                                                                                         | Un verdict à **trois personas** sur un train                                                                                                                                                                                                                                 |
| **4** | **Intégration du GO/NO-GO au train de release** : place dans la séquence, forme du verdict, ce qu'un NO-GO déclenche — et **le passage du consultatif au bloquant**, qui ne se fait que si le verdict a déjà trouvé un écart réel (`RM-39-08`)                                                                                                                                                                                       | Le runbook porte l'étape, et **un train l'a suivie**                                                                                                                                                                                                                         |
| **5** | **Campagne système exploratoire (rôle B)** — **sous condition** : `Q-39-07` n'est pas tranchée, elle est **ajournée après plusieurs trains**, réponse par défaut **non**. Ne se construit que si le rôle A a démontré qu'il manque quelque chose que seule l'exploration trouve.                                                                                                                                                     | Une campagne périodique qui a produit **au moins un test permanent que personne n'aurait écrit**                                                                                                                                                                             |

**Les lots 3 → 5 ne sont pas engagés.** Ils sont décrits pour que les lots 0 → 2 sachent vers quoi
ils grandissent, et ils sont **relus après le lot 1** : si le premier verdict ne trouve rien et
n'apprend rien, la bonne décision est d'écrire les trois specs à la main et de **s'arrêter là**.

> **Ce que le lot 1 coûte s'il échoue** : une soirée, plus le prix d'une campagne. C'est
> précisément le point : la question « un agent trouve-t-il ce que la suite manque ? » se répond
> par une expérience, pas par une spécification.

> ⚠️ **Ce qui reste entre le lot 0 et le lot 1.** Le lot 1 est **démarrable**, pas **joignable** :
> il suppose que le lot 0 soit levé, et le lot 0 suppose un accès LAN ou le poste principal
> (`EM-20`). Aucune décision PO ne fabrique cet accès — c'est la seule chose que cette validation
> ne résout pas.

---

## 10. Prérequis techniques — et l'état réel de chacun

| Prérequis                                         | État constaté                                                                                                                                                                                                                                                             | Ce qu'il reste à faire                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Un staging qui tourne**                         | La pile `creche-planner-staging` **existe** et est spécifiée (doc 24 §12) : silo complet, poller de digest agrégé (`scripts/staging-poll.mjs`), déploiement par `deploy.mjs` paramétré. **Sa fraîcheur réelle n'a pas pu être constatée depuis cette session** (`EM-20`). | **Lot 0, bloquant** (`RM-39-10`) : constater l'alignement sur `main`, ou le corriger et le dater                                                     |
| **Un staging seedé**                              | `scripts/seed-demo.mjs` est idempotent, porte un **oracle** (`--verify`) et accepte `SEED_BASE_URL` : il sait déjà viser une autre gateway que la locale                                                                                                                  | Le pointer sur la gateway staging, et vérifier l'oracle                                                                                              |
| **Des fixtures réalistes**                        | Le jeu actuel porte **déjà** le trou d'août (crèche → 31/07/2026, ABCM → 01/09/2026), mais toujours le **même foyer nominal**, et **figé dans le temps**                                                                                                                  | Lot 2 : le **clone évolutif** du foyer réel (`US-39-07`), sa trajectoire et ses oracles                                                              |
| **Des comptes personas non-administrateurs**      | **Rien de tel n'existe.** `ADMIN_EMAILS` distingue déjà admin et non-admin, mais l'identité est **désactivée en staging** (pile en loopback, donc aucun JWT Cloudflare)                                                                                                   | **Tranché** (`Q-39-05`) : **le dispositif les crée** par semis versionné. Reste la voie d'authentification, à régler au lot 0                        |
| **Un accès en écriture de l'agent, staging seul** | La gateway staging écoute en **loopback** sur le serveur, donc hors de portée depuis le poste sans tunnel                                                                                                                                                                 | Décider la voie d'accès **sans rouvrir ce qu'`AM-94` vient de fermer**                                                                               |
| **Un moteur pour l'agent**                        | Playwright est déjà là (config stack, émulation mobile disponible) ; le harnais de l'orchestrateur est éprouvé                                                                                                                                                            | **Tranché** (`Q-39-01`) : option **(c)**, en démarrant le lot 1 en **(a)** — l'agent écrit et lance du Playwright                                    |
| **Un consentement écrit**                         | Le socle des personas porte la configuration réelle du foyer du PO (`US-39-07`)                                                                                                                                                                                           | Le consentement des **deux** adultes du foyer, et l'entrée `T11` en [doc 37](37-registre-des-traitements.md) (`AM-114`) — **avant** le premier semis |

> ⚠️ **Le prérequis d'accès est le point dur.** `AM-94` a été refermée le 2026-08-17 en mettant
> **tous les ports de prod et de staging en `127.0.0.1`**, avec une porte (`pnpm conteneurs`,
> règles 7-9) qui refuse tout port non loopback. Donner à un agent une voie d'écriture sur staging
> **ne doit pas** consister à rouvrir un port : la voie propre passe par le serveur lui-même, ou
> par un tunnel authentifié — jamais par une exception dans le compose.

---

## 11. Questions ouvertes

**Les sept sont tranchées** par la décision PO du 2026-08-29 (§0) — la dernière par un ajournement
explicite, ce qui en est une. Elles restent écrites **avec leur réponse** : une question effacée
redevient une question, six mois plus tard.

- ~~**Q-39-01 — Quel moteur pour l'agent ?**~~ → **tranchée le 2026-08-29** : option **(c)**, le
  mélange — piloter un navigateur pour explorer, écrire du Playwright pour figer —, **en démarrant
  le lot 1 en (a)** : l'agent écrit et lance du Playwright, parce que le parcours d'Anna-Louise
  est déjà connu et n'a pas besoin d'être découvert. L'option (b) seule est écartée : elle coûte
  plus et ne fige rien.
- ~~**Q-39-02 — Remet-on staging en état d'abord ?**~~ → **tranchée le 2026-08-29** : **oui, et
  c'est bloquant** (`RM-39-10`, `US-39-08`, lot 0). Trois sous-questions restent **à lever par le
  lot 0**, et elles sont un travail, plus une décision : le poller tourne-t-il encore ? les images
  qu'il surveille couvrent-elles les **sept** services applicatifs actuels ? le geste de secours
  (`remote-deploy.ps1 -Environment staging`, ou un tick forcé côté serveur) suffit-il, ou faut-il
  un bootstrap complet ?
- ~~**Q-39-03 — Le GO/NO-GO est-il bloquant au premier train ?**~~ → **tranchée le 2026-08-29** :
  **consultatif au premier train**, bloquant ensuite **si et seulement si** il a déjà trouvé
  quelque chose (`RM-39-08`, lot 4). Un verdict bloquant produit par un dispositif jamais éprouvé
  transformerait le premier faux positif en train annulé — et le dispositif serait débranché le
  lendemain.
- ~~**Q-39-04 — Quel budget par campagne ?**~~ → **tranchée le 2026-08-29, en refusant le format
  de la question**. Aucune valeur fixe n'est posée : le budget doit être « **suffisant pour un
  niveau de qualité satisfaisant** », ce qui est un **résultat** et non une entrée. La question
  devient une **démarche de calibration** (`RM-39-04`, §8.2, lot 2) : jouer la même campagne à
  **plusieurs niveaux de budget**, mesurer le rendement (défauts trouvés par euro), retenir le
  point où doubler la dépense ne trouve plus rien de plus. Jusqu'à ce chiffre, tout plafond est
  **provisoire et déclaré tel**.
- ~~**Q-39-05 — Qui possède les personas de test ?**~~ → **tranchée le 2026-08-29, contre la
  prudence de la v0.1** : c'est **le dispositif** qui crée les comptes, par semis versionné. Et le
  socle n'est **pas** un foyer inventé : c'est la **configuration réelle du foyer d'Anna-Louise et
  d'Édouard**, consentie, cantonnée à staging, dont on **simule l'évolution dans le temps** —
  rentrées, vacances, périodes de trou (`US-39-07`, §5.1). Plusieurs configurations de comptes
  sont éprouvées, pas une seule. ⚠️ Cette réponse **amende `RM-39-03`** et ouvre un traitement de
  données personnelles à écrire en [doc 37](37-registre-des-traitements.md) (`AM-114`).
- ~~**Q-39-06 — Où vit le verdict ?**~~ → **tranchée le 2026-08-29** : **dans le dépôt**, un
  fichier court par train, versionné (`RM-39-07`). L'artefact de release est écarté pour la seule
  raison qui compte ici : il disparaît.
- **Q-39-07 — Le rôle B a-t-il lieu d'être si le rôle A suffit ?** → **ajournée le 2026-08-29**, à
  statuer **après plusieurs trains**, avec le compte d'`US-39-06` en main. La réponse par défaut
  reste **non** : un dispositif qu'on ne sait pas justifier ne se garde pas. Le lot 5 est donc
  **conditionnel**, et il ne se prépare pas d'avance.

---

## 12. Ce que cette spécification engage

- **Un étage de plus dans la stratégie de test**, donc un amendement à la
  [doc 21](21-politique-strategie-test.md) §2 — une ligne de niveau avec son objectif, son
  déclencheur, son oracle, son critère et sa porte, **la porte étant « aucune », par
  construction** — et à la [doc 20](20-plan-de-test.md) §3, où staging devient un environnement
  de test, ce qu'il n'est pas aujourd'hui.
- **Une étape de plus dans le train de release**, à l'endroit où la
  [doc 24](exploitation/24-plan-deploiement-serveur-ct-qdo.md) §12.4 place déjà un geste humain —
  donc un amendement au [runbook](exploitation/runbook-deploiement.md), au lot 4.
- **Un agent qui écrit dans une base**, ce qu'aucun agent du foyer ne fait aujourd'hui :
  l'orchestrateur est en **lecture seule** et n'écrit nulle part. C'est un franchissement, et
  c'est la raison d'être du §8.
- **Un coût récurrent**, modeste mais réel, à mettre en regard d'un compte de tests (`US-39-06`) —
  et dont le montant sera **mesuré avant d'être fixé** (`RM-39-04`, lot 2).
- **Une remise en état de staging**, qui n'appartient pas à ce chantier mais le conditionne
  entièrement — désormais **inscrite comme lot 0 bloquant** (`RM-39-10`), et non plus comme un
  prérequis flottant.
- **Un dixième traitement de données personnelles, à écrire avant le premier semis.** C'est le
  prix de la décision `Q-39-05` : la configuration réelle d'un foyer — deux adultes, leurs
  enfants, leurs établissements — est **recopiée dans un second environnement**. Ce n'est pas
  couvert par les entrées existantes de [doc 37](37-registre-des-traitements.md), qui décrivent la
  production. Engagement : une entrée `T11` (finalité « recette », base légale « consentement »,
  durée de conservation, effacement), et le **consentement des deux adultes**, avant que le semis
  ne tourne une première fois (`AM-114`, `US-39-07` `CA6`).
- **Ce que cette spécification ne décide pas** : le moment. Elle entre en concurrence avec la
  [SFD 31](31-sfd-calendriers-vacances-scolaires.md) (validée, lots 1 et 2 livrés) et la
  [SFD 38](38-sfd-rattachement-documentaire.md) (validée, non démarrée). Le lot 1 est cependant
  **le seul des trois** à pouvoir s'insérer dans un train existant sans en décaler aucun — une
  fois le lot 0 levé, ce qui demande un accès LAN ou le poste principal (`EM-20`).
- **Ce qu'elle ne fera jamais** : mettre un agent en porte de livraison (`RM-39-01`), toucher la
  production, ou verser en staging la configuration d'un **autre** foyer que celui du PO
  (`RM-39-03`).
