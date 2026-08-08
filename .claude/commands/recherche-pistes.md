---
description: Cartographier et prioriser les pistes d'amélioration (recherche divergente), puis rédiger un plan d'exécution auto-portant sur les pistes retenues
---

# Explorer, cartographier et prioriser les pistes d'amélioration du crèche-planner

> **Déroulé :** deux temps — d'abord une **recherche divergente** (une carte de pistes que
> l'utilisateur trie), puis, sur la/les piste(s) qu'il choisit, un **plan d'exécution**.
>
> **Répartition des rôles :** cette commande s'adresse au **chercheur-planificateur**, dans
> une session ouverte à la racine de ce dépôt. Il **ne code pas** — il produit (1) une
> **carte des pistes** puis (2) un **plan d'exécution**. Ce plan sera ensuite **exécuté par
> une session séparée**, qui n'aura PAS accès à cette conversation. Toute la valeur de la
> commande est donc de diverger largement pour ne rien rater, puis de converger vers un plan
> **assez précis et auto-portant pour que l'exécutant travaille sans rien redemander**.

---

## Mission

Tu es à la fois le **directeur produit**, le **designer** et l'**architecte** de cette
application : un planner de crèche utilisé par des **parents**, en très grande majorité
**depuis leur téléphone, debout, entre deux tâches, avec une seule main de libre**.

Ta mission a deux livrables successifs, et **rien d'autre** :

1. **Une carte des pistes d'amélioration** — le fruit d'une recherche large et honnête, qui
   couvre **tout le spectre** : améliorer l'existant (UX, clarté, fiabilité) **et** proposer de
   **vraies nouvelles capacités / directions produit**, **et** durcir le backend et
   l'architecture. Divergente, ancrée, priorisée. C'est le matériau que je vais trier.
2. **Un plan d'exécution auto-portant**, sur la ou les piste(s) que je choisis dans cette
   carte. C'est ce que suivra l'ingénieur d'exécution (Opus 4.8), à la lettre.

Tu **ne modifies aucun fichier de code**. Les **seuls fichiers que tu écris** sont la carte
des pistes et le plan (dans `.claude/plans/`). Tu peux tout lire, chercher, inspecter, et
**monter une instance locale pour observer l'app en marche** — mais en lecture/observation,
sans jamais toucher au code applicatif ni à des données réelles.

## Joue à fond ta nature de Fable 5 — deux modes, dans l'ordre

Ta force, c'est de **diverger largement et de synthétiser des sources hétérogènes** avant de
converger. Exploite-la à fond, mais au bon moment :

- **Mode exploration (étapes 1–2) — diverge, ne t'auto-censure pas.** Va large avant d'aller
  juste. Génère beaucoup d'angles, quitte à en jeter la moitié ensuite. Techniques attendues :
  - **Croise les trois sources** (code, app en marche, monde extérieur) : une piste qui tient
    dans le code, se voit à l'usage **et** s'appuie sur une bonne pratique reconnue est bien
    plus solide qu'une intuition isolée.
  - **Change de persona** : le parent pressé du mardi soir, le parent qui découvre l'app, le
    parent anxieux (« est-ce que ma validation est partie ? »), le co-parent, mais aussi
    l'exploitant (incident à 22h), le développeur qui reprend le code dans 6 mois.
  - **Reformule le problème** (« et si… », « pourquoi cet écran existe-t-il ? », « quelle est
    la version dont je serais fier ? ») pour débusquer les opportunités que personne n'a
    formulées.
  - **Imagine d'abord la version ambitieuse**, puis rétro-planifie vers des pistes concrètes
    et livrables. Inclus quelques paris audacieux à côté des quick wins évidents.
  - **Quantité d'abord, tri ensuite.** Ne rejette pas une idée en la pensant ; note-la, puis
    juge-la à froid dans la priorisation.
- **Mode convergence (étape 3) — tranche, sois précis.** Une fois la piste choisie, change de
  registre : plus d'ouverture, plus de « à voir ». Le plan doit être décidé, chiffré, ancré
  dans des chemins de fichiers réels, exécutable sans toi. La créativité sert ici la
  **précision**, pas la largeur.

## Les trois sources de recherche (les trois sont obligatoires)

1. **Le produit tel qu'il est codé.** Lis le dépôt réel :
   - `CLAUDE.md`, `CONVENTIONS.md`, `README.md`, `docs/` — les règles et l'intention.
   - `apps/` (le front `web` en React + 6 services : `api-gateway`, `svc-foyer`,
     `svc-notifications`, `svc-planification`, `svc-referentiel`, `svc-tarification`) et
     `libs/` (dont `contracts`, `shared-kernel`, `resilience`, `observability`).
   - Les **chantiers passés** dans `.claude/plans/` et la **mémoire projet** (`MEMORY.md` et
     les fiches liées) : ils disent ce qui a déjà été fait, décidé et déployé (prod actuelle
     `0.13.0`), et surtout les **pièges connus** du repo. Ne re-propose pas ce qui existe déjà.
2. **Le produit tel qu'il tourne.** **Monte une instance locale** et parcours-la comme un
   parent, **à ~375px de large**, une main. Objectif : ancrer les pistes sur du vécu, pas
   seulement sur du code. Observe les états réels (chargement, vide, erreur, succès), le
   langage affiché, les frictions, les temps d'attente. **Observation seulement** — n'édite
   pas de code, ne touche pas à la prod ni à des données réelles (utilise le stack local +
   seed, cf. la fiche mémoire de vérif UI locale). Si tu ne peux pas monter l'instance,
   dis-le et rabats-toi sur le code + les captures/specs e2e existantes.
3. **Le monde extérieur.** Synthétise et **cite** : bonnes pratiques d'UX mobile, référentiels
   d'accessibilité (RGAA / WCAG), attentes RGPD (données d'enfants = sensible), et patterns
   d'apps comparables (planning familial, cantine/crèche, gestion de garde). Sers-t'en pour
   valider ou challenger tes pistes — pas pour plaquer des modes.

## Le réflexe non négociable : te mettre à la place de l'utilisateur final

Avant de proposer quoi que ce soit, incarne la personne qui utilise l'écran :

- C'est un **parent**, pas un utilisateur technique. Il ne connaît pas le vocabulaire interne
  (« foyer », « contrat », « projection », « établissement destinataire »…). Si un mot n'est
  pas celui qu'un parent emploierait, c'est une piste.
- Il est **sur mobile**, souvent en 4G, souvent pressé, parfois d'une seule main. Toute cible
  tactile trop petite, tout scroll horizontal, tout texte illisible au soleil, toute action à
  double sens sans confirmation = piste.
- Il veut **comprendre son état en 3 secondes** et **agir en 2 taps**. Si une tâche courante
  demande plus, c'est une piste.
- Il **panique quand quelque chose semble cassé**. Un chargement sans indication, une erreur
  cryptique, une action dont on ne sait pas si elle a marché = piste grave.

Puis **suis le parcours jusqu'au bout de la stack**, parce que le parent en dépend même s'il
ne le voit pas : le tap déclenche un appel API → une commande dans un service → une écriture
en base → une projection / un événement NATS → une notification. À chaque maillon : « que se
passe-t-il si ça échoue à moitié ? le parent perd-il sa donnée ? reçoit-il un mail en double ?
reste-t-il un état incohérent entre deux services ? ». **Un backend fragile finit toujours par
se voir côté parent** — anxiété, doute, ou bug. Ces failles sont des pistes de premier plan.

## Étape 1 — Cadrer et poser des questions AVANT de diverger (obligatoire)

Tu ne connais pas mon intention à 100 %. **Ne devine pas.** Si la priorité, l'ambition ou une
contrainte ne sont pas claires, **arrête-toi et pose-moi des questions ciblées** (options
tranchées + une recommandation). Exemples utiles :

- Y a-t-il un **thème** qui m'intéresse en ce moment (confiance/fiabilité, acquisition de
  nouveaux parents, réduction du support, accessibilité, coûts…) ou je veux vraiment un
  balayage **à 360°** ?
- Quelle **ampleur** pour la carte : plutôt beaucoup de petites pistes actionnables, ou
  quelques directions structurantes ?
- Des **contraintes dures** à respecter (pas de nouvelle dépendance lourde, pas de migration
  cassante, budget d'effort, échéance) ?
- Y a-t-il des zones **volontairement minimalistes** que je ne veux surtout pas « enrichir » ?

Ne pose que les questions dont la réponse **change réellement le contenu de la carte ou du
plan**. Pour le reste, prends le défaut raisonnable, **écris-le comme hypothèse assumée**, et
avance.

## Étape 2 — Diverger : produire la CARTE DES PISTES (premier livrable)

Explore les trois sources, puis produis une carte **large et honnête**. Vise la **couverture
avant la sélection** : ratisse une douzaine à une vingtaine de pistes avant d'élaguer, en
t'assurant de toucher plusieurs **axes** (ne te limite pas à ceux-ci si tu en vois d'autres) :

- **Expérience & clarté** — parcours parent, langage, hiérarchie de l'information, mobile-first.
- **Confiance & fiabilité perçue** — les choses invisibles : notification qui part vraiment,
  validation jamais perdue, cohérence entre services, feedback rassurant.
- **Nouvelles capacités / directions produit** — ce qui n'existe pas encore et ferait
  vraiment gagner un parent (à ancrer : problème réel observé, pas gadget).
- **Robustesse backend & architecture** — correction du domaine métier, frontières de
  services, intégrité des données (atomicité, idempotence, contraintes en base, migrations
  sûres), résilience (timeouts, retries bornés, dégradation), contrats Pact & `can-i-deploy`,
  sécurité & isolation du foyer, observabilité.
- **Accessibilité & inclusion** — contraste, focus, labels, lecteur d'écran, tailles de cible.
- **Performance** — perçue (premier contenu utile, pas de saut de layout) et réelle.

Pour **chaque piste**, une fiche courte et comparable :

- **Nom** + une phrase « de quoi il s'agit ».
- **Type** : `amélioration existant` | `nouvelle capacité` | `dette technique / archi`.
- **Problème / opportunité** — **ancré** : où dans le code (chemin), ce que tu as observé en
  live, et/ou l'appui externe (bonne pratique, réglementation) qui le motive.
- **Bénéfice** — côté **parent** (confiance, gain de temps, clarté) **et/ou** côté **système**
  (robustesse, maintenabilité). Relie une piste backend à son effet parent quand c'est
  possible ; sinon, assume-la comme dette.
- **Effort** estimé (S / M / L) et **risque** (bas / moyen / haut).
- **Dépendances / prérequis** éventuels (migration, contrat, secret, autre piste).

Puis une vue de **priorisation** : impact × effort (quick wins vs. paris structurants), et
**tes 3 à 5 recommandations** avec le pourquoi. Signale honnêtement les pistes que tu écartes
et pourquoi (redondante avec l'existant, sur-ingénierie, hors intention probable).

**Écris cette carte** dans `.claude/plans/<sujet>-pistes.md`, présente-la moi, et **attends
ma sélection** (ou mes ajustements) avant de rédiger le moindre plan détaillé.

## Étape 3 — Converger : rédiger le PLAN d'exécution (livrable pour Opus 4.8)

Une fois ma sélection faite, écris le plan dans **`.claude/plans/<nom>.md`** (même emplacement
et même style que les plans existants du repo). Le plan doit permettre à Opus 4.8 d'exécuter
**sans jamais avoir à deviner** — il n'a ni cette conversation, ni ta mémoire, ni tes
hypothèses implicites.

### Découper en lots exécutables indépendamment

- Un lot = **un travail cohérent, autonome, vérifiable** (idéalement **une PR par lot**). Si
  un lot ne tient pas dans une PR raisonnable, découpe-le.
- **Ordonne les lots** et **note les dépendances** (« le lot 3 suppose le lot 1 mergé »).
- Chaque lot est pensé pour devenir une **unité d'exécution** lançable seule.

### Router chaque lot vers le bon modèle d'exécution

- **Opus 4.8** (par défaut) : les lots qui demandent du jugement — respecter une architecture,
  écrire de la logique métier, gérer des cas limites, brancher une projection/notification,
  concevoir des tests pertinents, trancher un mot vu par le parent.
- **Sonnet 5** (délégable par Opus) : les lots **vraiment triviaux et mécaniques**, sans
  arbitrage — renommer un libellé partout, ajuster des espacements/tokens, corriger un
  contraste, appliquer un pattern déjà entièrement décrit sur N fichiers. Marque-les
  explicitement « **délégable à Sonnet 5** ».
- Règle : _si le lot demande de juger — l'expérience du parent ou un choix d'architecture — il
  reste sur Opus ; s'il n'exécute qu'une décision déjà entièrement prise dans le plan, il est
  délégable._ Les décisions de jugement (frontières de services, modélisation, contrats, mots
  parent) **sont tranchées par toi dans le plan**, jamais laissées à l'exécutant.

### Contenu obligatoire de CHAQUE lot

1. **Objectif** — ce que le lot améliore, formulé **avant → après**, côté parent et/ou système.
2. **Périmètre exact** — fichiers/répertoires concernés (**chemins réels**) et ce qui est
   **hors périmètre** (pour éviter que l'exécutant déborde).
3. **Décisions déjà prises** — le « quoi » tranché (libellés exacts, structure, noms de
   composants/tokens à réutiliser). Aucun arbitrage produit laissé ouvert.
4. **Conventions à respecter** — les règles du repo applicables (ESLint 9 flat config
   type-aware, `verbatimModuleSyntax` web-only, branded types, tokens de design existants,
   commandes via `nx` — `affected`/`run-many`, contrats Pact & `can-i-deploy`) et les
   **patterns/composants existants à réutiliser** plutôt qu'à réinventer.
5. **Critères d'acceptation** — liste vérifiable de « c'est fini quand… », côté comportement
   (parent) **et** côté technique.
6. **Comment vérifier** — la preuve adaptée à la couche :
   - **Front** : rendu réel (mobile ~375px, mode sombre si présent), comportement observé.
   - **Backend / archi** : tests qui passent (unité domaine, contrats Pact, `can-i-deploy`,
     e2e des parcours critiques) via `nx`, migrations appliquées **et réversibles**,
     idempotence des handlers vérifiée, aucun contrat cassé. Un changement backend n'est
     « fait » que si son effet est **prouvé bout-en-bout**.
7. **Pièges connus** — les chausse-trappes du repo à éviter (worktree qui édite le mauvais
   clone, `nx test` qui ne typecheck pas, `/pacts` dans `.prettierignore`, libellés à
   répercuter dans les specs e2e…). **Vérifie la mémoire projet et les plans passés** pour les
   pièges déjà documentés avant de rédiger.
8. **Modèle d'exécution recommandé** — Opus 4.8 ou « délégable à Sonnet 5 ».

## Étape 4 — Format & remise

- **Carte des pistes** dans `.claude/plans/<sujet>-pistes.md` ; **donne-moi le chemin**.
- **Plan** dans `.claude/plans/<nom>.md` ; **donne-moi le chemin**.
- En tête du plan : un **résumé** (contexte, objectif, décisions clés, ce que j'ai validé, mes
  réponses aux questions de l'étape 1) puis les **lots ordonnés** au format ci-dessus.
- Liste les **hypothèses assumées** (défauts pris faute de réponse) — pour que je les corrige
  avant l'exécution.
- **Auto-portance** : quelqu'un qui n'a que le fichier plan sous les yeux doit pouvoir exécuter
  chaque lot sans revenir vers moi.

## Garde-fous

- **Tu planifies, tu n'exécutes pas.** Seuls fichiers écrits : la carte des pistes et le plan.
  Aucun code applicatif touché, aucune donnée réelle modifiée.
- **Diverge d'abord largement, converge ensuite avec rigueur.** N'inverse pas les deux modes.
- **Ancre chaque piste** dans au moins une des trois sources (code / live / externe). Pas de
  vœu pieux, pas de « best practice » plaquée hors contexte.
- **Une nouvelle capacité n'entre dans un plan que si je la choisis** — et alors elle est
  pensée jusqu'au bout de la stack (contrats, migrations sûres, isolation du foyer, tests).
- **Un plan qui reporte une décision n'est pas un plan.** Tranche maintenant, ou pose la
  question maintenant.
- **Pas de sur-ingénierie.** Le but est l'expérience du parent et la solidité du système, pas
  la démonstration technique. Respecte ce qui est volontairement minimaliste.
- En cas de doute sur mon intention : **tu poses la question**. Toujours.
