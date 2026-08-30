# 39 — SFD Recette systématique & agents QA : jouer le parcours d'un vrai parent avant de livrer

> Statut : **Brouillon — NE PAS DÉMARRER, en attente de validation PO** · Version 0.1 · 2026-08-29
> Étend la [stratégie de test](21-politique-strategie-test.md) §2 d'un niveau qu'elle ne porte
> pas : la **recette de parcours**. Instruit les pistes `AM-110` → `AM-113` et l'empêchement
> `EM-20` ([doc 34](34-registre-ameliorations.md)). Déclenchée par les trois défauts trouvés par
> un vrai parent le **2026-08-29**, tous passés au travers de la suite existante. Reprend le
> cadre de sécurité de l'orchestrateur d'agents (§8).

## 0. Ce que cette spécification demande au PO

Elle est en **brouillon** et **ne doit pas être démarrée**. Ce qu'elle attend n'est pas un « oui »
global mais **sept arbitrages nommés** (§11), dont deux conditionnent tout le reste :

1. **L'état de staging** (`Q-39-02`) — une recette sans environnement de recette n'existe pas.
2. **Le périmètre du GO/NO-GO au premier train** (`Q-39-03`) — bloquant, ou consultatif ?

Ce qu'elle **ne demande pas** : ni budget d'agent permanent, ni construction des deux rôles
d'agent, ni ligne de plus dans la CI. Le §9 propose délibérément un **premier lot minuscule**,
jouable sur un seul train, dont l'échec coûterait une soirée. Tout le reste y est conditionné.

---

## 1. Contexte & problème — le 29 août, trois défauts sont passés

Le 2026-08-29, **Anna-Louise** — vrai parent, compte non-administrateur, téléphone Android — a
créé dans l'application le contrat de rentrée de sa fille. Le parcours a produit **trois
défauts**. Aucun n'est exotique. Aucun n'a été trouvé par la suite de tests, qui compte pourtant
onze niveaux gouvernés ([doc 21](21-politique-strategie-test.md) §2), des tests de mutation à
99,55 % sur `tarification-domain`, une vérification bidirectionnelle Pact, treize scénarios E2E
sur pile réelle et onze portes bloquantes dans le job `ci`.

| #   | Ce qu'a vu le parent                                                                                    | Ce qui aurait dû l'arrêter          | Pourquoi rien ne l'a arrêté                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **1607 h/an** acceptées pour une semaine type de **27 h**, et facturées ainsi                           | Une règle métier de cohérence       | **Elle n'existe pas.** Les seules bornes du volume annuel sont `z.number().nonnegative()` (`planification.dto.ts`) et `≥ 0` (`contrat-creche.ts`) |
| 2   | Le **calendrier mensuel à onglets** cassé : deux contrats, un mois de trou entre l'ancien et le nouveau | Un scénario E2E sur données réelles | **Le défaut ne se révèle qu'avec ces données-là** : un contrat unique, ou deux contrats contigus, rendent correctement                            |
| 3   | Un **404 inter-services** rendu tel quel, avec un **UUID brut** affiché à un parent                     | Une garde sur les messages d'erreur | **Il n'y en a aucune.** Les `NotFoundException` des services interpolent l'identifiant, et le message voyage jusqu'à l'écran                      |

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
sont des **anomalies produit** : ils appartiennent au doc 22 (`AN-xx` ouverts par leurs PR de
correction), pas à cette spécification. Ce document ne parle que du **trou entre les niveaux**,
et de ce qu'on y met.

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

- Un **rôle d'agent de recette d'acceptation par persona** (§4.1), joué **avant un train de
  release**, sur **staging**, produisant un **GO/NO-GO écrit**.
- Un **rôle d'agent de campagne système exploratoire** (§4.2), joué **hors train**, sur staging,
  sur des jeux de données réalistes semés exprès.
- Le **convertisseur** commun (§4.3) : la discipline et l'outillage qui font qu'un défaut trouvé
  devient un test permanent.
- Les **jeux de données réalistes** nécessaires, dont le cas **« deux contrats, un mois de
  trou »** qui a révélé le défaut n° 2.
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

| Aspect          | Ce que c'est                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Déclencheur** | **Avant chaque train de release**, une fois staging aligné sur les images candidates                                                     |
| **Cible**       | Staging uniquement (§8.1)                                                                                                                |
| **Consigne**    | Rejouer les **critères d'acceptation** des SFD et des lots embarqués dans le train, **par persona** (parent mobile, gestionnaire, admin) |
| **Sortie**      | Un **GO/NO-GO écrit**, daté, découpé par persona, versionné, avec la liste des écarts et leur gravité                                    |
| **Coût visé**   | Une campagne par train (≈ une tous les 10 à 20 jours), plafonnée (§8.2)                                                                  |

C'est **borné** : la liste des critères à rejouer est finie et connue à l'avance. C'est ce qui en
fait le premier lot (§9).

### 4.2 Rôle B — campagne système exploratoire

| Aspect          | Ce que c'est                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Déclencheur** | Hors train : à la demande, ou périodiquement (hebdomadaire, comme `mutation.yml`)                                                                   |
| **Cible**       | Staging uniquement, sur des **jeux de données semés exprès** (§10)                                                                                  |
| **Consigne**    | **Explorer** : se comporter comme un parent qui découvre, sortir des chemins écrits, chercher l'incohérent — un volume annuel absurde, un mois vide |
| **Sortie**      | Des **tests permanents** ajoutés à la suite stack, et des `AN-xx` pour ce qui n'est pas corrigeable tout de suite                                   |
| **Coût visé**   | Non déterminé tant que le rôle A n'a pas fait ses preuves (`Q-39-04`)                                                                               |

C'est **non borné**, donc c'est ce qui coûte — et c'est pour cela que ça vient **après**.

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

Les **personas** sont des rôles produit, et chacun exige un **compte réel en base staging**
(`Q-39-05`) :

| Persona            | Ce qu'il éprouve, et que les autres ne voient pas                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Parent mobile**  | Le vrai parcours : petit écran, tactile, données de sa famille. **Non-administrateur** — le cas d'Anna-Louise, celui qui a trouvé les trois défauts         |
| **Gestionnaire**   | Le référentiel : grilles, barèmes, calendriers, fermetures. Il ouvre des écrans qu'un parent n'ouvre jamais                                                 |
| **Administrateur** | Les écrans gardés par `ADMIN_EMAILS`. C'est le persona **par défaut du poste de développement**, donc celui sous lequel presque tout a été essayé jusqu'ici |

> **Le persona qui manquait était le plus courant.** Tout ce qui a été vérifié à la main l'a été
> depuis un compte administrateur, sur un écran large. Le seul parcours jamais joué était celui de
> **la personne qui se sert du produit**.

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
- **CA2** : le jeu est **semé par script**, versionné, rejouable, et n'emprunte **aucune** donnée
  de production (`RM-39-03`).

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

---

## 7. Règles métier

- **RM-39-01** **L'agent n'est pas une porte.** Aucun job de `ci.yml`, aucune promotion
  automatique ne dépend de la sortie d'un agent. Le juge de livraison reste déterministe.
- **RM-39-02** **Tout défaut trouvé est converti**, en spec permanente ou en `AN-xx` motivée. Un
  rapport sans conversion ne clôt rien.
- **RM-39-03** **Staging seulement, données synthétiques seulement.** Aucune campagne ne joint la
  production ; aucun jeu de données n'est extrait de la production, même anonymisé.
- **RM-39-04** **Plafond de coût par campagne**, appliqué par le harnais et non par la consigne.
  Une campagne coupée au plafond est un **échec explicite**, jamais un verdict partiel.
- **RM-39-05** **Propose et attend** pour tout effet de bord sortant : courriel, écriture hors du
  périmètre déclaré, mutation de configuration, ouverture de PR.
- **RM-39-06** Une SFD validée déclare, pour chaque critère d'acceptation, **quel persona** doit
  pouvoir le constater. Un critère sans persona n'est pas rejouable en recette.
- **RM-39-07** **Le verdict est écrit, versionné et daté.** Un GO/NO-GO oral n'existe pas : il ne
  se relit pas six mois plus tard, comme un statut sans date
  ([doc 35](35-politique-documentation.md) §4).
- **RM-39-08** **Le GO/NO-GO informe, il ne promeut pas.** La promotion reste un geste humain
  volontaire ([doc 24](exploitation/24-plan-deploiement-serveur-ct-qdo.md) §12.4).
- **RM-39-09** **Le dispositif porte son propre critère d'arrêt** : zéro test permanent né d'une
  exploration sur trois trains consécutifs ⇒ on arrête, et on écrit pourquoi.

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
  déjà été un défaut (`AN-14`).

> **Leçon de l'orchestrateur, applicable telle quelle.** Un egress qu'un compose **affirme** borné
> ne l'est pas — un réseau bridge Docker laisse sortir. Le rayon d'action d'un agent s'écrit en
> **capacités qu'on lui donne**, jamais en interdits qu'on lui énonce.

### 8.2 Plafond de coût par campagne

L'orchestrateur plafonne chaque run et **mesure** ce qu'il dépense. Deux faits mesurés,
réutilisables ici :

- un brief quotidien coûte **≈ 0,39 $** avec `claude-opus-5` ; une campagne de recette, plus
  longue, coûtera davantage — le plafond doit être posé **avant** la première campagne, pas
  après ;
- **compléter la liste d'outils interdits a divisé le coût par deux** (0,62 $ → 0,33 $) : les
  schémas d'outils absents du contexte ne sont plus payés à chaque tour. Un agent qu'on restreint
  coûte moins cher, en plus d'être plus sûr.

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

|  Lot  | Contenu                                                                                                                                                                                                                                                                                                                               | Ce qui prouve que le lot est fini                                                                                                                                                                                                                                            |
| :---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **Le seul engagé.** Agent de recette-persona « parent mobile », un seul parcours : **créer un contrat → saisir un planning → valider la semaine**, sur staging, en émulation mobile, compte non-administrateur, sur le jeu « deux contrats, un mois de trou ». Verdict GO/NO-GO écrit. Conversion de chaque écart en spec permanente. | Un verdict écrit produit **avant un train réel**, et **au moins une spec** née de la campagne, **rouge avant correctif**, verte après. Si la campagne ne trouve aucun écart, le verdict le dit, et les trois défauts du 29/08 sont couverts par des specs écrites à la main. |
| **2** | **Les jeux de données réalistes**, semés par script et versionnés : trou de couverture, contrat sans terme, volume annuel incohérent, mois sans contrat. Extension de `seed-demo.mjs`, ou script frère.                                                                                                                               | Un seed qui produit chaque cas **avec son oracle**, rejouable sur staging comme sur la pile locale                                                                                                                                                                           |
| **3** | **Personas gestionnaire et administrateur** : comptes dédiés en base staging, et rejeu de leurs critères d'acceptation                                                                                                                                                                                                                | Un verdict à **trois personas** sur un train                                                                                                                                                                                                                                 |
| **4** | **Intégration du GO/NO-GO au train de release** : place dans la séquence, forme du verdict, ce qu'un NO-GO déclenche                                                                                                                                                                                                                  | Le runbook porte l'étape, et **un train l'a suivie**                                                                                                                                                                                                                         |
| **5** | **Campagne système exploratoire (rôle B)** : consigne d'exploration, périodicité, plafond, journal                                                                                                                                                                                                                                    | Une campagne périodique qui a produit **au moins un test permanent que personne n'aurait écrit**                                                                                                                                                                             |

**Les lots 2 → 5 ne sont pas engagés.** Ils sont décrits pour que le lot 1 sache vers quoi il
grandit, et ils sont **relus après le lot 1** : si le premier verdict ne trouve rien et n'apprend
rien, la bonne décision est d'écrire les trois specs à la main et de **s'arrêter là**.

> **Ce que le lot 1 coûte s'il échoue** : une soirée, plus le prix d'une campagne. C'est
> précisément le point : la question « un agent trouve-t-il ce que la suite manque ? » se répond
> par une expérience, pas par une spécification.

---

## 10. Prérequis techniques — et l'état réel de chacun

| Prérequis                                         | État constaté                                                                                                                                                                                                                                                             | Ce qu'il reste à faire                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Un staging qui tourne**                         | La pile `creche-planner-staging` **existe** et est spécifiée (doc 24 §12) : silo complet, poller de digest agrégé (`scripts/staging-poll.mjs`), déploiement par `deploy.mjs` paramétré. **Sa fraîcheur réelle n'a pas pu être constatée depuis cette session** (`EM-20`). | **`Q-39-02`** — statuer : redéployer, ou constater qu'il suit `main`                            |
| **Un staging seedé**                              | `scripts/seed-demo.mjs` est idempotent, porte un **oracle** (`--verify`) et accepte `SEED_BASE_URL` : il sait déjà viser une autre gateway que la locale                                                                                                                  | Le pointer sur la gateway staging, et vérifier l'oracle                                         |
| **Des fixtures réalistes**                        | Le jeu actuel porte **déjà** le trou d'août (crèche → 31/07/2026, ABCM → 01/09/2026), mais toujours le **même foyer nominal**                                                                                                                                             | Lot 2 : les cas au-delà du nominal, avec leurs oracles                                          |
| **Des comptes personas non-administrateurs**      | **Rien de tel n'existe.** `ADMIN_EMAILS` distingue déjà admin et non-admin, mais l'identité est **désactivée en staging** (pile en loopback, donc aucun JWT Cloudflare)                                                                                                   | **`Q-39-05`** — qui possède ces comptes, et comment l'agent s'y authentifie sans secret de prod |
| **Un accès en écriture de l'agent, staging seul** | La gateway staging écoute en **loopback** sur le serveur, donc hors de portée depuis le poste sans tunnel                                                                                                                                                                 | Décider la voie d'accès **sans rouvrir ce qu'`AM-94` vient de fermer**                          |
| **Un moteur pour l'agent**                        | Playwright est déjà là (config stack, émulation mobile disponible) ; le harnais de l'orchestrateur est éprouvé                                                                                                                                                            | **`Q-39-01`** — Playwright piloté par l'agent, MCP navigateur, ou mélange des deux              |

> ⚠️ **Le prérequis d'accès est le point dur.** `AM-94` a été refermée le 2026-08-17 en mettant
> **tous les ports de prod et de staging en `127.0.0.1`**, avec une porte (`pnpm conteneurs`,
> règles 7-9) qui refuse tout port non loopback. Donner à un agent une voie d'écriture sur staging
> **ne doit pas** consister à rouvrir un port : la voie propre passe par le serveur lui-même, ou
> par un tunnel authentifié — jamais par une exception dans le compose.

---

## 11. Questions ouvertes

- **Q-39-01 — Quel moteur pour l'agent ?** Trois formes se défendent : (a) l'agent **écrit et
  lance du Playwright** — déterministe, réutilise tout l'existant, mais explore peu ; (b) l'agent
  **pilote un navigateur** par un MCP — explore vraiment, coûte plus, sort des rails ; (c) un
  mélange : piloter pour explorer, écrire du Playwright pour figer. **Recommandation : (c)**, en
  démarrant le lot 1 en (a), parce que le parcours y est déjà connu.
- **Q-39-02 — Remet-on staging en état d'abord ?** Le dispositif n'a aucun sens sans un staging
  qui reflète `main`. Sous-questions : le poller tourne-t-il encore ? les images qu'il surveille
  couvrent-elles les **sept** services applicatifs actuels ? Le geste de secours est connu
  (`remote-deploy.ps1 -Environment staging`, ou un tick forcé côté serveur).
- **Q-39-03 — Le GO/NO-GO est-il bloquant au premier train ?** **Recommandation : consultatif au
  premier train**, bloquant ensuite si et seulement s'il a trouvé quelque chose. Un verdict
  bloquant produit par un dispositif jamais éprouvé transformerait le premier faux positif en
  train annulé — et le dispositif serait débranché le lendemain.
- **Q-39-04 — Quel budget par campagne ?** Ordre de grandeur connu : ≈ 0,39 $ pour un brief
  quotidien de l'orchestrateur ; une campagne de recette est plus longue. Valeur à poser **avant**
  la première campagne, et à comparer au coût de la seule alternative honnête : rejouer le
  parcours à la main.
- **Q-39-05 — Qui possède les personas de test ?** Il faut des **comptes dédiés
  non-administrateurs en base staging**, avec leur foyer, leurs enfants et leurs contrats. Trois
  choses à trancher : qui les crée, comment l'agent s'y authentifie (l'identité est désactivée en
  staging), et si le compte « parent mobile » doit être **le clone du cas d'Anna-Louise** ou un
  foyer inventé.
- **Q-39-06 — Où vit le verdict ?** Un fichier versionné dans le dépôt (traçable, relisible,
  bruyant), ou un artefact de release (propre, mais qui disparaît). **Recommandation : dans le
  dépôt**, un fichier court par train.
- **Q-39-07 — Le rôle B a-t-il lieu d'être si le rôle A suffit ?** À rouvrir **après trois
  trains**, avec le compte d'`US-39-06` en main. La réponse par défaut est **non** : un dispositif
  qu'on ne sait pas justifier ne se garde pas.

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
- **Un coût récurrent**, modeste mais réel, à mettre en regard d'un compte de tests (`US-39-06`).
- **Une remise en état de staging**, qui n'appartient pas à ce chantier mais le conditionne
  entièrement (`Q-39-02`).
- **Ce que cette spécification ne décide pas** : le moment. Elle entre en concurrence avec la
  [SFD 31](31-sfd-calendriers-vacances-scolaires.md) (validée, lots 1 et 2 livrés) et la
  [SFD 38](38-sfd-rattachement-documentaire.md) (validée, non démarrée). Le lot 1 est cependant
  **le seul des trois** à pouvoir s'insérer dans un train existant sans en décaler aucun.
- **Ce qu'elle ne fera jamais** : mettre un agent en porte de livraison (`RM-39-01`), ou toucher
  la production (`RM-39-03`).
