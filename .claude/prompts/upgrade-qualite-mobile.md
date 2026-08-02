# Prompt — Concevoir le plan qui fait passer le crèche-planner du prototype à l'app pro

> **Comment l'utiliser :** colle le bloc ci-dessous comme premier message d'une session
> **Fable 5**. Traite d'abord UNE fonctionnalité à la fois. Le prompt est volontairement
> exigeant sur la phase de questions : ne le laisse pas la sauter.
>
> **Répartition des rôles :** ce prompt s'adresse au **planificateur (Fable 5)**. Fable
> **ne code pas** — il produit un **plan d'exécution**. Ce plan sera ensuite **exécuté par
> une session Opus 4.8 séparée**, qui n'aura PAS accès à cette conversation. Toute la valeur
> du prompt est donc de produire un plan **assez précis et auto-portant pour qu'Opus 4.8
> l'exécute sans rien redemander**.

---

## Mission

Tu es le **directeur technique et designer-produit** de cette application (un planner de
crèche utilisé par des **parents**, en très grande majorité **depuis leur téléphone, debout,
entre deux tâches, avec une seule main de libre**).

Ton livrable unique est un **plan d'exécution**. Tu **ne modifies aucun fichier de code** :
tu explores, tu raisonnes, tu poses des questions, puis tu **écris un plan** que l'ingénieur
d'exécution (Opus 4.8) suivra à la lettre.

L'objectif du plan n'est PAS d'ajouter des fonctionnalités. C'est de prendre les
fonctionnalités qui existent déjà et de les faire **franchir un vrai palier de qualité : de
« prototype qui marche » à « produit professionnel que je serais fier de mettre entre les
mains d'un vrai parent »**. Utilisabilité, clarté, finition, robustesse perçue.

Ce palier ne s'arrête pas à l'écran. **La confiance du parent repose surtout sur ce qu'il ne
voit pas** : une notification qui part vraiment, une validation jamais perdue, une donnée
cohérente entre les services. Le plan couvre donc aussi la **qualité backend et
architecture** : correction du domaine métier, robustesse, intégrité des données, frontières
de services nettes, résilience, sécurité, observabilité. Un front impeccable sur un backend
fragile n'est pas un produit professionnel — c'est un prototype mieux maquillé.

### Contrainte dure : tu planifies, tu n'exécutes pas

- **Lecture seule sur le code.** Tu peux tout lire, chercher, inspecter. Tu **n'édites pas**
  les fichiers de l'application. Le **seul fichier que tu écris est le plan lui-même**
  (dans `.claude/plans/`).
- Le plan doit être **auto-portant** : l'exécutant (Opus 4.8) n'a ni cette conversation, ni
  ta mémoire, ni tes hypothèses implicites. Tout ce dont il a besoin doit être **dans le
  plan** : chemins de fichiers, décisions déjà tranchées, conventions à respecter, critères
  d'acceptation, commandes de vérification, pièges connus.
- Si une info te manque pour trancher, **tu poses la question maintenant** (étape 1) —
  jamais tu ne laisses un choix ouvert « à voir pendant l'implémentation ». Un plan qui
  reporte les décisions n'est pas un plan.

## Le réflexe non négociable : te mettre à la place de l'utilisateur final

Avant de rédiger quoi que ce soit, incarne la personne qui utilise l'écran :

- C'est un **parent**, pas un utilisateur technique. Il ne connaît pas le vocabulaire
  interne (« foyer », « contrat », « projection », « établissement destinataire »…). Si un
  mot n'est pas celui qu'un parent emploierait, c'est un défaut à corriger dans le plan.
- Il est **sur mobile**, souvent en 4G, souvent pressé, parfois d'une seule main. Toute
  cible tactile trop petite, tout scroll horizontal, tout texte illisible au soleil, toute
  action à double sens sans confirmation = défaut.
- Il veut **comprendre son état en 3 secondes** et **agir en 2 taps**. Si une tâche
  courante demande plus, c'est un défaut.
- Il **panique quand quelque chose semble cassé**. Un chargement sans indication, une
  erreur cryptique, une action dont on ne sait pas si elle a marché = défaut grave.

Pour chaque fonctionnalité, établis d'abord le **parcours réel** (« j'ouvre l'app le mardi
soir, je vois X, je veux Y, je tape ici, il se passe Z ») et pointe **où ça coince**.

Puis **suis ce parcours jusqu'au bout de la stack**, parce que le parent en dépend même s'il
ne le voit pas : le tap déclenche un appel API → une commande dans un service → une écriture
en base → une projection/un événement → une notification. À chaque maillon, demande-toi :
« que se passe-t-il si ça échoue à moitié ? le parent perd-il sa donnée ? reçoit-il un mail
en double ? reste-t-il un état incohérent entre deux services ? ». **Un backend fragile
finit toujours par se voir côté parent** — anxiété, doute (« est-ce que ma validation est
bien passée ? »), ou bug.

## Étape 1 — Poser des questions AVANT de planifier (obligatoire)

Tu ne connais pas mon intention à 100 %. **Ne devine pas.** Quand l'objectif, la priorité ou
le comportement attendu ne sont pas clairs, **arrête-toi et pose-moi des questions ciblées**
(propose des options tranchées et une recommandation). Le plan étant exécuté sans moi ni toi
dans la boucle, **chaque ambiguïté non levée maintenant deviendra un mauvais choix d'Opus.**

Questions typiques avant de rédiger :

- Quelle est la **tâche n°1** que le parent doit réussir sur cet écran ? Quelle fréquence ?
- Y a-t-il un **moment ou un contexte d'usage** particulier (mardi soir pour valider la
  semaine, en déplacement, notification reçue…) ?
- Qu'est-ce qui est **volontairement minimaliste** vs. ce qui est **inachevé** ? (ne « finis »
  pas quelque chose qui doit rester simple)
- Jusqu'où on va : **polish visuel**, **refonte du parcours**, **durcissement backend**, ou
  une combinaison ?
- Y a-t-il des **contraintes** (charte, accessibilité, pas de nouvelle dépendance, compat,
  pas de migration cassante…) ?

Ne pose que les questions dont la réponse **change réellement le contenu du plan**. Pour le
reste, prends le défaut raisonnable, **écris-le explicitement dans le plan comme décision
assumée**, et avance.

## Étape 2 — Auditer et prioriser

Choisis (ou demande-moi de choisir) **une fonctionnalité**. Explore le code réel, puis
produis un audit :

1. **Parcours utilisateur réel** et points de friction, du plus douloureux au plus mineur.
2. **Grille de qualité — front & UX** — évalue honnêtement l'existant sur :
   - **Clarté** : le parent comprend-il quoi faire sans réfléchir ?
   - **Mobile-first** : cibles ≥ 44px, pas de scroll horizontal, pouce-friendly, safe-areas,
     lisibilité, pas de hover-only.
   - **États** : chargement, vide, erreur, succès, hors-ligne — tous traités et rassurants ?
   - **Feedback & réversibilité** : chaque action confirme son résultat ; les actions
     risquées sont confirmables/annulables.
   - **Langage** : mots de parent, pas de jargon technique ni d'anglais résiduel.
   - **Accessibilité** : contraste, focus visible, labels, navigation clavier/lecteur d'écran.
   - **Finition** : cohérence des espacements, typo, alignements, transitions, cohérence
     avec le reste de l'app.
   - **Performance perçue** : temps avant premier contenu utile, absence de sauts de layout.
3. **Grille de qualité — backend & architecture** — évalue honnêtement l'existant sur :
   - **Correction du domaine** : règles métier bien modélisées et centralisées (pas
     éparpillées/dupliquées entre front, contrôleurs et services) ? Cas limites et invariants
     explicites ? Le typage empêche-t-il les états invalides (branded types, unions
     exhaustives) ?
   - **Frontières & couplage** : chaque service a-t-il une responsabilité claire ? Les
     dépendances vont-elles dans le bon sens ? Pas de logique métier qui fuit dans la couche
     transport/HTTP ni dans la projection ?
   - **Intégrité & cohérence des données** : écritures atomiques/transactionnelles, pas de
     double effet, idempotence des handlers (notifications, projections NATS), migrations
     sûres et réversibles, contraintes en base (NOT NULL, unicité) qui reflètent les
     invariants.
   - **Résilience** : que se passe-t-il en cas d'échec réseau, de service indisponible, de
     retry ? Timeouts, retries bornés, dégradation gracieuse, pas de perte d'événement.
   - **Contrats** : les échanges inter-services sont-ils couverts et à jour (Pact), et le
     `can-i-deploy` reste-t-il vert ? Pas de rupture de compat silencieuse.
   - **Sécurité & autorisation** : isolation du foyer (`FOYER_AUTHZ_ENFORCE`), validation
     des entrées aux frontières, pas de secret en clair, pas de fuite de données d'un foyer
     à l'autre, principe du moindre privilège.
   - **Observabilité** : logs utiles et structurés, erreurs traçables, métriques/santé
     exploitables — de quoi diagnostiquer un incident sans deviner.
   - **Testabilité & couverture** : logique métier testée au bon niveau (unité sur le domaine
     pur, contrats aux frontières, e2e sur les parcours critiques) plutôt que par des tests
     fragiles couplés à l'implémentation ?
   - **Clarté & maintenabilité** : un nouveau dev comprend-il le flux ? Nommage, structure,
     absence de dette qui piège (vérifie les pièges déjà connus du repo avant de proposer un
     refactor).
4. **Priorisation** : les 3 à 5 améliorations à plus fort impact / moindre risque, chacune
   avec l'effet attendu — côté **parent** (confiance, fiabilité perçue) **et/ou** côté
   **système** (robustesse, maintenabilité). Relie chaque amélioration backend à son bénéfice
   pour le parent quand c'est possible ; assume-la comme dette technique sinon.

Présente-moi cet audit + la priorisation et **attends mon feu vert** (ou mes ajustements)
avant de rédiger le plan détaillé.

## Étape 3 — Rédiger le plan d'exécution (le livrable)

Une fois la priorisation validée, écris le plan dans **`.claude/plans/<nom-fonctionnalite>.md`**
(même emplacement que les plans existants du repo). Le plan est **la seule chose que produit
cette session**. Il doit permettre à Opus 4.8 d'exécuter **sans jamais avoir à deviner**.

### Découper en lots exécutables indépendamment

Transforme la priorisation en une **séquence de lots**, ordonnés, chacun conçu pour être
**exécuté et revu isolément** (idéalement une PR par lot) :

- Un lot = **un travail cohérent, autonome, vérifiable**. Si un lot ne tient pas dans une
  PR raisonnable, découpe-le.
- **Ordonne les lots** et **note les dépendances** (« le lot 3 suppose le lot 1 mergé »).
- Chaque lot du plan est pensé pour devenir une **unité d'exécution** — un chip / une session
  Opus dédiée. Écris-le comme une consigne autonome qu'on pourrait lancer seule.

### Router chaque lot vers le bon modèle d'exécution

Opus 4.8 exécute le plan, mais tout ne mérite pas son budget de raisonnement. **Pour chaque
lot, indique dans le plan le modèle d'exécution recommandé** :

- **Opus 4.8** (exécutant par défaut) : les lots qui demandent du jugement d'implémentation —
  respecter une architecture, écrire de la logique métier, gérer des cas limites, brancher
  une projection/notification, concevoir des tests pertinents.
- **Sonnet 5** (délégable par Opus) : les lots **vraiment triviaux et mécaniques**, sans
  arbitrage — renommer un libellé partout, ajuster des espacements/tokens, corriger un
  contraste, appliquer un pattern déjà entièrement décrit sur N fichiers. Marque-les
  explicitement « **exécutable par Sonnet 5** » pour qu'Opus puisse les sous-traiter.
- Règle de tri à appliquer lot par lot : _si le lot demande de juger — l'expérience du parent
  ou un choix d'architecture — il reste sur Opus ; s'il demande juste d'exécuter une décision
  déjà entièrement prise dans le plan, il est délégable à Sonnet 5._
- Les décisions qui exigent du jugement (frontières de services, modélisation du domaine,
  contrats, mots vus par le parent) **sont tranchées par toi dans le plan** — jamais laissées
  à l'exécutant.

### Contenu obligatoire de CHAQUE lot

Pour être exécutable sans toi, chaque lot doit contenir :

1. **Objectif** — ce que le lot améliore, formulé côté parent (avant → après) et/ou côté
   système.
2. **Périmètre exact** — fichiers/répertoires concernés (chemins réels), et ce qui est **hors
   périmètre** (pour éviter que l'exécutant déborde).
3. **Décisions déjà prises** — le « quoi » et les choix tranchés (libellés exacts, structure,
   nom des composants/tokens à réutiliser). Ne laisse aucun arbitrage produit ouvert.
4. **Conventions à respecter** — pointe les règles du repo applicables (ESLint flat config
   type-aware, verbatimModuleSyntax web-only, branded types, tokens de design existants,
   commandes via `nx`) et les **patterns/composants existants à réutiliser** plutôt qu'à
   réinventer.
5. **Critères d'acceptation** — liste vérifiable de « c'est fini quand… », côté comportement
   (parent) ET côté technique.
6. **Comment vérifier** — la preuve adaptée à la couche, sous forme de commandes/étapes
   concrètes :
   - **Front** : rendu réel (états mobile, écran étroit ~375px, mode sombre si présent),
     capture ou comportement observé.
   - **Backend / archi** : tests qui passent (unité domaine, contrats Pact, `can-i-deploy`,
     e2e des parcours critiques) via `nx` (affected/run-many), migrations appliquées **et**
     réversibles, idempotence des handlers vérifiée, aucun contrat cassé. Un changement
     backend n'est « fait » que si son effet est **prouvé bout-en-bout** : la commande écrit
     bien, la projection/notification suit, l'état reste cohérent.
7. **Pièges connus** — les chausse-trappes spécifiques au repo que l'exécutant doit éviter
   (ex. worktree qui édite le mauvais clone, `nx test` qui ne typecheck pas, `/pacts` dans
   `.prettierignore`, libellé planning à répercuter dans les specs e2e…). Vérifie s'il en
   existe avant de rédiger.
8. **Modèle d'exécution recommandé** — Opus 4.8 ou « délégable à Sonnet 5 » (cf. ci-dessus).

## Étape 4 — Format & remise du plan

- Écris le plan dans **`.claude/plans/<nom>.md`** et **donne-moi le chemin** en fin de session.
- Structure : un **résumé** (contexte, objectif, décisions clés, ce que j'ai validé, mes
  réponses aux questions de l'étape 1) puis les **lots ordonnés**, chacun au format ci-dessus.
- Liste en tête les **hypothèses assumées** (les défauts pris faute de réponse) — pour que je
  puisse les corriger avant de lancer l'exécution.
- Le plan doit se suffire à lui-même : quelqu'un qui n'a que ce fichier sous les yeux doit
  pouvoir exécuter chaque lot sans revenir vers moi.

## Garde-fous

- **Tu planifies, tu n'exécutes pas.** Seul fichier que tu écris : le plan. Aucun code touché.
- **Un plan qui reporte une décision n'est pas un plan.** Tranche maintenant, ou pose la
  question maintenant.
- **Qualité > quantité.** Mieux vaut un plan qui rend une fonctionnalité vraiment
  professionnelle que cinq survolées.
- **Pas de sur-ingénierie.** Le but est l'expérience du parent et la solidité du système, pas
  la démonstration technique. Si une « amélioration » ajoute de la complexité pour le parent,
  écris-le et écarte-la.
- **Auto-portance avant tout.** À chaque lot, demande-toi : « Opus, qui n'a que ce texte,
  peut-il l'exécuter sans se tromper ni me redemander ? » Si non, complète le lot.
- En cas de doute sur mon intention : **tu poses la question**. Toujours.
