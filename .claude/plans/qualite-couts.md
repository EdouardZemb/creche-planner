# Chantier qualité « Coûts » — plan d'exécution

> **Audit du 2026-07-10, priorisation validée par le PO le même jour.**
> Exécutant : Opus 4.8 (lot 5 délégable à Sonnet 5). Ce plan est auto-portant :
> chaque lot est une consigne autonome, exécutable sans accès à la conversation
> qui l'a produit. **1 lot = 1 PR** vers `main` (protégée : PR + check `ci`).

---

## 1. Contexte & objectif

La fonctionnalité « Coûts » couvre :

- **Front** : `apps/web/src/couts/` — `CoutsAnnuelsPage.tsx` (route
  `/foyers/:foyerId/couts`, onglet « Coûts » de la barre mobile),
  `PanneauCoutMois.tsx` (rendu dans `apps/web/src/planning/PlanningPage.tsx`,
  sticky à côté du calendrier), `export.ts` (CSV/print), `useCouts.ts` (hooks
  écrits mais **jamais branchés**), plus le bandeau `BandeauCoutMois` interne à
  `apps/web/src/dashboard/DashboardJourPage.tsx` (~l.188).
- **Gateway** : `apps/api-gateway/src/bff/couts.controller.ts`
  (`GET /api/v1/couts` et `/api/v1/couts/annuel`, protégés `@FoyerScope`),
  client `apps/api-gateway/src/clients/tarification.client.ts`.
- **Backend** : `apps/svc-tarification/` — `src/tarification/cout.service.ts`
  (orchestration lecture read-model + replis synchrones),
  `src/tarification/cout.mapper.ts` (adaptateur read-model → domaine),
  `src/consumers/projection.service.ts` (projection NATS idempotente),
  `src/database/schema.ts` + `src/database/migrations/` (dernière : `0001`).
- **Domaine pur** : `libs/tarification/domain/src/lib/` (`abcm/`, `psu/`,
  `consolidation/`, `core/`) — très testé (19 specs dont MBT), ne pas dégrader.

**Objectif du chantier** : faire passer les écrans de coûts de « prototype qui
marche » à « produit professionnel » — plus de scroll horizontal mobile, plus de
jargon machine, une simulation réellement atteignable, et surtout **plus jamais
de montant faux affiché avec assurance** (c'est de l'argent : un chiffre affiché
doit être un chiffre vrai).

## 2. Décisions validées par le PO (ne pas rediscuter)

1. **Périmètre** : les 5 lots de la priorisation (découpés ci-dessous en 6 PR,
   le lot 4 étant scindé en 4a/4b).
2. **Repli dégradé** : quand un repli synchrone échoue (foyer absent du read
   model + repli `svc-foyer` en échec, ou prestations d'un contrat
   injoignables), le service renvoie une **erreur explicite 503** — jamais un
   « foyer neutre » ni un total sous-estimé. Le front affiche « Service
   indisponible … Réessayer ».
3. **Projection `grille_tarifaire`** : hors périmètre. Elle reste écrite et
   jamais lue ; le calcul continue d'utiliser les grilles statiques du domaine
   (`GrilleAbcm.pour(tranche)`). Dette documentée (cf. §fin de plan) — ne pas la
   brancher ni la supprimer dans ce chantier.
4. **Première année ABCM** : **portée par le contrat** — nouveau champ explicite
   sur le contrat (svc-planification), propagé par événement, projeté et
   consommé par svc-tarification. Le hardcode `mois.startsWith('2026')` et le
   commentaire nominatif (« Zoé ») disparaissent.

## 3. Hypothèses assumées (défauts pris faute de contrainte exprimée)

- **Zéro nouvelle dépendance npm.** Tout se fait avec l'existant (tokens CSS,
  composants `apps/web/src/ui/`, libs internes).
- **Migrations additives uniquement.** Aucun `DROP`/`NOT NULL` rétroactif dans
  ce chantier (les promotions NOT NULL restent des sessions dédiées, comme
  `enfant_id`).
- Le champ « première inscription » est un **booléen par contrat ABCM**, saisi
  par le parent dans le formulaire de contrat ; l'année de rattachement est
  **dérivée de `valideDu`** (pas de champ date supplémentaire).
- La règle « frais fixes rattachés à septembre » (doc 02 §4.4, décision Q-06)
  est **conservée telle quelle**. Limitation connue et acceptée : un contrat
  ABCM démarrant après septembre (ex. octobre) ne déclenche pas de frais fixes
  cette année scolaire-là (aucune prestation ABCM en septembre ⇒ pas de bloc
  frais fixes). À documenter, pas à corriger ici.
- Le bandeau coût du dashboard (`BandeauCoutMois`) reste **silencieux en
  erreur** (choix documenté dans son commentaire — ne pas le « corriger »).
- Libellés tranchés dans les lots (colonnes « Simulé / Réel / Écart », section
  « Frais annuels — ABCM », etc.) : les utiliser tels quels.

## 4. Conventions & pièges transverses (valables pour TOUS les lots)

**Environnement / commandes**

- Toujours `corepack pnpm@10.34.2 …` (jamais le pnpm global 8.x). Exemples :
  `corepack pnpm@10.34.2 install`, `corepack pnpm@10.34.2 nx run-many -t lint typecheck test -p web`.
- **Travailler dans le clone principal**
  `C:\Users\edoua\Documents\Claude\Projects\Documents courtier\creche-planner-public`.
- Environnement de travail : `pnpm preflight` en début de session — cf.
  [CONTRIBUTING.md § Pièges](../../CONTRIBUTING.md), source unique sur la boucle de dev.

**Code**

- ESLint 9 flat config **type-aware strict** : `prefer-const`,
  `noUncheckedIndexedAccess` (indexer un tableau rend `T | undefined`),
  `readonly T[]` et non `ReadonlyArray<T>`, pas de cast silencieux.
- `verbatimModuleSyntax` **web uniquement** : `import type { … }` pour les
  types dans `apps/web`.
- Zod : dans du code **nouveau**, `z.uuid()` / `z.email()` (la règle
  `no-deprecated` refuse `z.string().uuid()`) ; dans un fichier existant,
  suivre le style du fichier sauf si le lint casse.
- Jamais de mode brut (« CRECHE_PSU ») à l'écran : passer par
  `libelleMode()` (`apps/web/src/utils/libelles.ts`) et `<Abbr>` +
  `estSigleConnu()` (`apps/web/src/utils/glossaire.ts`) pour les sigles.
- Montants : **centimes entiers** partout, conversion en euros uniquement à
  l'affichage via `centimesEnEuros()` (`apps/web/src/utils/money.ts`).
- Messages de commit : conventionnels, **≤ 100 caractères** par ligne
  (commitlint).

**Contrats & Pact**

- Fichiers pact générés dans `/pacts` — ce dossier est dans `.prettierignore`
  (ne pas l'en retirer, sinon lint-staged casse le job pact-drift).
- Piège « merge doublons » : si un pact régénéré contient des interactions en
  double, **supprimer le fichier pact et le régénérer à blanc** (relancer les
  specs consumer), ne jamais l'éditer à la main.
- Types du client web générés depuis
  `libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts` (source de vérité
  statique) par `corepack pnpm@10.34.2 nx run web:generate-types` →
  `apps/web/src/api/openapi-types.gen.ts` (COMMITÉ ; job CI
  `openapi-types-drift` exige un diff vide).

**Vérification UI locale** (lots front)

- Stack réelle : `docker compose` du repo + seed, puis arrêter le conteneur web
  et lancer Vite dev sur :4200 (procédure connue du repo).
- Tester au viewport **375 px** (et 320 px pour le tableau) — aucune barre de
  scroll horizontale ne doit apparaître sur la page.

**E2E stack**

- `apps/web/e2e/*.stack.e2e.spec.ts` tournent contre la stack docker via
  l'orchestrateur e2e-stack — **destructif** (`down -v`) : ne jamais le lancer
  contre un environnement dont on veut garder les données.

## 5. Vue d'ensemble & dépendances

| Lot | Titre                                            | Couche                                    | Modèle                   | Dépend de          |
| --- | ------------------------------------------------ | ----------------------------------------- | ------------------------ | ------------------ |
| 1   | Tableau annuel mobile-first + navigation d'année | Front                                     | Opus 4.8                 | —                  |
| 2   | Simulation atteignable + langage parent          | Front                                     | Opus 4.8                 | Lot 1 mergé        |
| 3   | Plus jamais de montant faux silencieux           | Back (tarification)                       | Opus 4.8                 | —                  |
| 4a  | Le contrat porte « première inscription ABCM »   | Contracts + planification + gateway + web | Opus 4.8                 | —                  |
| 4b  | Tarification consomme « première inscription »   | Back (tarification) + seed                | Opus 4.8                 | Lot 4a mergé       |
| 5   | Harmonisation technique `couts/*`                | Front                                     | **Sonnet 5 (délégable)** | Lots 1 et 2 mergés |

Les chaînes (1→2→5) et (3, 4a→4b) sont indépendantes et peuvent avancer en
parallèle. Ordre recommandé si séquentiel : 1, 2, 3, 4a, 4b, 5.

---

## Lot 1 — Tableau annuel mobile-first + navigation d'année

**Modèle d'exécution : Opus 4.8** (choix de layout et d'accessibilité).

### Objectif

Avant : sur un téléphone (375 px), le tableau des coûts annuels déborde
toujours (`min-width: 640px`) — le parent voit un tableau coupé et doit deviner
qu'il faut glisser. Changer d'année passe par un `input type="number"` à
spinners minuscules.
Après : **aucun scroll horizontal**, quelle que soit la vue ; l'année se change
d'un tap sur ◀ / ▶ (cibles ≥ 44 px) et se partage par URL (`?annee=`).

### Périmètre exact

- `apps/web/src/couts/CoutsAnnuelsPage.tsx`
- `apps/web/src/couts/CoutsAnnuelsPage.test.tsx`
- `apps/web/src/styles.css` (blocs `.table-couts-wrap`, nouvelles classes)
- `apps/web/e2e/couts.stack.e2e.spec.ts` (adaptation au nouveau sélecteur)

**Hors périmètre** : `PanneauCoutMois.tsx`, `export.ts`, tout renommage de
libellé (lot 2), tout backend.

### Décisions déjà prises

1. **Sélecteur d'année** : remplacer l'`input type="number"` par
   `[◀] 2026 [▶]` — deux `<button type="button" className="btn secondaire">`
   avec `aria-label="Année précédente"` / `aria-label="Année suivante"`,
   l'année courante affichée entre les deux (élément avec `aria-live="polite"`
   pour annoncer le changement). Bornes : 2020–2099 (boutons `disabled` aux
   bornes). Cibles tactiles ≥ 44 px (les `.btn` du repo le sont déjà).
2. **L'année vit dans l'URL** : `?annee=YYYY` via `useSearchParams` (même
   pattern que `?simule` déjà lu par la page, et que `setParam` de
   `PlanningPage.tsx` ~l.80 — recopier ce petit helper localement, ne pas
   l'importer de PlanningPage). Défaut si absent/invalide : année courante.
   Remplacer le `useState` local `annee`.
3. **Vue normale (non simulée, 2 colonnes « Mois | Total »)** : table fluide —
   supprimer le `min-width: 640px` pour ce cas ; la table tient à 320 px
   (`width: 100%`, montants `white-space: nowrap`, alignés à droite).
4. **Vue simulation (4 colonnes)** : à partir de `768px` (breakpoint existant
   du repo), la table 4 colonnes actuelle ; **sous 768 px, une liste de cartes
   par mois** (une `<div className="carte">` par mois : nom du mois en titre,
   puis 3 lignes libellées Simulé / Réel / Écart). Implémentation : deux
   rendus distincts alimentés par la même fonction `construireLignes()`
   existante — la table reçoit la classe `table-couts-desktop`, la liste
   `liste-couts-mobile` ; CSS : `.liste-couts-mobile { display: block }` +
   `.table-couts-desktop { display: none }` sous 768 px, l'inverse au-dessus.
   (Pas de « table CSS display:block » bidouillée : deux structures propres,
   c'est plus accessible.)
   NB : au moment du lot 1, la vue simulation n'est atteignable que par URL
   (`?simule=true`) — la rendre correcte quand même, le lot 2 l'expose.
5. **Supprimer** le bloc CSS `.table-couts-wrap table { min-width: 640px; }` et
   l'`overflow-x` associé devient inutile pour la vue normale (le garder ne
   nuit pas, mais l'objectif d'acceptation est « aucun scroll horizontal »).
6. La ligne « Total annuel » (tfoot) existe aussi en carte de synthèse dans la
   liste mobile (dernière carte, visuellement distincte : `fontWeight` via une
   classe, pas de style inline nouveau).

### Conventions à respecter

- Réutiliser `Badge`, `Spinner`, `EtatVide` existants ; classes CSS plutôt que
  nouveaux styles inline (le lot 5 nettoiera l'existant, ne pas en rajouter).
- `useTitrePage`, structure d'états loading/error/vide : conserver.
- Tests unitaires : suivre le style de `CoutsAnnuelsPage.test.tsx` (MemoryRouter
  avec `initialEntries` incluant la query string).

### Critères d'acceptation

- [ ] À 320 px et 375 px, ni la vue normale ni la vue `?simule=true` ne
      provoquent de scroll horizontal (vérifié dans le navigateur, pas
      seulement en tests jsdom).
- [ ] `?annee=2027` à l'ouverture affiche 2027 ; ◀/▶ mettent à jour l'URL ;
      recharger la page conserve l'année ; année invalide (`?annee=abc`) →
      année courante sans crash.
- [ ] Boutons ◀/▶ accessibles (aria-labels ci-dessus), désactivés aux bornes
      2020/2099.
- [ ] En vue simulation < 768 px : une carte par mois avec Simulé/Réel/Écart
      (libellés actuels « Total simulé »/« Total réel »/« Delta » CONSERVÉS
      dans ce lot — le renommage est le lot 2) + carte « Total annuel ».
- [ ] `corepack pnpm@10.34.2 nx run-many -t lint typecheck test -p web` vert.
- [ ] `apps/web/e2e/couts.stack.e2e.spec.ts` adapté et vert.

### Comment vérifier

1. `corepack pnpm@10.34.2 nx run-many -t lint typecheck test -p web`
2. Vérif UI locale (stack + seed + Vite :4200, cf. §4) : ouvrir
   `/foyers/<id>/couts`, DevTools 375 px puis 320 px, vue normale et
   `?simule=true` — zéro scroll horizontal ; naviguer avec ◀/▶.
3. E2E : le job CI `e2e-stack` doit passer (ou run local de
   `couts.stack.e2e.spec.ts` via l'orchestrateur — destructif, cf. §4).

### Pièges connus

- **`couts.stack.e2e.spec.ts` utilise `page.getByLabel('Année :')` +
  `fill('2026')` (l.63–67)** : ce sélecteur disparaît. Remplacer par une
  navigation directe `await page.goto(`${urlCouts(foyerId)}?annee=2026`)` —
  robuste et indépendant de l'horloge. Ne PAS supposer que l'année courante du
  runner est 2026.
- Le même spec dépend des rôles ARIA du tableau (`rowheader`, `cell`) : la vue
  normale reste une vraie `<table>` (ne pas la transformer en cartes — seules
  les 4 colonnes de la simulation passent en cartes sous 768 px).
- iOS zoome au focus d'un champ < 16px — plus d'input ici, mais garder les
  textes des boutons ≥ 16px.
- Ne pas casser l'impression : `@media print` masque `.actions-export` et les
  `button` ; la table desktop doit rester la vue imprimée (forcer
  `.table-couts-desktop { display: table }` et masquer `.liste-couts-mobile`
  dans le bloc `@media print` de `styles.css`).

---

## Lot 2 — Simulation atteignable + langage parent

**Modèle d'exécution : Opus 4.8** (libellés vus par le parent + état vide).

### Objectif

Avant : la vue simulation annuelle est **inatteignable** (aucun lien dans
l'app ne pointe vers `?simule=true` ; tout l'appareil Delta/CSV simulé est une
feature morte) ; la colonne s'appelle « Delta » (jargon), le badge crie
« SIMULATION » ; en septembre le panneau du mois affiche littéralement
« — FRAIS_FIXES_ABCM » ; un nouveau foyer voit douze lignes de 0,00 €.
Après : un interrupteur « Mode simulation » sur la page Coûts (identique à
celui du Planning), des mots de parent partout, et un état vide qui oriente.

### Périmètre exact

- `apps/web/src/couts/CoutsAnnuelsPage.tsx` (+ test)
- `apps/web/src/couts/PanneauCoutMois.tsx` (+ test)
- `apps/web/src/couts/export.ts` (+ `export.test.ts`)
- `apps/web/src/utils/libelles.ts` (+ test si existant)
- `apps/web/e2e/couts.stack.e2e.spec.ts` (si un libellé asserté change)

**Hors périmètre** : backend, `PlanningPage.tsx` (son toggle existe déjà et ne
bouge pas), le hook `useCouts.ts` (lot 5).

### Décisions déjà prises

1. **Interrupteur simulation sur la page Coûts** : même UI que
   `PlanningPage.tsx` (~l.216–236) — `<label><input type="checkbox" …/> Mode
simulation</label>`, lié au query param `simule` (`'true'`/absent) via le
   helper `setParam` local introduit au lot 1. Badge à côté quand actif.
2. **Renommages (exhaustifs, aucun autre)** :
   - Colonne/entête « Delta » → **« Écart »** (table desktop, cartes mobiles,
     entête CSV `coutAnnuelVersCsv` l.104, tfoot).
   - « Total simulé » → **« Simulé »**, « Total réel » → **« Réel »** (table +
     cartes + CSV). La ligne « Total annuel » garde son nom.
   - Badge de la page annuelle : `SIMULATION` → **`Simulation`** (aligné sur le
     panneau du mois qui dit déjà « Simulation »).
   - Sous l'interrupteur actif, une ligne d'aide `className="muted"` :
     **« Comparez le coût du planning simulé au planning réel. »**
   - Les tirets « — » (réel indisponible) reçoivent
     `title="Pas encore de planning réel pour ce mois"` et un `sr-only`
     équivalent.
3. **Libellé des frais fixes** : dans `PanneauCoutMois.tsx`,
   `SectionPrestation` gère le cas `prestation.mode === 'FRAIS_FIXES_ABCM'` :
   titre de section **« Frais annuels — ABCM »** (avec `<Abbr sigle="ABCM" />`
   — le sigle est déjà dans `glossaire.ts` l.10), **sans** prénom ni tiret
   (le backend émet `enfant: ''` pour cette pseudo-prestation). Ne PAS ajouter
   `FRAIS_FIXES_ABCM` à `LIBELLES_MODE` (typé `Record<Mode, string>` et
   `FRAIS_FIXES_ABCM` n'est pas un `Mode`) : créer dans `libelles.ts` un helper
   `titrePrestationCout(enfant: string, mode: string): string` qui encapsule
   les deux cas, exporté et testé. Répercuter dans le CSV mensuel
   (`coutMoisVersCsv` : colonne Mode = « Frais annuels » pour ce cas).
4. **État vide nouveau foyer** (page annuelle) : si
   `data.mois.every((m) => m.prestations.length === 0) && data.totalCentimes === 0`,
   remplacer le tableau par `<EtatVide titre="Aucun coût en {annee}"
description="Les coûts apparaîtront dès qu'un contrat existe et qu'un
planning est saisi." actions={[{ libelle: 'Voir les contrats', href:
`/foyers/${id}/contrats`, primaire: true }]} />`. Le sélecteur d'année et
   l'interrupteur restent visibles au-dessus (on peut changer d'année depuis
   l'état vide). Les boutons Export/Imprimer sont masqués dans ce cas.
5. Le lien « Voir le détail du planning » de la barre d'actions **transporte
   le mode simulation** : `to={simule ? `/foyers/${id}/planning?simule=true` :
   `/foyers/${id}/planning`}` (cohérence aller-retour ; PlanningPage lit déjà
   `?simule`).

### Conventions à respecter

- `EtatVide` (`apps/web/src/ui/EtatVide.tsx`) pour l'état vide — ne pas
  réinventer.
- `Abbr`/`estSigleConnu` pour les sigles ; jamais de code brut à l'écran.
- Tests : mettre à jour `CoutsAnnuelsPage.test.tsx`, `PanneauCoutMois.test.tsx`
  et `export.test.ts` pour chaque libellé renommé (chercher les anciennes
  chaînes : `Delta`, `Total simulé`, `Total réel`, `SIMULATION`).

### Critères d'acceptation

- [ ] Depuis l'onglet « Coûts », cocher « Mode simulation » ajoute
      `?simule=true`, affiche les colonnes Simulé/Réel/Écart et le badge
      « Simulation » ; décocher revient à la vue normale ; l'état survit au
      rechargement (URL).
- [ ] Plus aucune occurrence à l'écran de « Delta », « SIMULATION » (capitales),
      « FRAIS_FIXES_ABCM » (grep dans `apps/web/src` : les seules occurrences
      restantes de `FRAIS_FIXES_ABCM` sont la comparaison technique dans le
      helper + tests).
- [ ] CSV annuel simulé : entête `Mois;Simulé;Réel;Écart` ; CSV mensuel de
      septembre : la ligne frais fixes dit « Frais annuels », pas le code brut.
- [ ] Foyer sans aucune prestation sur l'année → état vide avec CTA « Voir les
      contrats » ; foyer avec prestations → tableau normal (aucune régression).
- [ ] `corepack pnpm@10.34.2 nx run-many -t lint typecheck test -p web` vert ;
      e2e stack vert.

### Comment vérifier

1. Tests + typecheck + lint web (commande ci-dessus).
2. Vérif UI locale : `/foyers/<id>/couts` → cocher/décocher l'interrupteur,
   vérifier l'URL, exporter le CSV et l'ouvrir ; naviguer vers un foyer/une
   année sans données pour voir l'état vide ; ouvrir le Planning en septembre
   2026 (`?mois=2026-09`) et vérifier la section « Frais annuels — ABCM » dans
   le panneau (le seed porte cantine+péri dès sept. 2026, cf. doc 14).
3. `grep -rn "Delta\|SIMULATION\|FRAIS_FIXES_ABCM" apps/web/src` — ne doivent
   rester que le helper et ses tests.

### Pièges connus

- Le libellé « Delta » n'apparaît **pas** dans `couts.stack.e2e.spec.ts`
  (il n'asserte que des montants), mais vérifier par grep dans `apps/web/e2e`
  avant de conclure.
- `utils/money.ts` (`repereDelta`, `deltaEnEuros`, type `SensDelta`) : **ne pas
  renommer les identifiants de code** (API interne) — seuls les libellés
  affichés changent. Les libellés accessibles de `repereDelta`
  (« économie »/« dépassement »/« identique ») sont déjà du langage parent :
  conserver.
- `Mode` (type) vient de `types/bff.ts` (généré) : ne pas l'étendre.

---

## Lot 3 — Plus jamais de montant faux silencieux

**Modèle d'exécution : Opus 4.8** (sémantique d'erreur backend).

### Objectif

Avant : dans `apps/svc-tarification/src/tarification/cout.service.ts`, deux
dégradations silencieuses. (a) `chargerFoyer()` (l.242–271) : foyer absent du
read model **et** repli `svc-foyer` en échec → « foyer neutre » (ressources 0,
tranche T3) → la crèche s'affiche à **0,00 €** sans signal. (b)
`assemblerPrestations()` (l.338–389) : repli `svc-planification` en échec pour
un contrat → contrat **omis** → total sous-estimé silencieusement.
Après : dans ces deux cas le service répond **503** avec un message
diagnostique ; la gateway propage (503) ; le front affiche « Service
indisponible, réessayez dans un instant. » avec « Réessayer » — et le client
web rejoue d'abord automatiquement la requête (retry borné existant sur
502/503/504).

### Périmètre exact

- `apps/svc-tarification/src/tarification/cout.service.ts`
- Nouveau : `apps/svc-tarification/src/tarification/cout.service.spec.ts`
- (Rien d'autre : gateway `relais.ts` propage déjà le code amont via
  `Error('HTTP 503')` → `HttpException(503)` ; le front traduit déjà tout 5xx
  en « Service indisponible » dans `apps/web/src/utils/erreurs.ts` l.8, et la
  page annuelle a déjà son bouton « Réessayer ». Le « Réessayer » manquant du
  panneau du mois est traité au lot 5.)

**Hors périmètre** : `fallback/*.client.ts` (les clients résilients
timeout/retry/circuit-breaker sont bons — ne pas les toucher),
`projection.service.ts`, le front.

### Décisions déjà prises

1. `chargerFoyer()` : si read model vide ET `foyerClient.foyer()` renvoie
   `null` → `throw new ServiceUnavailableException(
'foyer <id> indisponible : read model froid et repli svc-foyer en échec')`
   (import depuis `@nestjs/common`). **Supprimer** le retour « foyer neutre »
   (`{ ressourcesMensuellesCentimes: 0, nbEnfantsACharge: 1, tranche: 3 }`).
   Le `logger.warn` du repli devient `logger.error` quand le repli échoue
   (avec le `foyerId`).
2. `assemblerPrestations()` : `planificationClient.prestations()` renvoie
   `null` = **échec** (réseau/CB) → `throw new ServiceUnavailableException(
'prestations du contrat <id> (<mois>) indisponibles : read model froid et
repli svc-planification en échec')`. **Distinction cruciale** : un repli qui
   RÉUSSIT avec `prestations: []` (contrat sans prestation ce mois) reste une
   omission **légitime** — pas d'erreur, comportement inchangé. Le bloc « cas
   limite : projections pour contrats inconnus » (l.376–388) reste inchangé.
3. Le calcul annuel (12 mois en parallèle) laisse l'exception remonter : une
   année dont un seul mois est incalculable répond 503 en bloc (pas de mois
   « troués » silencieux). La coalescence `annuelEnVol` gère déjà l'échec
   (`.finally` purge la clé) — vérifier qu'une promesse rejetée n'est pas
   servie aux appels suivants (c'est le cas : elle est retirée de la map).
4. Ne PAS toucher aux vues (`CoutMoisVue` etc.) : pas de champ `degrade`, pas
   de changement de contrat OpenAPI/Pact.

### Conventions à respecter

- Style de service NestJS du repo (exceptions Nest levées depuis le service,
  comme les `BadRequestException` du contrôleur voisin).
- Tests : s'inspirer des specs existantes du service
  (`projection.service.spec.ts` pour le style de stub de `db`, ou
  `projection.integration.spec.ts` pour le harnais d'intégration —
  choisir le niveau qui permet d'exercer `coutMois` avec un read model vide et
  des clients mockés). Les clients `FoyerClient`/`PlanificationClient` se
  mockent par simple objet (`{ foyer: async () => null }` etc.).

### Critères d'acceptation

- [ ] Foyer absent du read model + repli KO → `coutMois` et `coutAnnuel`
      rejettent en 503 (test unitaire).
- [ ] Foyer absent + repli OK → calcul normal (non-régression, test).
- [ ] Contrat sans projection + repli KO → 503 ; contrat sans projection +
      repli OK vide → mois calculé sans ce contrat (deux tests).
- [ ] Plus aucun « foyer neutre » dans le code (`grep -n "tranche: 3"
apps/svc-tarification/src` ne matche plus dans cout.service.ts).
- [ ] `corepack pnpm@10.34.2 nx run-many -t lint typecheck test -p svc-tarification`
      vert ; specs pact provider (`tarification.provider.pact.spec.ts`)
      inchangées et vertes ; `can-i-deploy` non impacté (aucun contrat modifié).
- [ ] E2E stack vert (stack saine = jamais 503 : aucun impact attendu).

### Comment vérifier

1. `corepack pnpm@10.34.2 nx run-many -t lint typecheck test -p svc-tarification`
2. Preuve bout-en-bout du chemin d'erreur (stack locale) : stack docker
   démarrée, arrêter `svc-foyer` ET vider/renommer la ligne du foyer dans la
   table `foyer` de la base tarification (ou utiliser un foyerId inexistant
   possédé — plus simple : couper svc-planification et demander un mois sans
   projection) → `GET /api/v1/couts?...` répond 503 et l'UI affiche « Service
   indisponible … Réessayer ». Remettre le service → « Réessayer » réussit.
3. CI complète verte.

### Pièges connus

- Le retry client (`requeteIdempotente`, mémoire du repo) rejoue les 503 : un
  503 **transitoire** est absorbé sans que le parent le voie — c'est voulu.
- Ne pas transformer l'erreur Zod de `parsePrestationRm` (donnée corrompue =
  bug amont, doit rester une 500 explicite) en 503 : seuls les échecs de
  **repli** deviennent 503.
- `apps/api-gateway/src/e2e/parcours.e2e.spec.ts` exerce les coûts : vérifier
  qu'il ne dépend pas du comportement « foyer neutre » (au besoin adapter le
  seed du spec pour projeter le foyer avant de lire les coûts).

---

## Lot 4a — Le contrat porte « première inscription ABCM »

**Modèle d'exécution : Opus 4.8** (contrat inter-services + formulaire parent).

### Objectif

Côté système : le contrat (svc-planification) porte un booléen explicite
`premiereInscription` (« c'est la première année d'inscription de cet enfant à
l'association ») saisi par le parent, persisté, exposé par l'API et propagé
dans les événements `ContratCree`/`ContratModifie`. Côté parent : une case à
cocher claire dans le formulaire de contrat ABCM. (La consommation tarifaire
est le lot 4b — après ce lot, le champ voyage mais ne change encore aucun
montant.)

### Périmètre exact

1. **Contrats** : `libs/contracts/planification/src/lib/events/planification-events.ts`
   — ajouter à `contratCreePayloadSchema` ET `contratModifiePayloadSchema` :
   ```ts
   /**
    * Première année d'inscription de l'enfant à l'association ABCM (frais de
    * 1ʳᵉ inscription, doc 02 §4.4). Champ additif et OPTIONNEL dans la v1
    * (même évolution non rupteur que `enfantId`/`etablissementId`) ; absent ou
    * `null` ⇒ `false`. Toujours `false` pour un contrat CRECHE_PSU.
    */
   premiereInscription: z.boolean().nullish(),
   ```
   (pas de bump de version : additif optionnel, précédents `enfantId` #167 et
   `etablissementId` P2).
2. **svc-planification** :
   - `src/database/schema.ts` : colonne sur `contrat` —
     `premiereInscription: boolean('premiere_inscription').notNull().default(false)`.
   - Nouvelle migration `src/database/migrations/0006_contrat_premiere_inscription.sql`
     (générée par drizzle-kit, ADDITIVE :
     `ALTER TABLE contrat ADD COLUMN premiere_inscription boolean NOT NULL DEFAULT false;`).
   - `src/planification/planification.dto.ts` : ajouter
     `premiereInscription: z.boolean().optional()` au payload de création **ABCM
     uniquement** (~l.88–94) et à son équivalent de mise à jour ; le payload
     crèche (~l.74) ne l'a pas (défaut `false` en base).
   - `src/planification/planification.service.ts` : persister le champ à la
     création/édition et l'inclure dans **tous** les payloads
     `ContratCree`/`ContratModifie` insérés dans l'outbox — y compris la
     **ré-émission** de `ContratModifie` par la projection
     (`src/consumers/projection.service.ts`, feature enfantId #167 : quand un
     enfant est renommé, un `ContratModifie` est ré-émis — il doit porter le
     champ). Faire un grep `outbox` dans les deux fichiers pour n'oublier
     aucun point d'émission.
   - Réponses API de lecture des contrats (DTO de sortie) : exposer
     `premiereInscription: boolean`.
3. **Gateway** :
   - `libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts` : ajouter la
     propriété `premiereInscription: { type: 'boolean' }` au schéma du contrat
     (corps de création/édition ABCM : optionnelle, NON requise ; réponse de
     lecture : présente). S'inspirer des occurrences `valideDu` (l.226, l.1171)
     pour localiser les schémas.
   - `apps/api-gateway/src/bff/contrats.controller.ts` + `bff.dto.ts` : relayer
     le champ (validation permissive existante — suivre le pattern du champ
     `etablissementId`).
   - `apps/api-gateway/src/clients/planification.client.ts` : types de
     requête/réponse.
   - Pact consumer `apps/api-gateway/src/contract/planification.consumer.pact.spec.ts` :
     étendre les interactions POST/PUT contrat ABCM et GET contrats avec le
     champ ; régénérer les pacts **à blanc** (supprimer le fichier pact puis
     relancer les specs).
   - Vérification provider côté svc-planification (spec provider pact du
     service) : doit passer avec le nouveau champ.
4. **Web** :
   - `corepack pnpm@10.34.2 nx run web:generate-types` → commit de
     `apps/web/src/api/openapi-types.gen.ts`.
   - `apps/web/src/foyer/ContratForm.tsx` : dans la section ABCM (composant
     `AbcmEditor`, ~l.158, ou juste au-dessus dans le formulaire selon la
     structure), une case à cocher. **Libellé exact** :
     `Première inscription de l'enfant à l'association` avec en dessous une
     ligne `muted` : `Ajoute les frais de première inscription (150 €) au mois
de septembre de la première année.` Visible pour les modes CANTINE /
     PERISCOLAIRE / ALSH uniquement (jamais pour CRECHE_PSU). Pré-cochée à
     l'édition si le contrat lu porte `premiereInscription: true`.
   - `apps/web/src/api/client.ts` : transporter le champ dans les
     appels de création/édition de contrat.
   - Tests `ContratForm.test.tsx` : coche → payload envoyé avec
     `premiereInscription: true` ; absence de la case en mode crèche.

**Hors périmètre** : svc-tarification (lot 4b), tout calcul de montant, seed.

### Décisions déjà prises

- Nom du champ partout : `premiereInscription` (colonne
  `premiere_inscription`).
- Sémantique : « première année d'inscription de l'enfant à l'association » —
  au niveau du **contrat** ; l'année de rattachement sera dérivée de
  `valideDu` (lot 4b). Pas de champ date dédié.
- Défaut `false` partout (base, DTO, événements absents/nullish).
- Pas de nouvelle version d'événement (additif optionnel).
- Un contrat crèche ne porte jamais `true` (le DTO crèche n'expose pas le
  champ ; la base garde le défaut `false`).

### Conventions à respecter

- Suivre pas à pas le précédent **`enfantId` (PR #167)** — même feature
  « champ additif de contrat propagé » ; ses pièges documentés : frontière
  ESLint `boundaries` entre libs, Zod strict, ratchet de couverture (ne pas
  faire baisser la couverture des fichiers touchés).
- Migrations : drizzle-kit, numérotation séquentielle (`0006_…`), SQL committé
  dans `src/database/migrations/`.
- Pact : régénération à blanc, `/pacts` intouchable par prettier (cf. §4).

### Critères d'acceptation

- [ ] Créer un contrat ABCM avec la case cochée → ligne en base avec
      `premiere_inscription = true` → événement `ContratCree` dans l'outbox
      avec `premiereInscription: true` (test service planification).
- [ ] Éditer le contrat (case décochée) → `ContratModifie` avec `false`.
- [ ] Un événement historique SANS le champ est toujours décodé par les
      consommateurs existants (schémas `nullish` — test contrats lib).
- [ ] Formulaire : case visible et fonctionnelle pour cantine/péri/ALSH,
      absente pour crèche ; état pré-rempli à l'édition.
- [ ] `corepack pnpm@10.34.2 nx run-many -t lint typecheck test -p
contracts-planification svc-planification api-gateway web` vert ;
      pacts régénérés propres ; `can-i-deploy` vert (champ optionnel = compat) ;
      job `openapi-types-drift` vert (types regénérés commités).
- [ ] E2E stack vert (les parcours contrats existants ne cochent pas la case :
      aucun montant ne change).

### Comment vérifier

1. Commande run-many ci-dessus + CI complète.
2. Vérif UI locale : créer un contrat cantine avec la case cochée, rouvrir en
   édition → la case est cochée ; vérifier en base
   (`docker exec … psql`) `premiere_inscription`.
3. Pact : specs consumer gateway + provider planification vertes localement.

### Pièges connus

- **Tous les points d'émission** : `planification.service.ts` insère dans
  l'outbox à ~7 endroits (grep `tx.insert(outbox)`), et
  `consumers/projection.service.ts` ré-émet `ContratModifie` (renommage
  d'enfant). En oublier un = champ qui « clignote » au gré des événements.
- La projection **notifications** consomme aussi `ContratCree/Modifie`
  (svc-notifications) : le champ est nullish, elle l'ignore sans casser — ne
  rien changer chez elle, mais lancer aussi ses tests
  (`-p svc-notifications`) pour s'en assurer.
- UUID Zod strict (piège #167) : les schémas d'événements valident des UUID v4
  stricts — ne pas toucher aux champs existants.
- `openapi-types.gen.ts` est généré : ne JAMAIS l'éditer à la main.

---

## Lot 4b — Tarification consomme « première inscription »

**Modèle d'exécution : Opus 4.8** (règle de domaine + projection).
**Dépend du lot 4a mergé.**

### Objectif

Avant : `apps/svc-tarification/src/tarification/cout.service.ts` décide de la
« première année ABCM » par `mois.startsWith('2026')` (l.404–410) avec un
commentaire nominatif — toute famille ABCM est « première année » en 2026,
aucune ne l'est ensuite. Après : la première année découle des contrats du
foyer (`premiereInscription` + année scolaire de `valideDu`), pour tout foyer
et toute année ; les données personnelles disparaissent du code.

### Périmètre exact

- `libs/tarification/domain/src/lib/abcm/` — nouveau module pur
  `premiere-annee-abcm.ts` (+ spec) exporté par l'index de la lib.
- `apps/svc-tarification/src/database/schema.ts` — colonnes sur `contrat` :
  `premiereInscription: boolean('premiere_inscription').notNull().default(false)`
  et `valideDu: varchar('valide_du', { length: 10 })` (nullable — les
  contrats projetés avant ce lot n'ont pas la date).
- Nouvelle migration `apps/svc-tarification/src/database/migrations/0002_contrat_premiere_inscription.sql`
  (ADDITIVE : deux `ADD COLUMN`).
- `apps/svc-tarification/src/consumers/projection.service.ts` —
  `appliquerContratCree`/`appliquerContratModifie` projettent
  `premiereInscription` (`payload.premiereInscription ?? false`) et
  `valideDu` (déjà présents dans les payloads v1 : `valideDu` y a toujours
  été, il était simplement ignoré).
- `apps/svc-tarification/src/tarification/cout.service.ts` — remplacer
  `estPremiereAnneeAbcm` ; supprimer le hardcode et le commentaire nominatif.
- Tests : `projection.service.spec.ts` / `projection.integration.spec.ts`
  (nouveaux champs projetés), spec du nouveau module domaine, tests du service
  (créé au lot 3).
- Seed e2e/stack : le script de peuplement (chercher dans `scripts/` le seed
  qui crée les contrats ABCM ; l'oracle est `seed-oracle.json`) doit créer les
  contrats cantine/périscolaire avec `premiereInscription: true` pour
  **préserver l'oracle** de doc 14 : septembre 2026 = prestations + **436 €**
  de frais fixes (286 cotisation + 150 première inscription).

**Hors périmètre** : `FraisFixesAbcm` (la stratégie domaine existante ne change
pas — elle reçoit toujours `premiereAnnee: boolean`), le rattachement à
septembre (règle Q-06 conservée), la projection `grille_tarifaire`.

### Décisions déjà prises

1. **Règle** (module domaine pur, nouveau fichier
   `libs/tarification/domain/src/lib/abcm/premiere-annee-abcm.ts`) :
   ```
   estPremiereAnneeAbcm(mois, contrats) :
     - mois : ISO 'YYYY-MM' (appelé uniquement pour septembre, mais la
       fonction est totale) ;
     - contrats : ReadonlyArray<{ modeAbcm: boolean;
       premiereInscription: boolean; valideDu: string | null }> ;
     - anneeScolaireDe(dateIso) = mois(date) >= 9 ? annee(date) : annee(date) - 1 ;
     - renvoie true ssi ∃ contrat avec modeAbcm && premiereInscription &&
       valideDu != null && anneeScolaireDe(valideDu) === annee(mois).
   ```
   (Pour un mois de septembre `YYYY-09`, l'année scolaire est `YYYY` ; un
   contrat « première inscription » démarrant en `YYYY-09..YYYY-12` ou
   `YYYY+1-01..YYYY+1-08` appartient à l'année scolaire `YYYY`.)
   Spec exhaustive : contrat sept. → true la bonne année et false l'année
   suivante ; contrat janvier (année scolaire précédente) ; aucun contrat
   marqué → false ; valideDu null → ignoré ; contrat crèche marqué (cas
   impossible mais défensif) → ignoré via `modeAbcm: false`.
2. `cout.service.ts` : `calculerCoutMois` a déjà les `contrats` chargés —
   construire l'entrée du domaine avec
   `modeAbcm: MODES_ABCM.has(c.mode)` et appeler le module domaine. Supprimer
   la méthode privée `estPremiereAnneeAbcm` et son commentaire ; la constante
   `MOIS_FRAIS_FIXES = 9` et `estMoisFraisFixes` restent.
3. La condition d'existence du bloc frais fixes reste `auMoinsUnAbcm`
   (présence d'une prestation ABCM dans le mois) — inchangée.
4. **Données prod existantes** : après déploiement, le PO coche la case sur
   les contrats ABCM existants via l'écran Contrats (2 taps, lot 4a) — AUCUN
   script de back-fill. Le noter dans la description de la PR : « action PO
   post-deploy : cocher “Première inscription” sur les contrats ABCM 2026 ».
   D'ici là, septembre 2026 en prod affichera 286 € au lieu de 436 € — assumé
   (fenêtre courte, prod pas encore en septembre).
5. La projection d'un événement **sans** le champ (`premiereInscription`
   nullish, contrat historique) projette `false` et un `valideDu` s'il est
   présent dans le payload (il l'est depuis toujours dans la v1).

### Conventions à respecter

- Le domaine reste **pur** (pas d'accès base/réseau, pas de type Drizzle dans
  la lib) — le service mappe `ContratRow` → entrée du domaine.
- Style de specs du domaine : suivre `frais-fixes-abcm.spec.ts` (et ajouter un
  `.mbt.spec.ts` n'est PAS requis — les MBT existants couvrent les stratégies,
  pas ce prédicat).
- Idempotence projection : les upserts `onConflictDoUpdate` existants couvrent
  les nouveaux champs (les ajouter au `set`).

### Critères d'acceptation

- [ ] Le hardcode a disparu :
      `grep -rn "2026\|Zoé" apps/svc-tarification/src/tarification/` ne
      renvoie plus rien (hors specs éventuelles avec des dates de test).
- [ ] Domaine : spec du module `premiere-annee-abcm` verte (cas listés en
      décision 1).
- [ ] Projection : un `ContratCree` avec `premiereInscription: true` +
      `valideDu` alimente les colonnes ; un événement sans le champ projette
      `false` ; rejeu idempotent (tests projection).
- [ ] Bout-en-bout stack : foyer seedé (contrats ABCM `premiereInscription:
true`, `valideDu` 2026-09) → `GET /api/v1/couts?mois=2026-09` contient
      les lignes « Cotisation annuelle ABCM » (286 €) ET « Frais de 1ère
      inscription » (150 €) ; `mois=2027-09` (même contrat toujours actif) →
      cotisation seule.
- [ ] `corepack pnpm@10.34.2 nx run-many -t lint typecheck test -p
tarification-domain svc-tarification` vert ; pact provider tarification
      vert (les vues ne changent pas) ; e2e stack vert avec le seed mis à jour.

### Comment vérifier

1. Commande run-many ci-dessus.
2. Migration : démarrer la stack docker (les migrations s'appliquent au boot du
   service) et vérifier
   `docker exec <pg-tarification> psql … -c "\d contrat"` → colonnes
   `premiere_inscription` / `valide_du`.
3. Le bout-en-bout du critère 4 via curl/HTTPie sur la stack seedée (ou via
   l'UI : Planning `?mois=2026-09`, panneau « Frais annuels — ABCM » du lot 2).
4. CI complète (dont `e2e-stack`).

### Pièges connus

- **L'oracle du seed** : doc 14 attend 436 € en septembre 2026. Si le seed ne
  coche pas `premiereInscription`, tout test/smoke qui compare septembre à
  l'oracle échouera à 286 €. Mettre à jour le seed ET vérifier
  `seed-oracle.json` (grep `436` / `frais` dans `scripts/` et `docs/14*`).
- Les événements consommés peuvent être ANTÉRIEURS au lot 4a (payload sans le
  champ) : le schéma Zod v1 est `nullish`, le `?? false` est obligatoire.
- Ordre des événements : `PlanningModifie` peut arriver avant `ContratCree`
  (déjà géré par NAK) — aucun nouveau cas à traiter.
- Ne pas oublier d'ajouter les nouveaux champs au `set` des
  `onConflictDoUpdate` de `appliquerContratCree` ET `appliquerContratModifie`
  (sinon un rejeu/une mise à jour écrase-ou-fige mal les valeurs).

---

## Lot 5 — Harmonisation technique `couts/*`

**Modèle d'exécution : délégable à Sonnet 5** (mécanique, décisions toutes
prises). **Dépend des lots 1 et 2 mergés** (pour ne pas se marcher dessus).

### Objectif

Aucun changement fonctionnel visible, sauf un : le panneau « Coût du mois »
gagne un bouton « Réessayer » en erreur. Le reste est de la cohérence : brancher
les hooks maison écrits mais jamais utilisés, remplacer les styles inline par
des classes, éliminer le dernier hex codé en dur.

### Périmètre exact

- `apps/web/src/couts/PanneauCoutMois.tsx` (+ test)
- `apps/web/src/couts/CoutsAnnuelsPage.tsx` (+ test)
- `apps/web/src/couts/useCouts.ts`
- `apps/web/src/styles.css` (nouvelles classes `couts`)

**Hors périmètre** : tout autre répertoire ; aucun libellé ne change ; aucune
logique métier.

### Décisions déjà prises

1. **`PanneauCoutMois`** : remplacer la gestion d'état manuelle
   (`useState`/`useEffect`/`AbortController`, l.116–149) par deux appels au
   hook existant `useAsync` sur le modèle exact de `CoutsAnnuelsPage`
   (`etatSimule` + `etatReel` conditionnel) — ou par `useCoutMois` de
   `useCouts.ts` appelé deux fois (simulé/réel). Choisir `useAsync` direct si
   `useCoutMois` ne permet pas le fetch conditionnel du réel ; dans ce cas,
   SUPPRIMER `useCoutMois`/`useCoutAnnuel` de `useCouts.ts` s'ils restent
   morts (pas de code écrit-jamais-appelé). La prop `version` reste le
   déclencheur de re-fetch (dans le tableau de deps).
2. **Bouton « Réessayer »** dans l'état erreur du panneau : même rendu que
   celui de `CoutsAnnuelsPage` (l.199–213) — `role="alert"`, message via
   `messageErreur`, `btn secondaire no-print` qui appelle les `reload()` des
   états.
3. **Styles inline → classes** : créer dans `styles.css` (section couts) les
   classes nécessaires et les substituer dans les deux composants —
   `#e5e7eb` (RecapGlobal, `PanneauCoutMois.tsx` l.96) devient
   `var(--bordure)`. Ne pas renommer les classes existantes
   (`panneau-cout`, `table-couts-wrap`, `actions-export`, `debit`, `credit`).
   Les styles inline portant une logique conditionnelle (couleur du delta)
   peuvent rester inline ou devenir des classes conditionnelles — au choix,
   mais sans changer le rendu.
4. Interface `PanneauCoutMoisProps` : **NE PAS MODIFIER** (verrouillée par le
   commentaire de scaffold, consommée par `PlanningPage`).

### Conventions à respecter

- `useAsync` (`apps/web/src/hooks/useAsync.ts`) est le pattern de fetch du
  repo ; `messageErreur` pour les messages.
- Aucun snapshot de rendu ne doit changer hors état erreur (le DOM peut
  changer de attributs `style` → classes : adapter les tests qui asserteraient
  des styles inline, s'il y en a).

### Critères d'acceptation

- [ ] Plus de `useEffect` de fetch manuel dans `PanneauCoutMois` ; `useCouts.ts`
      soit branché, soit supprimé (zéro export mort).
- [ ] En erreur, le panneau affiche « Réessayer » et le clic relance le fetch
      (test avec mock api rejetant puis résolvant).
- [ ] `grep -n "#e5e7eb" apps/web/src` → aucune occurrence.
- [ ] Aucune régression visuelle (vérif UI locale : Planning avec panneau,
      page Coûts, 375 px et desktop, y compris impression).
- [ ] `corepack pnpm@10.34.2 nx run-many -t lint typecheck test -p web` vert ;
      e2e stack vert (le spec couts lit `#recap-cout-mois` : conserver cet id).

### Pièges connus

- Conserver les ids `#recap-cout-mois` et `#recap-couts-annuels` (utilisés par
  les e2e).
- `useAsync` annule via `AbortSignal` : vérifier que le double fetch
  simulé/réel ne déclenche pas un `setState` après démontage (le hook le gère
  déjà — ne pas réintroduire de gestion manuelle).
- Piège récurrent du repo : `lireSeqLocale`-style — les fonctions passées à
  `useAsync` doivent avoir des deps stables (pas de lambda recréée qui change
  les deps à chaque rendu au-delà de ce que le tableau de deps déclare).

---

## Dette documentée (hors périmètre, décision PO)

- **`grille_tarifaire` projetée mais jamais lue** : la projection
  (`projection.service.ts` → table `grille_tarifaire`) consomme
  `referentiel.GrillePubliee.v1` mais `CoutService`/`cout.mapper.ts` valorisent
  avec les grilles **statiques** du domaine (`GrilleAbcm.pour`,
  barème PSU codé). Conséquence : publier une grille ne change aucun montant.
  À trancher dans une session future : brancher la lecture (avec repli sur la
  grille statique) ou retirer projection + table. Ne rien faire dans ce
  chantier.
- **Contrat ABCM démarrant après septembre** : pas de frais fixes cette année
  scolaire-là (le bloc frais fixes exige une prestation ABCM dans le mois de
  septembre). Limitation acceptée (décision de ce plan) — à réviser si un vrai
  foyer est concerné.
- **Rappel mémoire projet** : NOT NULL `enfant_id` (svc-planification) différé,
  session dédiée — indépendant de ce chantier.
