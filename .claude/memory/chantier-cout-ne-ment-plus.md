---
name: chantier-cout-ne-ment-plus
description: 'Chantier « Le coût ne ment plus » (validé PO 2026-08-16) — lot 1 (AM-55, AM-13) MERGÉ le 2026-08-17 (c1086f7), NON DÉPLOYÉ ; lot 2 (AM-58, AM-57) écrit le 2026-08-17, PR ouverte non mergée ; restent AM-88, AM-90 et AM-98, trois arbitrages PO'
metadata:
  node_type: memory
  type: project
---

# Chantier « Le coût ne ment plus »

Validé par le PO le **2026-08-16**. Il attaque une famille de défauts unique : le
calcul de coût **répond toujours**, y compris quand il n'a pas de quoi répondre.

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

## Lot 2 — envois bornés + consentement explicite (`AM-58`, `AM-57`) — PR OUVERTE

Même famille de défauts que le lot 1, **transposée aux notifications** : un état est
déduit d'une absence, et rien ne borne ce que l'absence autorise. **Écrit le
2026-08-17**, branche `feat/cout-lot2-envois-consentement`, PR verte non mergée.

### Le constat négatif a trouvé un troisième défaut, plus grave que l'énoncé

L'énoncé annonçait la borne temporelle. Reproduit avant d'écrire une ligne, il tenait —
un `POST` sur `2019-W01` sollicitait bien le mailer vers `jaudrey@cscpapin.asso.fr`. Mais
la même sonde a montré qu'un récap **sans aucun enfant concerné** partait tout autant, et
disait à la crèche « Aucune modification déclarée sur cette semaine ». C'est le défaut le
plus atteignable des deux : le front filtre (`concernes.length > 0`), donc la règle
_paraissait_ implémentée — personne ne l'avait écrite côté serveur (`LE-71`).

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

### Ce qui reste

- **`AM-98`** — la borne T3ter (préférences) reste sans durée, mais le motif a changé :
  ce n'est plus un défaut de code, c'est un arbitrage PO. La trace du désabonnement est
  **aussi la preuve** qu'on a cessé d'écrire à quelqu'un.
- **`EM-16`** — le harnais qui prouverait un back-fill sur des données.
- Les deux arbitrages du lot 1 (`AM-88` purge T1, `AM-90` mensualité crèche) sont
  intacts.
