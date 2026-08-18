---
name: chantier-cout-ne-ment-plus
description: 'Chantier « Le coût ne ment plus » (validé PO 2026-08-16) — COMPLET : lots 1 (c1086f7), 2 (5516e00) et 3 (9b94764) MERGÉS le 2026-08-17, AUCUN DÉPLOYÉ, train visé ~23/08 ; restent AM-88, AM-90, AM-98, AM-99'
metadata:
  node_type: memory
  type: project
---

# Chantier « Le coût ne ment plus »

Validé par le PO le **2026-08-16**. Il attaque une famille de défauts unique : le
calcul de coût **répond toujours**, y compris quand il n'a pas de quoi répondre.

## ✅ CHANTIER COMPLET — et RIEN N'EST DÉPLOYÉ

Les **trois** lots sont mergés dans `main` le **2026-08-17** : lot 1 `c1086f7`
(PR #336), lot 2 `5516e00` (PR #344), lot 3 `9b94764` (PR #348). **Aucun n'a été
déployé** : ils attendent tous le même train, visé **~2026-08-23**, avec le lot 9
des standards (`d913cf6`). Tant que ce train n'est pas passé, la production ne
porte **aucun** de ces comportements — ni le refus 422 d'un mois non couvert, ni
les gardes d'envoi, ni les filtres d'abonnement.

⚠️ **Le relevé `dead_letter` se juge APRÈS ce train, jamais avant.** Le filtre
`filter_subjects` n'est posé qu'au **redémarrage** du service (`consumers.update`,
`LE-53`) : d'ici là les baselines `TYPE_INCONNU` de [[prod-deployment-facts]]
(notif 144, foyer 10, tarif 1) restent **normales** et ne doivent pas être
rediagnostiquées. Après le train, elles doivent tomber à zéro — et un
`TYPE_INCONNU` qui persiste cesse d'être « bénin » : il veut alors dire qu'un
`typesGeres` est en retard sur les contrats.

⚠️ **Quatre migrations partent avec ce train** : `svc-foyer/0007` + `svc-tarification/0009`
(lot 1), `svc-foyer/0008` + `svc-notifications/0020` (lot 2). Le lot 3 n'en porte
aucune. Rollbacks détaillés dans les sections de lot ci-dessous.

## Lot 1 — « la fin d'une version existe » (`AM-55`, `AM-13`)

**MERGÉ le 2026-08-17 (PR #336, squash `c1086f7`) — NON DÉPLOYÉ.** 45 fichiers,
+3033/−170 ; CI verte de bout en bout (24 checks), `e2e-stack` et `smoke-stack`
compris. Il attend un train de release, **avec le lot 9 des standards** (`d913cf6`)
qui attend le même. ⚠️ Deux migrations partent avec lui (`0007` foyer, `0009`
tarification) : additives, back-fill inclus, rollback = `DROP COLUMN date_fin`.

**Le résultat principal, et il vaut pour tout ce dépôt : une valeur dérivée à la
lecture par deux consommateurs n'est pas une donnée, c'est deux données qui ne
divergeront qu'un jour** (`LE-62`). La fin d'une version de ressources était
calculée par `depuisSuite` chez celui qui lisait — svc-foyer, svc-tarification, le
front. Chacun étirait donc la **dernière** version vers l'avenir et la **première**
vers le passé, et rien ne distinguait « encore en vigueur » de « je ne sais pas ce
qui suit ».

**Constat négatif mesuré avant d'écrire une ligne** : un foyer dont la plus ancienne
version prend effet le 2026-01-01, interrogé sur **2023** (16 j de cantine en
octobre), rendait **20 288 c.** — les ressources de 2026 appliquées à 2023, sans un
log. Deux chemins distincts donnaient le même montant (aucune version projetée /
version postérieure étirée) : n'en corriger qu'un aurait laissé l'autre mentir.

Livré : `foyer_version.date_fin` matérialisée dans les deux services (`NULL` = en
vigueur), maintenue par `materialiserFins` **dans la transaction**, transportée par
un champ additif de `FoyerMisAJour.v3` ; le calcul lit les bornes **stockées** et
répond **422 `RESSOURCES_INCONNUES_AU_MOIS`** au lieu d'inventer.

### Pièges que ce lot a payés — à ne pas repayer

- ⚠️ **Une garde posée sur « aucune ligne » ne voit jamais rien quand l'amont rend
  toujours une ligne** (`LE-65`). `svc-planification.prestationsMois` renvoie
  **toujours** une prestation par contrat, à quantités nulles pour un mois hors
  période ou jamais saisi. La garde doit porter sur la **quantité facturable**
  (`prestationEstVide`), jamais sur `projections.length === 0` — sinon janvier d'un
  foyer créé en mars fait refuser l'année en cours entière.
- ⚠️ **Un refus métier déterministe comptait comme une panne de transport**
  (`LE-64`). `executerResilient` ne rejouait pas une erreur non rejouable mais
  appelait quand même `breaker.echec()` : trois 4xx consécutifs ouvraient le
  disjoncteur **partagé** du client, et tout le monde tombait en 502. Corrigé dans
  `libs/resilience` — vaut pour les 409 de tous les clients.
- ⚠️ **Un jeu de données de test peut passer _parce que la date du jour le veut
  bien_.** Le `stateHandler` du pact tarification ne seedait aucune
  `foyer_version` : il ne passait que tant qu'octobre 2026 était à venir. Même
  famille pour `seed-demo.mjs`, qui datait la version au jour du seed alors que
  l'oracle attend mars 2026. Les deux déclarent maintenant `2026-01-01`.
- ⚠️ **Une migration écrite à la main exige son `meta/000X_snapshot.json`**, sinon
  le prochain `drizzle-kit generate` ré-émet le DDL. Sonde : `generate` doit
  répondre « No schema changes ». (Le SQL généré s'est révélé byte-identique au
  DDL manuel — le comparer est un bon contrôle.)
- ⚠️ **Le ratchet ESLint est un plafond global ET par règle.** `expect.objectContaining`
  rend `any` : chaque matcher imbriqué coûte un `no-unsafe-assignment`, et cette
  règle était pile à sa borne (27). Lire le payload et asserter la **valeur** est à
  la fois moins cher et plus fort.

### Ce qui reste — deux arbitrages PO, aucun code bloqué

- **`AM-88` — purge T1 de `foyer_version`.** Techniquement écrivable depuis ce lot
  (la fin existe, `date_fin IS NULL` protège la version en vigueur, l'index partiel
  est posé dans les deux services). Mais poser la borne, c'est décider que le coût
  des années au-delà de trois ans **cesse d'être consultable** : il refusera, en le
  disant. Doc 37 T1 reste ⛔ avec ce motif **nouveau**.
- **`AM-90` — la mensualité crèche est facturée sur chaque mois couvert**, alors
  qu'elle lisse un volume annuel sur `nbMensualites` mois. Défaut **pré-existant**
  (un contrat fermé de 12 mois à 7 mensualités sur-facture déjà 1 518 h pour 885,5 h
  contractualisées) ; `AM-13` le rend simplement atteignable sur un contrat sans
  terme. Le domaine n'a aucune notion des mois **effectivement** facturés.

### `AM-13` : l'énoncé accusait le mauvais endroit depuis des mois

Le domaine **filtrait déjà** chaque jour par sa période. Le défaut réel était
l'inverse : `ContratCreche` **exigeait** un `valideAu` alors que la colonne est
nullable, donc l'appelant inventait une fin (`?? valideDu`) — une période d'un seul
jour, qui passe INV-01. Un contrat crèche sans terme facturait **0 h** dès le mois
suivant son début. **Un domaine qui refuse de représenter un cas force l'appelant à
mentir, et le mensonge est plus discret que le refus** (`LE-63`).

## Lot 2 — envois bornés + consentement explicite (`AM-58`, `AM-57`)

**MERGÉ le 2026-08-17 (PR #344, squash `5516e00`) — NON DÉPLOYÉ.** 44 fichiers,
+1475/−229 ; CI verte de bout en bout (24 checks), `e2e-stack` et `smoke-stack`
compris. Il attend un train de release **avec le lot 1** (`c1086f7`) et le lot 9 des
standards (`d913cf6`). ⚠️ Deux migrations partent avec lui (`svc-foyer/0008`,
`svc-notifications/0020`) : additives, sans DDL, back-fill inclus ; rollback =
`DELETE … WHERE source_dernier = 'DEFAUT'` et `DELETE … WHERE event_id IS NULL AND
occurred_at IS NULL`.

Même famille de défauts que le lot 1, **transposée aux notifications** : un état est
déduit d'une absence, et rien ne borne ce que l'absence autorise.

### Le constat négatif a trouvé un troisième défaut, plus grave que l'énoncé

L'énoncé annonçait la borne temporelle. Reproduit avant d'écrire une ligne, il tenait —
un `POST` sur `2019-W01` sollicitait bien le mailer vers `jaudrey@cscpapin.asso.fr`. Mais
la même sonde a montré qu'un récap **sans aucun enfant concerné** partait tout autant, et
disait à la crèche « Aucune modification déclarée sur cette semaine ». C'est le défaut le
plus atteignable des deux : le front filtre (`concernes.length > 0`), donc la règle
_paraissait_ implémentée — personne ne l'avait écrite côté serveur (`LE-73`).

### Ce que le lot pose

- **`AM-58`** — deux gardes serveur **avant** toute écriture et toute sollicitation du
  transport : semaine révolue de plus de `NOTIF_ENVOI_RETARD_MAX_SEMAINES` (défaut **4**,
  422 `SEMAINE_HORS_FENETRE_ENVOI`) et récap sans modification (422
  `RECAP_SANS_MODIFICATION`). Le **futur n'est pas borné** — le planning se saisit des
  mois à l'avance. Front : le bouton s'arme sur l'état **persisté** (`lireSuiviEnvois`).
- **`AM-57`** — le consentement est **écrit**, plus déduit. La matrice §5.1 est
  matérialisée à l'inscription (`source_dernier = 'DEFAUT'`), diffusée par
  `PreferencesNotifModifiees`, back-fillée (`svc-foyer/0008`, `svc-notifications/0020`) ;
  `preferencesEffectives` (ex-`fusionnerDefauts`) et `DestinatairesService` exigent une
  ligne **explicitement active**. ⚠️ `onConflictDoNothing` sur la **réactivation** d'un
  parent : sans lui, revenir dans un foyer réabonnerait un désabonné — le défaut fermé,
  réintroduit par le chemin d'à côté.

### Pièges que ce lot a payés

- ⚠️ **Une règle relative à « maintenant » date rétroactivement tous les jeux figés**
  (`LE-70`). `envoi.service.spec.ts` visait `2026-W27` avec `horlogeSysteme` : il aurait
  rougi **à partir du 3 août 2026** sans qu'aucune ligne de production ait bougé. Le pact
  `api-gateway ↔ svc-notifications` fige `2026-W10` **dans le fichier de contrat**, donc
  aucune horloge de test ne le sauve : la vérification provider relève la borne par env.
- ⚠️ **Un défaut de lecture retiré périme les jeux figés qui ne l'écrivaient pas**
  (`LE-73`). Le `stateHandler` du pact **svc-foyer** « coupe un canal non critique »
  seedait un parent sans aucune préférence — il ne tenait que par la règle qu'`AM-57`
  retirait. Rendu **409 au lieu de 204**, vu par la seule CI (le pact provider exige un
  Postgres). L'inventaire fait pour la borne temporelle n'avait pas été refait pour la
  fermeture du filtre de consentement.
- ⚠️ **Le smoke `GET /api/v1/couts` était une course, et le 422 du lot 1 l'a rendue
  visible** (`LE-74`) : le seed écrit dans svc-foyer, le coût se lit dans le read model
  de svc-tarification, et `curl --fail --retry` ne rejoue **pas** un 4xx. Rouge une fois
  sur deux, vert au simple re-run. Corrigé par `--retry-all-errors`, comme le smoke de
  santé deux lignes plus haut.
- ⚠️ **Aucun contrôle du dépôt n'exécute une migration de back-fill sur des données**
  (`EM-16`). `e2e-stack`/`smoke-stack` migrent une base **vierge** : les deux `INSERT …
SELECT` de ce lot y traitent zéro ligne. Vérification manuelle impossible : **Docker
  Desktop refuse de démarrer** sur le poste (« Docker Desktop is unable to start »).
- ⚠️ La porte `pnpm environnement` (peu connue) refuse une variable déclarée par un
  service qu'aucun compose ne pose : le défaut de code doit être **assumé par écrit**
  dans `DEFAUTS_DE_CODE_ASSUMES` (`scripts/verifier-environnement.mjs`).
- ⚠️ `svc-notifications` ne dépendait pas de `@creche-planner/contracts-kernel` : émettre
  un code métier `satisfies CodeProbleme` a demandé la dépendance workspace + un
  `pnpm install` (3 lignes de lock).

## Lot 3 — « les files qui se taisent » (`AM-53`, `AM-61`)

**MERGÉ le 2026-08-17 (PR #348, squash `9b94764`) — NON DÉPLOYÉ.** 32 fichiers,
+2310/−226 ; **23 checks sur 23 verts**, `e2e-stack` et `smoke-stack` compris. Aucune
migration, aucun changement visible par l'utilisateur. Il attend le même train que les
lots 1 et 2 et que le lot 9 des standards (`d913cf6`).

**Ce lot clôt le chantier.**

### Le constat négatif a périmé l'énoncé, comme aux deux lots précédents

L'énoncé d'`AM-53` disait `dead_letter` « sans borne » : **faux depuis le lot 2b des
standards** (`tachePurgeDeadLetter`, 90 j effectifs). Le critère offrait trois branches,
et celle de la rétention était donc **déjà satisfaite** — fermer la piste dessus aurait
été un geste nul. C'est le filtre qui a été retenu : la rétention ne fait que **retarder**
de trois mois la copie en clair, le filtre l'empêche d'exister. Ni « rebut sans payload »,
qui aurait aveuglé le diagnostic des vrais rebuts.

**Avant, mesuré en production** (baselines du train `0.16.0`, cf. [[prod-deployment-facts]]) :
notif `TYPE_INCONNU=144` sur `planification.PlanningModifie.v1` (72→144, le seed de chaque
deploy la remplit), foyer `=10`, tarif `=1` — **155 payloads en clair**, tous attribués au
« consommateur durable sans `filter_subject` », tous jugés **« bénins »** à l'époque.
C'est exactement ce que `LE-75` corrige : l'alerte les excluait, donc rien ne pouvait les
compter. Dérivé côté code par `pnpm abonnements` : **29 couples type×durable** livrés pour
rien, dont **9 des 11 types de `FOYER` chez `svc-planification`**.

**Après, relevé sur la pile réelle** (`e2e-stack`) : les quatre bases — foyer,
notifications, planification, tarification — rendent **aucun rebut**, et la sonde prouve
que le relevé voit bien une ligne injectée. C'est le critère mot à mot.

### Ce que le lot pose

- **`AM-53`** — `filter_subjects` **dérivé** de `ProjectionPort.typesGeres` sur les 7
  durables. L'équivalence `typesGeres` ⟷ `switch` est prouvée **par exécution** (4
  `projection.types-geres.spec.ts` : tout type déclaré a une branche, aucun type non
  déclaré n'en a — l'inventaire vient des contrats, `TYPES_EVENEMENTS_<CONTEXTE>`). Un
  abonnement sans sujet géré **refuse le boot** : côté JetStream `filter_subjects: []`
  vaut « tout le stream ».
- **`AM-61`** — le `try` passe **dans** la boucle du relais, l'échec porte le `type` en
  attribut, et `outbox_attente_age_secondes` date la plus vieille ligne non publiée
  (calcul **en base**, donc aucune horloge à figer — `LE-70`). Alerte `OutboxAttenteAgee`
  (> 30 min) + runbook.
- Deux portes neuves : `pnpm abonnements` (2 sondes) et `scripts/relever-rebuts.mjs` dans
  `e2e-stack` (1 sonde) — cette dernière est le relevé littéral du critère.
- L'exclusion `raison!="TYPE_INCONNU"` de `ConsumerRejetsDetectes` est **levée**.

### La revue a trouvé un défaut que le lot introduisait — et le remède en cachait un autre

- ⚠️ **`LE-77` — retirer un blocage, c'est autoriser un réordonnancement, et l'ordre
  tenait quelque chose.** L'isolation par événement laissait un `foyer.FoyerSupprime.v1`
  dépasser un `foyer.Parent*.v1` en échec **transitoire** : effacement du foyer chez les
  consommateurs, puis **ré-insertion** de l'adresse e-mail du parent. Les gardes
  `occurred_at` ne protègent que des lignes encore présentes, et `processed_event` ne dit
  rien d'une **première** livraison tardive. Un effacement RGPD serait devenu révocable.
  Corrigé par l'ordre **par foyer** (`payload.foyerId`), l'isolation ne jouant qu'entre
  foyers distincts.
- ⚠️ **Et le remède ressuscitait le défaut d'origine, une strate plus bas** : un foyer
  bloqué qui porte à lui seul les 50 plus vieilles lignes monopolise la fenêtre du drain,
  et plus **aucun** foyer n'avance. Le drain lit donc une page suivante quand une page
  entière a été différée sans rien publier (≤ 4 pages/tick) — condition qui est aussi le
  seul cas où l'`offset` reste exact. **Deux tours de constat négatif sur son propre
  correctif : c'est là qu'étaient les deux vrais défauts du lot.**

### Autres pièges que ce lot a payés

- ⚠️ **`LE-76` — un correctif posé à la création est un no-op sur tout ce qui existe
  déjà, et la CI ne peut pas le voir.** `jsm.consumers.add` était suivi d'un `catch {}`
  muet (« déjà présent, on le réutilise tel quel ») : ajouter `filter_subjects` aurait
  laissé les 7 durables de prod **intacts**, tandis qu'`e2e-stack` — qui part d'un
  `down -v` — les recrée avec le bon filtre et serait passé vert. Corrigé par
  `consumers.update` dans le `catch`. **C'est la ligne la plus load-bearing du lot, et
  rien dans le dépôt ne sait l'exercer** (`EM-17`). ⚠️ `consumers.update` de nats.js est
  un `Object.assign(config_en_place, demandé)` : un `filter_subject` **singulier** déjà
  posé survit et fait refuser la mise à jour (exclusivité serveur) — il est écrasé par la
  chaîne vide.
- ⚠️ **`LE-75` — l'exclusion qui rendait l'alerte lisible garantissait que le défaut ne
  sonnerait jamais.** `ConsumerRejetsDetectes{raison!="TYPE_INCONNU"}` était un choix
  **juste** ; personne n'avait écrit ce qu'il rendait invisible.
- ⚠️ **`EM-17` — aucun contrôle ne joue une pile dont l'état PRÉEXISTE** : `e2e-stack`
  part de bases vierges (`EM-16`) **et** de durables neufs. Le constat négatif du lot est
  donc **dérivé**, pas relevé.
- ⚠️ Le garde-fou « balayage à vide » a payé immédiatement : `relever-rebuts.mjs`
  cherchait `pgTable('dead_letter'` sur une seule ligne alors que les 4 schémas la
  déclarent sur deux — il n'a pas rendu « aucun rebut », il a **échoué**.
- ⚠️ Ratchet ESLint, 1 seul cran libre : `expect(objet.methode)` coûte un
  `unbound-method` (règle à sa borne). Garder l'espion en local (`const traiter =
vi.fn(); { traiter, … }`) au lieu de le relire sur l'objet.
- ⚠️ **Journée à 8 rouges de CI, tous des `HTTP 503` de GitHub** (baseline de couverture
  ×4 — le step meurt **avant** lint/test/build —, CodeQL ×4). Aucun n'a jugé le diff.

## Ce qui reste

- **`AM-99`** — un événement outbox durablement refusé est retenté toutes les 2 s **pour
  toujours** : l'isolation a retiré le blocage, pas le rejeu, et la table n'a ni compteur
  de tentatives ni colonne d'erreur. Seule l'alerte d'âge borne le silence.
- **`AM-98`** — la borne T3ter (préférences) reste sans durée, mais le motif a changé :
  ce n'est plus un défaut de code, c'est un arbitrage PO. La trace du désabonnement est
  **aussi la preuve** qu'on a cessé d'écrire à quelqu'un.
- **`EM-16`** — le harnais qui prouverait un back-fill sur des données.
- **`EM-17`** — le harnais qui jouerait une pile dont l'**état préexiste** (durable
  JetStream déjà créé, base déjà peuplée), et qui seul pourrait exercer
  `consumers.update`.
- Les deux arbitrages du lot 1 (`AM-88` purge T1, `AM-90` mensualité crèche) sont
  intacts.
