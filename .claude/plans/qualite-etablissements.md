# Plan — Qualité « Les crèches & écoles » (feature Établissements, front + backend)

> **Nature du document.** Plan d'exécution auto-portant. L'exécutant (Opus 4.8, ou
> Sonnet 5 pour les lots marqués) n'a **ni** la conversation d'audit **ni** de contexte
> implicite : tout ce qui est nécessaire est ici. En cas de doute sur un arbitrage
> produit, **ne pas inventer** — le « quoi » est déjà tranché ci-dessous.

---

## 1. Contexte & objectif

La feature « établissements » (entité libre par foyer : la crèche / l'école / le
périscolaire de la famille, destinataire des récapitulatifs) est **fonctionnellement
complète et déployée en prod** (`0.11.0`). Son **backend de CRUD est solide** (écritures
transactionnelles + outbox, unicité nom/foyer → 409, garde de suppression réelle,
projection NATS idempotente, envoi au service idempotent). En revanche l'**écran parent
est le moins fini de l'app** (styles inline partout, jargon interne) et **deux angles morts
backend↔front** trahissent la confiance du parent.

**Objectif** : faire franchir à cette feature le palier « prototype qui marche » →
« produit pro », **front ET backend**, sans ajouter de fonctionnalité. On corrige le
langage, la finition, et surtout on ferme les angles morts qui font qu'un parent croit (à
tort) que sa crèche est prévenue.

### Ce qui est validé par le PO (réponses aux questions d'audit)

1. **Langage : reformuler à fond.** L'écran devient **« Crèches & écoles »**. On bannit
   les mots « établissement », « préavis », « types » du **texte vu par le parent**
   (routes, events, tables, noms de code **inchangés**).
2. **Lot 4 (préavis in-app) : inclus.** On surface le délai comme date limite dans le
   parcours de validation.
3. **Archivage = vraiment inactif.** Un établissement archivé n'est **plus notifié** ET
   n'est **plus proposable** pour un nouveau contrat (il reste visible sur les contrats
   existants qui le référencent déjà).

### Faits qui dé-risquent le plan (à garder en tête)

- **Aucune migration de base** sur les 4 lots. Lot 2 « routable » est **calculé** depuis
  `emailService` ; Lot 3 réutilise la colonne **existante** `etablissement.actif` ; Lot 4
  est front-only. **Si un lot vous pousse à écrire une migration, c'est que vous avez
  dévié du plan.**
- **Le backend du CRUD ne doit pas être « refait pour faire joli ».** On y touche
  uniquement aux points explicitement listés (Lots 2 et 3).
- Le **préavis** est déjà projeté vers `svc-notifications` **et** exposé par la vue BFF
  `semaine/besoins` (`preavisRegle` par établissement) : Lot 4 n'a **aucun** appel réseau
  ni contrat à changer.

### Hypothèses assumées (défauts pris faute de précision — corrigeables avant lancement)

- **H1.** Le mot **« établissement »** reste dans le **code, les routes (`/etablissements`),
  les events (`planification.Etablissement*.v1`), les tables et les logs**. On ne renomme
  que le **texte visible**. (Renommer routes/events serait une rupture de contrat hors
  périmètre.)
- **H2.** Le champ **`types`** (modes proposés, « purement informatif, aucune incidence »
  d'après son propre DTO — jamais lu par aucun consommateur) est **retiré du formulaire et
  de la carte parent**. La **colonne DB et le champ d'event sont conservés** (compat) ;
  ils resteront simplement à `[]` pour les nouvelles fiches. Personne d'autre ne les écrit.
- **H3.** Le libellé visible retenu est **« Crèches & écoles »** (titre de page, entrée de
  nav, titre de route). Nom court d'action : **« crèche / école »**.
- **H4.** Pour un établissement **sans e-mail** ou **archivé**, la vue de relecture montre
  un **avertissement + un lien « Ajouter un e-mail »/« Réactiver »** au lieu du bouton
  d'envoi ; on **ne fabrique pas** d'adresse par défaut et on **n'envoie jamais** à vide.
- **H5.** Le délai (Lot 4) s'affiche dans **`EditeurSemaine`** (en-tête de groupe par
  établissement, « près de la validation »). On ne le duplique pas ailleurs pour l'instant.

---

## 2. Conventions & commandes communes à TOUS les lots

**Environnement / exécution (Windows).**

- Gestionnaire de paquets : **`corepack pnpm@10.34.2`** (jamais le pnpm global 8.x). Toute
  tâche passe par **nx** : `corepack pnpm@10.34.2 nx …` (ou `pnpm nx …`).
- **Environnement de travail** : `pnpm preflight` en début de session — cf.
  [CONTRIBUTING.md § Pièges](../../CONTRIBUTING.md), source unique sur la boucle de dev.
  Travailler dans le **clone principal** `…/Documents courtier/creche-planner-public`.

**Typage & tests (piège récurrent).**

- Vérification : **`nx test web`** pour la partie web, `nx run-many -t test lint -p <projet>`
  pour un service backend — le type-check et les builds de libs de contrats
  (`contracts-kernel`, `contracts-planification`, `shared-semaine`) sont des arêtes de la
  cible `test`.
- Cible d'ensemble : `nx affected -t typecheck lint test` doit rester **vert** avant PR.

**Conventions de code (déjà en vigueur, à respecter à la lettre).**

- ESLint 9 flat config **type-aware**, ratchet warn→error : **zéro warning introduit**.
- `verbatimModuleSyntax` **web-only** → imports de type via `import type`.
- **Branded types / unions exhaustives** côté domaine ; ne pas réintroduire d'états
  invalides.
- **Design system** : consommer les **tokens** existants (`--esp-1..6`, `--bleu`, `--vert`,
  `--rouge`, `--gris` #4b5563 AA, `--ambre`, `--bordure`, `--h1/2/3`) et les **classes**
  existantes plutôt que des `style={{}}` inline. **Aucun token inventé** (ex. `--jaune`
  **n'existe pas** ; la convention « test/simulation » est `--ambre` + `.badge-simulation`).
- **A11y non négociable** : `aria-describedby` sur les erreurs de champ, `role="alert"` /
  `role="status"` + `aria-live`, focus visible, cibles tactiles ≥ 44px (min-height
  `2.75rem` déjà porté par `.btn`, inputs, etc.).

**Contrats & drift (Lots 2/3).**

- Pact **BFF↔services** : `apps/api-gateway/src/contract/*.consumer.pact.spec.ts` (consumer)
  et `apps/<svc>/src/contract/*.provider.pact.spec.ts` (provider). **Piège** : à la
  régénération d'un pact, **régénérer « à blanc »** (supprimer les fichiers `/pacts/*.json`
  concernés puis relancer) pour éviter les interactions en doublon. `/pacts` est dans
  `.prettierignore` (ne pas le retirer). **`can-i-deploy` doit rester vert** : toute
  évolution de payload est **additive** (nouveau champ optionnel), jamais rupteur.
- Contrat **web↔BFF** : décrit par `libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts`
  et vérifié côté web par `apps/web/src/api/openapi-types.spec.ts` contre le type généré
  `apps/web/src/api/openapi-types.gen.ts`. Toute nouvelle propriété exposée par le BFF doit
  être répercutée dans l'OpenAPI **et** le type généré, sinon `openapi-types.spec.ts` casse.

**E2E (piège).** Les specs `apps/web/e2e/*.e2e.spec.ts` (`parcours`, `a11y`) **assertent des
libellés visibles** (dont l'entrée de nav « Établissements »). **Tout renommage de libellé
doit être répercuté dans ces specs.** L'e2e-stack est un **orchestrateur destructif**
(`docker compose down -v`) : ne le lancer qu'en connaissance de cause.

**Vérif UI locale.** Stack docker + seed, puis Vite dev sur `:4200` (cf. mémoire
« Vérif UI locale ») — ou l'outil de preview navigateur. Toujours vérifier en **~375px de
large** (mobile), plus tablette (≥ 768px), et l'impression n'est pas concernée ici.

---

## 3. Vue d'ensemble des lots

| Lot   | Titre                                                                   | Couche                           | Modèle                                                            | Dépend de                                                  |
| ----- | ----------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------- |
| **1** | Langage parent + finition design-system de l'écran « Crèches & écoles » | Front                            | **Opus 4.8** (parties string/token pures **délégables Sonnet 5**) | —                                                          |
| **2** | Fermer l'angle mort « crèche sans e-mail » (brouillon _routable_)       | Backend + BFF + Front + contrat  | **Opus 4.8**                                                      | —                                                          |
| **3** | Rendre l'archivage réel (plus notifié + plus proposable)                | Backend + BFF + Front + contrat  | **Opus 4.8**                                                      | **Lot 2 mergé** (réutilise `routable`/`raisonNonRoutable`) |
| **4** | Surfacer le délai (préavis) comme date limite dans la validation        | Front (module pur + intégration) | **Opus 4.8**                                                      | —                                                          |

**Ordre recommandé : 1 → 2 → 3 → 4.** Lots 1, 2 et 4 sont indépendants ; **Lot 3 suppose
Lot 2 mergé**. Chaque lot = 1 PR.

**Cloisonnement des fichiers (pour éviter les conflits entre lots) :**

- **Lot 1** possède **`EtablissementsPage.tsx`** (et le libellé de nav dans `App.tsx`).
- **Lot 2** possède **`RelectureEnvoi.tsx`** (comportement + finition) et le chemin d'envoi
  `svc-notifications`.
- **Lot 4** possède **`EditeurSemaine.tsx`** + le nouveau module pur.
- Ainsi aucun fichier n'est réécrit par deux lots (`RelectureEnvoi` est **entièrement** au
  Lot 2, y compris son nettoyage de style).

---

## LOT 1 — Langage parent + finition design-system de « Crèches & écoles »

### Objectif (parent : avant → après)

- **Avant** : le parent arrive sur un écran administratif (« Établissements de la famille »,
  « établissements destinataires des récapitulatifs », « Règle de préavis », « Types
  proposés »), 100 % en styles inline, avec une carte à 3 boutons qui se serrent sur mobile
  et un état vide sec.
- **Après** : un écran **« Crèches & écoles »** en mots de parent, rangé au design-system,
  confortable au pouce à 375px, avec un **état vide d'accueil** et un **avertissement clair**
  quand une crèche n'a pas d'e-mail (« sans e-mail, elle ne recevra pas les récaps »).

### Périmètre exact

**Fichiers à modifier :**

- `apps/web/src/etablissements/EtablissementsPage.tsx` (cœur du lot).
- `apps/web/src/etablissements/EtablissementsPage.test.tsx` (mettre à jour les libellés
  assertés + ajouter la couverture de l'avertissement « sans e-mail »).
- `apps/web/src/App.tsx` : libellé de l'entrée de nav `…/etablissements` (**« Établissements »
  → « Crèches & écoles »**, dans le panneau « Plus » mobile ET le rendu desktop) **et** la
  fonction `titreDepuisPathname` (segment `etablissements` → `'Crèches & écoles'`).
- `apps/web/src/styles.css` : ajouter les rares classes établissement-spécifiques
  nécessaires (voir « Décisions »), en **mobile-first** comme le reste du fichier.
- `apps/web/e2e/parcours.e2e.spec.ts` et `apps/web/e2e/a11y.e2e.spec.ts` : répercuter le
  libellé de nav si assert (rechercher « Établissements »).
- **Vérifier** `apps/web/src/utils/libelles.ts` : `LIBELLES_MODE` reste utilisé ailleurs
  (contrats, planning) → **ne pas y toucher** ; le retrait de « types » (H2) se fait dans la
  page, pas dans les libellés de mode.

**Hors périmètre (ne pas toucher) :** la route `/foyers/:id/etablissements` ; le hook
`useEtablissements.ts` ; l'API client ; les DTO/schemas backend ; `RelectureEnvoi.tsx`
(c'est le Lot 2) ; le champ `types` côté DB/DTO/event (on le **retire seulement de l'UI**).

### Décisions déjà prises

**A. Table de reformulation (avant → après) — appliquer telle quelle.**

| Emplacement                          | Avant                                                                                                                             | Après                                                                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Titre page (`useTitrePage` + `<h1>`) | « Établissements » / « Établissements de la famille »                                                                             | **« Crèches & écoles »**                                                                                                                            |
| Sous-titre / intro                   | « Les établissements destinataires des récapitulatifs (crèche, école, périscolaire…). Chaque contrat est rattaché à l'un d'eux. » | **« Les lieux d'accueil de vos enfants (crèche, école, périscolaire…). C'est ici qu'on envoie le récapitulatif quand vous modifiez une semaine. »** |
| Bouton d'ajout                       | « + Nouvel établissement »                                                                                                        | **« Ajouter une crèche / école »**                                                                                                                  |
| Titre du formulaire                  | « Nouvel établissement » / « Modifier l'établissement »                                                                           | **« Ajouter une crèche / école »** / **« Modifier »**                                                                                               |
| Libellé champ nom                    | « Nom de l'établissement »                                                                                                        | **« Nom »** (placeholder/aide : « ex. Crèche du centre, École Jean Jaurès »)                                                                        |
| Libellé champ e-mail                 | « Adresse e-mail du service »                                                                                                     | **« E-mail de la crèche / école »** (aide : « C'est à cette adresse qu'on enverra le récapitulatif. »)                                              |
| Légende préavis                      | « Règle de préavis »                                                                                                              | **« Délai pour prévenir »** (aide : « Combien de temps à l'avance la structure veut être prévenue d'un changement. »)                               |
| Option préavis 1                     | « Aucune règle »                                                                                                                  | **« Pas de délai particulier »**                                                                                                                    |
| Option préavis 2                     | « En jours ouvrés »                                                                                                               | **« Un nombre de jours ouvrés »**                                                                                                                   |
| Option préavis 3                     | « Un jour + une heure butoir »                                                                                                    | **« Un jour et une heure limite »**                                                                                                                 |
| Champ heure                          | « Heure butoir »                                                                                                                  | **« Heure limite »**                                                                                                                                |
| Fieldset « Types proposés »          | _(bloc entier)_                                                                                                                   | **SUPPRIMÉ** (H2)                                                                                                                                   |
| Bouton submit création               | « Créer l'établissement »                                                                                                         | **« Ajouter »**                                                                                                                                     |
| Récap carte (email absent)           | `aucune adresse e-mail` (gris)                                                                                                    | **avertissement**, voir décision C                                                                                                                  |
| Récap carte (préavis)                | « préavis : jeudi avant 12:00 »                                                                                                   | **« Délai pour prévenir : avant jeudi 12 h »** (réécrire `decrirePreavis`)                                                                          |
| Ligne carte « Types : … »            | _(présente)_                                                                                                                      | **SUPPRIMÉE** (H2)                                                                                                                                  |
| Boutons carte                        | « Modifier » / « Archiver » / « Réactiver » / « Supprimer »                                                                       | inchangés en texte ; **restylés** (décision D)                                                                                                      |
| Message modale suppression           | « L'établissement « X » sera définitivement supprimé… »                                                                           | **« La crèche / école « X » sera définitivement supprimée. La suppression est refusée si un contrat y est encore rattaché. »**                      |
| État vide                            | carte grise « Aucun établissement configuré. »                                                                                    | **`EtatVide`**, voir décision B                                                                                                                     |

**B. État vide → composant `EtatVide` existant** (`apps/web/src/ui/EtatVide.tsx`, déjà
utilisé par `App.tsx`). Rendu quand `!loading && !error && data?.length === 0` :

- `titre` = **« Ajoutez votre première crèche ou école »**
- `description` = **« Renseignez la crèche, l'école ou le périscolaire de vos enfants pour
  pouvoir les prévenir en un clic quand vous modifiez une semaine. »**
- `actions` = `[{ libelle: 'Ajouter une crèche / école', primaire: true, onClick: ouvrirCreation }]`
  (l'`ActionEtatVide` accepte `onClick` **ou** `href` — utiliser `onClick` pour ouvrir le
  formulaire inline). Vérifier la signature exacte dans `EtatVide.tsx`.

**C. Avertissement « sans e-mail » sur la carte (angle mort, volet front).** Sur
`CarteEtablissement`, quand `e.emailService` est `null`/`''` **et** `e.actif` :

- Remplacer le fragment muted « aucune adresse e-mail » par une **ligne d'alerte** :
  élément avec `className="debit"` (ou un badge d'alerte) + `role="note"` :
  **« ⚠️ Sans e-mail, cette crèche ne recevra pas les récapitulatifs. »** suivie d'un rappel
  discret « Ajoutez son e-mail via « Modifier ». »
- Ne PAS afficher cet avertissement pour un établissement **archivé** (`!e.actif`) : un
  archivé n'est de toute façon plus notifié (Lot 3) → il porte déjà « (archivé) ».
- C'est un signal **statique** basé sur une donnée **déjà chargée** (aucun appel réseau).

**D. Finition mobile — réutiliser les patterns existants (ne rien réinventer).**

- **Rangée d'actions de la carte** (Modifier / Archiver / Supprimer) : reprendre le pattern
  **`.carte-contrat-actions`** déjà défini dans `styles.css` (empilé pleine largeur < 480px,
  en ligne ≥ 480px). Si un nom dédié est préférable, créer `.etab-actions` **calqué** sur
  `.carte-contrat-actions` (mêmes règles, même media-query 480px). Le bouton **« Supprimer »**
  prend `className="btn secondaire danger contour"` (variante destructive discrète existante).
- **Paires de champs** (ex. jour + heure limite du préavis) : réutiliser **`.champs-duo`**
  (empilé < 480px, en ligne ≥ 480px) au lieu du `display:flex; gap` inline.
- **En-tête de page** (titre + liens « Contrats »/« Planning ») : remplacer le
  `style={{display:flex,justifyContent:'space-between'…}}` par une classe (`.etab-entete`
  calquée sur les en-têtes existants, `flex-wrap` pour ne pas déborder à 375px).
- **Supprimer TOUS les `style={{}}` restants** de `EtablissementsPage.tsx` (fieldsets,
  largeurs `width:'100%'` déjà couvertes par la règle CSS `input,select{…}` — vérifier,
  sinon garder une classe utilitaire). Les `fieldset` de saisie s'appuient sur la règle
  globale `fieldset{min-width:0}` déjà présente.
- Cibles tactiles : conserver `min-height:2.75rem` (hérité de `.btn`/inputs). Cases à
  cocher/radios gardent leur taille native (règle CSS existante) — le préavis reste en
  radios natives, on n'ajoute pas de custom control.

**E. Retrait de `types` (H2).** Supprimer, dans `EtablissementsPage.tsx` : le state `types`,
les constantes `MODES`, le fieldset « Types proposés », la ligne « Types : … » de la carte,
et `libelleType`. Dans `soumettre`, **ne plus envoyer `types`** (le DTO backend a `types`
`optional` → défaut `[]`, donc omettre le champ est valide). Vérifier que
`CreerEtablissement`/`ModifierEtablissement` (types web dérivés de l'OpenAPI) tolèrent
l'absence de `types` (ils le doivent : `optional`). **Ne pas** modifier le schéma backend.

### Conventions à respecter (rappel ciblé)

- Garder l'infra a11y déjà en place (erreurs liées `aria-describedby`, `role="alert"`,
  `aria-live` sur le succès). Le nouveau texte d'aide (e-mail, délai) se lie via
  `aria-describedby` au champ concerné.
- Réutiliser `ModaleConfirmation` (déjà importé) pour la suppression, avec le nouveau
  message (décision A).
- Ne pas introduire de nouvelle dépendance ; pas de nouveau composant lourd — `EtatVide`,
  `ModaleConfirmation`, `Badge` existent déjà.

### Critères d'acceptation

**Comportement (parent) :**

- [ ] L'entrée de nav, le titre de page et l'onglet affichent **« Crèches & écoles »** ;
      plus aucune occurrence de « établissement destinataire », « préavis », « Types proposés »,
      « e-mail du service » dans le texte visible de l'écran.
- [ ] Une crèche **sans e-mail** (et active) affiche l'avertissement « ⚠️ Sans e-mail… ».
- [ ] Écran sans aucune crèche → **`EtatVide`** avec l'action « Ajouter une crèche / école ».
- [ ] Le formulaire n'a **plus** de bloc « Types proposés ».
- [ ] À 375px : la rangée d'actions de carte s'empile (aucun scroll horizontal de page),
      cibles ≥ 44px ; à ≥ 480px elle repasse en ligne.

**Technique :**

- [ ] `EtablissementsPage.tsx` ne contient **plus aucun** `style={{}}` inline (tout passe
      par classes/tokens).
- [ ] Création/édition d'une crèche fonctionne **sans** envoyer `types` (payload sans le
      champ) et le backend l'accepte (défaut `[]`).
- [ ] `nx run-many -t typecheck test lint -p web` **vert** ; e2e libellés à jour.

### Comment vérifier

1. `corepack pnpm@10.34.2 nx run-many -t test lint -p web`.
2. UI locale (stack + Vite `:4200`, cf. §2), route `/foyers/:id/etablissements` :
   - 375px : créer une crèche **sans** e-mail → vérifier l'avertissement sur la carte ;
   - vider la liste (ou foyer neuf) → vérifier l'`EtatVide` ;
   - vérifier l'empilement des actions à 375px puis ≥ 480px ;
   - passer un lecteur d'écran/az sur les erreurs de champ (toujours liées).
     Capture d'écran mobile à l'appui.
3. `nx run web:e2e` **uniquement** si les specs de libellé changent (sinon s'appuyer sur les
   tests unitaires ; l'e2e-stack est destructif).

### Pièges connus

- **E2E libellés** : « Établissements » est asserté dans `parcours`/`a11y` e2e → répercuter.
- **`EtatVide` API** : lire `ui/EtatVide.tsx` pour la forme exacte de `ActionEtatVide`
  (`onClick` vs `href`, `primaire`).
- **Ne pas** retirer `--gris`/toucher aux tokens ; **ne pas** inventer `--jaune`.

### Modèle d'exécution

**Opus 4.8.** Restructuration JSX (intégration `EtatVide`, rangée d'actions, retrait de
`types`), préservation a11y et mise à jour des tests → jugement d'implémentation requis.
Les **remplacements de chaînes** (table A) et les **swaps de style→classe** purement
mécaniques, une fois cette section sous les yeux, sont **délégables à Sonnet 5**.

---

## LOT 2 — Fermer l'angle mort « crèche sans e-mail » (brouillon _routable_)

### Objectif (parent : avant → après)

- **Avant** : le parent modifie sa semaine, valide, voit « Dernière étape : prévenir les
  services »… puis **« Aucune modification à transmettre à un service »** — alors qu'il y a
  bien des changements. Cause : sa crèche n'a pas d'e-mail, donc le brouillon **404** et il
  est **silencieusement écarté** (`RelectureEnvoi.tsx`, `Promise.allSettled`). Le parent
  repart convaincu que la crèche est prévenue. **Elle ne l'est pas.**
- **Après** : la crèche concernée mais **non joignable** apparaît **explicitement** avec un
  avertissement (« Cette crèche n'a pas d'e-mail — elle ne sera pas prévenue ») et un
  **raccourci « Ajouter un e-mail »**. Plus jamais d'échec silencieux ; jamais d'envoi à
  vide.

### Périmètre exact

**Backend `svc-notifications` :**

- `apps/svc-notifications/src/envoi/envoi.service.ts` : `construire()` ne **404 plus** pour
  e-mail absent → renvoie un brouillon **non routable** ; `envoyer()` **refuse** un envoi non
  routable (garde).
- `apps/svc-notifications/src/envoi/envoi.dto.ts` : enrichir `BrouillonEtablissementVue`.
- `apps/svc-notifications/src/envoi/envoi.service.spec.ts` : mettre à jour (l'ancien test
  « 404 si sans adresse » devient « brouillon non routable »).

**BFF `api-gateway` :**

- `apps/api-gateway/src/clients/notifications.client.ts` : type `BrouillonEtablissement`
  (relais) — ajouter les champs.
- `apps/api-gateway/src/bff/validations.controller.ts` : relais du brouillon (vérifier qu'il
  repasse bien le nouveau payload ; a priori transparent).
- `libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts` : schéma de réponse du brouillon
  (ajouter les propriétés).
- Pact : `apps/api-gateway/src/contract/notifications.consumer.pact.spec.ts` +
  `apps/svc-notifications/src/contract/notifications.provider.pact.spec.ts` (interaction
  brouillon).

**Front `web` :**

- `apps/web/src/types/bff.ts` : interface `BrouillonEtablissement` (ligne ~454) — ajouter les
  champs.
- `apps/web/src/api/openapi-types.gen.ts` : régénérer si le type est dérivé de l'OpenAPI
  (sinon, mettre à jour l'interface manuelle) — `openapi-types.spec.ts` doit rester vert.
- `apps/web/src/notifications/RelectureEnvoi.tsx` : afficher le cas non routable + **nettoyer
  la finition** de ce fichier (styles inline, tokens `--jaune` inexistants → `--ambre` /
  `.badge-simulation`).
- `apps/web/src/notifications/RelectureEnvoi.test.tsx` : couvrir le cas non routable.

**Hors périmètre :** le récap **du mardi aux parents** (`scheduler.hebdo.ts`,
`recapMardi.ts`) — il ne dépend pas de l'e-mail de la crèche (il va aux parents) et ne fait
pas partie de cet angle mort. Ne pas y toucher ici.

### Décisions déjà prises

**A. Notion de « routable ».** Un brouillon est **routable** ⇔ l'établissement a un e-mail
de service. (Le Lot 3 étendra la condition à « ET actif ».) On enrichit
`BrouillonEtablissementVue` (backend) et `BrouillonEtablissement` (web) :

```
readonly routable: boolean;            // false ⇒ pas d'envoi possible
readonly raisonNonRoutable: 'SANS_EMAIL' | null;   // Lot 3 ajoutera 'ARCHIVE'
```

Conserver `destinataire: string` **toujours présent** (chaîne **vide** `''` quand non
routable) — évite de rendre un champ existant nullable (moindre churn de contrat). Le front
ne lit `destinataire` que lorsque `routable === true`.

**B. `construire()` (envoi.service.ts).** Comportement cible :

- Établissement **inconnu ou hors du foyer** → **conserver le 404** (inchangé).
- Établissement **connu, du bon foyer, mais sans e-mail** → **ne plus 404** : construire le
  brouillon normalement (calcul des `enfants` inchangé — il ne dépend pas de l'e-mail), avec
  `destinataire = ''`, `routable = false`, `raisonNonRoutable = 'SANS_EMAIL'`. Le `sujet`/
  `corps`/`texte` sont rendus comme d'habitude (relecture possible).
- Établissement joignable → `routable = true`, `raisonNonRoutable = null`, comportement
  actuel.
- `dryRun` : ne le calculer (via `dryRunEffectif`) **que** si `routable` (sinon `false`,
  il n'a pas de sens).

**C. `envoyer()` (envoi.service.ts) — garde.** Avant toute réservation de slot : si le
brouillon reconstruit est **non routable**, **lever une erreur métier claire** (ex.
`BadRequestException` `{ champ: 'etablissement', message: 'crèche sans e-mail : ajoutez une
adresse avant d'envoyer' }`) **sans** insérer de ligne `envoi_etablissement` ni solliciter
le mailer. Le front désactive déjà le bouton dans ce cas ; cette garde est la ceinture-et-
bretelles côté serveur (on n'envoie jamais à vide).

**D. `RelectureEnvoi.tsx` — rendu du cas non routable.** Le fetch (`Promise.allSettled`)
reste, mais les brouillons non-e-mail **ne 404 plus** → ils reviennent avec `routable:false`.
Dans le `map` de `concernes` (`b.enfants.length > 0`), **brancher sur `b.routable`** :

- `routable === true` → bloc d'envoi actuel (`BlocEnvoiEtablissement`).
- `routable === false` (`raisonNonRoutable === 'SANS_EMAIL'`) → **carte d'avertissement** :
  `role="note"`, texte **« ⚠️ « {libellé} » n'a pas d'e-mail : cette crèche ne sera pas
  prévenue de vos changements. »**, **aucun** bouton d'envoi, et un lien
  **« Ajouter un e-mail »** vers `/foyers/{foyerId}/etablissements` (`<Link>`), plus la liste
  des enfants/jours concernés (comme le bloc d'envoi, pour que le parent voie ce qui n'est
  pas transmis).
- Ajuster la logique du message « Aucune modification à transmettre… » : il ne doit
  s'afficher que si **aucun** établissement concerné (routable ou non) n'a de modif.

**E. Finition `RelectureEnvoi.tsx`.** Remplacer les tokens **inexistants** (`--jaune`,
`--jaune-clair`, `var(--gris, #ddd)`) et les `style={{}}` inline :

- Bandeau « Mode test » → réutiliser **`.badge-simulation`** (fond `#fef3c7`, texte
  `--ambre`) ou une classe `.bandeau-test` calquée dessus ; plus de `--jaune`.
- Séparateurs / paddings → tokens `--esp-*` et classes ; l'accent latéral garde
  `--ambre` (déjà valide).

### Conventions à respecter

- **Évolution de contrat additive** : `routable`/`raisonNonRoutable` sont **ajoutés** ;
  `destinataire` reste présent. `can-i-deploy` doit rester vert.
- **Pact** : régénérer « à blanc » (cf. §2), ajouter/ajuster l'interaction brouillon pour
  refléter `routable` (au moins un exemple `routable:true`, idéalement un `routable:false`).
- **OpenAPI web↔BFF** : mettre à jour `gateway.openapi.ts` **et** régénérer le type web ;
  `openapi-types.spec.ts` garde la synchro.

### Critères d'acceptation

**Comportement (parent) :**

- [ ] Foyer avec une crèche **sans e-mail** ayant des modifs validées → `RelectureEnvoi`
      **affiche** cette crèche en avertissement (jamais « rien à transmettre » à tort), avec le
      raccourci « Ajouter un e-mail ».
- [ ] Le bouton « Envoyer » **n'apparaît pas** pour une crèche non routable.
- [ ] Cas nominal (crèche avec e-mail) : comportement d'envoi **inchangé** (idempotence,
      dry-run, confirmation).

**Technique :**

- [ ] `construire()` ne 404 plus pour e-mail absent ; 404 conservé pour établissement
      inconnu/hors foyer. `envoyer()` **refuse** proprement un non-routable **sans** écrire de
      slot ni appeler le mailer.
- [ ] Payloads : `BrouillonEtablissementVue` (backend) et `BrouillonEtablissement` (web)
      portent `routable` + `raisonNonRoutable` ; `destinataire=''` quand non routable.
- [ ] Pact régénéré, **provider verification verte**, **`can-i-deploy` vert**.
- [ ] `openapi-types.spec.ts` vert ; `nx affected -t typecheck lint test` vert.

### Comment vérifier

1. Backend : `nx run-many -t typecheck test lint -p svc-notifications api-gateway`
   (inclut les specs `envoi.service.spec.ts` mises à jour et les pact specs).
2. Contrats : lancer les pact consumer (BFF) + provider (`svc-notifications`), puis
   `can-i-deploy` selon le script du repo — **doit rester vert**.
3. Web : `nx run-many -t typecheck test -p web` (dont `RelectureEnvoi.test.tsx` +
   `openapi-types.spec.ts`).
4. **Bout-en-bout** (preuve que l'effet suit) : stack + Vite ; créer une crèche **sans**
   e-mail, un contrat rattaché, saisir une **modif** sur la semaine, **valider** → dans la
   relecture, vérifier l'**avertissement** + le lien ; ajouter l'e-mail via l'écran
   « Crèches & écoles », recharger → la crèche redevient **envoyable** (bloc d'envoi + bouton).
   Vérifier aussi qu'une tentative d'`envoyer()` non routable (appel direct) est refusée
   sans slot créé (test).

### Pièges connus

- **Pact doublons** → régénérer « à blanc » ; `/pacts` reste dans `.prettierignore`.
- **OpenAPI/type généré désynchro** → `openapi-types.spec.ts` casse : régénérer le type web.
- **`construire()` est partagé** entre `brouillon()` et `envoyer()` : bien mettre la garde
  dans `envoyer()` (pas dans `construire()`), sinon la relecture d'un non-routable planterait.
- **`z.uuid()` / zod** : suivre les patterns existants du service (pas de `z.string().uuid()`
  déprécié si le repo utilise `z.uuid()`).

### Modèle d'exécution

**Opus 4.8.** Modification de domaine + garde d'envoi + évolution de contrat (Pact +
OpenAPI) + comportement front conditionnel : jugement d'architecture et de contrat requis.

---

## LOT 3 — Rendre l'archivage réel (plus notifié + plus proposable)

> **Dépend du Lot 2 mergé** (réutilise `routable` / `raisonNonRoutable`).

### Objectif (parent : avant → après)

- **Avant** : « Archiver » est **cosmétique**. Le code affirme partout « un établissement
  archivé n'est plus notifié », mais ni l'envoi (`envoi.service.construire()`) ni le
  rattachement de contrat ne filtrent `actif`. Un archivé reste **notifiable** et **restait
  sélectionnable** pour un nouveau contrat (`ContratForm` le proposait, avec « (archivé) »).
- **Après** : archiver **fait ce qu'il dit** — la crèche archivée n'est **plus prévenue** et
  n'est **plus proposable** pour un nouveau contrat ; elle reste visible sur les contrats qui
  la référencent déjà (on ne casse pas l'existant).

### Périmètre exact

**Backend `svc-planification` (rattachement) :**

- `apps/svc-planification/src/planification/planification.service.ts` :
  `resoudreEtablissement()` (≈ l.527) et `rattacherEtablissement()` (≈ l.348) — refuser un
  établissement **archivé**, avec **tolérance « lien inchangé »** (voir décision B).
- `apps/svc-planification/src/planification/planification.service.spec.ts` : ajouter la
  couverture (rejet archivé à la création ; tolérance à l'édition d'un contrat qui pointe
  déjà dessus).

**Backend `svc-notifications` (envoi) :**

- `apps/svc-notifications/src/envoi/envoi.service.ts` : étendre `routable` = e-mail présent
  **ET** `actif`. `raisonNonRoutable` gagne la valeur `'ARCHIVE'`.
- `apps/svc-notifications/src/envoi/envoi.dto.ts` : élargir l'union
  `raisonNonRoutable: 'SANS_EMAIL' | 'ARCHIVE' | null`.
- `apps/svc-notifications/src/etablissement/etablissement-projete.service.ts` : `parId`
  renvoie déjà `actif` (OK) — rien à changer, juste le consommer.
- (Optionnel, cohérence) `apps/svc-notifications/src/scheduler/scheduler.hebdo.ts` :
  `annuaireParId()` peut **exclure les archivés** pour ne pas citer une crèche archivée dans
  le récap du mardi aux parents. Petit ; garder si sans risque.

**BFF + contrat :** répercuter `'ARCHIVE'` dans `gateway.openapi.ts`, le type web
`BrouillonEtablissement`, et les pact specs (même dossier qu'au Lot 2).

**Front `web` :**

- `apps/web/src/foyer/ContratForm.tsx` : le sélecteur d'établissement **exclut les archivés**
  des options pour un **nouveau** contrat ; à l'**édition** d'un contrat déjà rattaché à un
  archivé, **garder** cette option (sélectionnée). Ajuster le suffixe « (archivé) » en
  conséquence (il ne subsiste que pour l'option « conservée » en édition).
- `apps/web/src/notifications/RelectureEnvoi.tsx` : gérer `raisonNonRoutable === 'ARCHIVE'`
  → message dédié **« « {libellé} » est archivée : réactivez-la pour la prévenir. »** +
  lien vers l'écran « Crèches & écoles » (« Réactiver »).
- Tests : `ContratForm.test.tsx`, `RelectureEnvoi.test.tsx`.

**Hors périmètre :** la suppression (déjà gardée par contrats rattachés) ; l'archivage lui-
même (bouton Archiver/Réactiver existant, inchangé) ; toute migration (aucune).

### Décisions déjà prises

**A. `routable` (extension).** `routable = (emailService != null) && actif`.
`raisonNonRoutable` : `'ARCHIVE'` si `!actif` ; sinon `'SANS_EMAIL'` si pas d'e-mail ; sinon
`null`. Priorité à `'ARCHIVE'` (une crèche archivée sans e-mail est signalée « archivée »,
plus actionnable en un geste).

**B. Rejet du rattachement à un archivé — avec tolérance « inchangé ».**

- **Création de contrat** : si `dto.etablissementId` désigne un établissement **archivé** →
  **rejeter** (`ConflictException`/400, message : « cette crèche est archivée : réactivez-la
  ou choisissez-en une autre »).
- **Édition de contrat** : rejeter **seulement si** on **change** vers un archivé. Si le
  contrat pointe **déjà** sur cet archivé et que le lien est **inchangé**, **tolérer** (ne pas
  casser un contrat existant lors d'une édition d'autres champs). Implémentation : passer à
  `resoudreEtablissement()` l'`etablissementId` **actuel** du contrat (lu dans le chemin
  `modifier`) ; ne rejeter l'archivé que si `dto.etablissementId !== etablissementActuel`.
- La **création à la volée** (`nouvelEtablissement`) crée toujours un établissement `actif`
  → jamais concernée par ce rejet.

**C. Front `ContratForm` — options du sélecteur.**

- Prop `etablissements` : filtrer `e.actif === true` pour les options **par défaut**.
- Si `contrat?.etablissementId` correspond à un établissement **archivé** de la liste (cas
  édition), **l'ajouter** aux options (avec suffixe « (archivé) ») pour qu'il reste
  sélectionné/affiché ; sinon l'option n'apparaît pas.
- L'option « ➕ Créer une nouvelle crèche / école » reste (renommer le libellé pour cohérence
  Lot 1 : « ➕ Créer une nouvelle crèche / école »). _(Note : `ContratForm` étant hors du
  fichier du Lot 1, appliquer ici les libellés parent cohérents pour ce sélecteur.)_

### Conventions à respecter

- Le **`mode`** d'un contrat reste **indépendant** de l'établissement (dimension type/tarif)
  — ne pas coupler.
- Évolution de contrat **additive** (`'ARCHIVE'` ajouté à une union de chaînes) : côté
  consommateur c'est une valeur supplémentaire tolérée ; garder `can-i-deploy` vert.
- Idempotence/transactions du service planification **préservées** (le rejet archivé se fait
  **avant** l'écriture, dans la même logique que la vérification foyer existante).

### Critères d'acceptation

**Comportement (parent) :**

- [ ] Archiver une crèche → elle **disparaît** du sélecteur d'un **nouveau** contrat ; elle
      reste visible/sélectionnée sur un contrat qui la référence déjà (édition).
- [ ] Une crèche **archivée** rattachée à un contrat avec modifs → `RelectureEnvoi` affiche
      « archivée : réactivez-la » (pas d'envoi), au lieu d'un envoi silencieux.
- [ ] Réactiver la crèche → elle redevient proposable et notifiable.

**Technique :**

- [ ] `resoudreEtablissement()`/`rattacherEtablissement()` **rejettent** un archivé à la
      création et au **changement** ; **tolèrent** un lien **inchangé** en édition.
- [ ] `routable` intègre `actif` ; `raisonNonRoutable` gère `'ARCHIVE'` (priorité sur
      `'SANS_EMAIL'`).
- [ ] Pact + OpenAPI à jour ; `can-i-deploy` vert ; `nx affected -t typecheck lint test` vert.

### Comment vérifier

1. `nx run-many -t typecheck test lint -p svc-planification svc-notifications api-gateway web`.
2. Contrats : pact consumer/provider + `can-i-deploy` **verts**.
3. Bout-en-bout (stack + Vite) : archiver une crèche → vérifier qu'elle n'est **plus**
   proposée à la création d'un contrat ; éditer un contrat qui la référence déjà → elle
   reste sélectionnée ; valider une semaine avec modif sur ce contrat → `RelectureEnvoi`
   montre « archivée : réactivez-la » ; réactiver → redevient envoyable. Vérifier qu'aucun
   envoi réel n'a été tenté vers l'archivée (log/statut).

### Pièges connus

- **Tolérance « inchangé »** : sans elle, éditer un champ d'un contrat rattaché à un archivé
  planterait — bien threader l'`etablissementId` actuel dans `resoudreEtablissement`.
- **Deux chemins d'écriture** : création (`creer`) **et** édition (`modifier`) appellent
  `resoudreEtablissement` — appliquer la garde aux deux ; plus l'endpoint dédié
  `rattacherEtablissement`.
- **Priorité `ARCHIVE` vs `SANS_EMAIL`** dans `raisonNonRoutable` : respecter l'ordre (B/A).
- **Pact/OpenAPI** : `'ARCHIVE'` ajouté à l'union → régénérer type web + interactions.
- **Dépend du Lot 2** : ne pas démarrer si Lot 2 n'est pas mergé (conflit sur `envoi.dto.ts`
  / `RelectureEnvoi.tsx`).

### Modèle d'exécution

**Opus 4.8.** Garde de domaine avec cas limite (tolérance édition), extension de contrat,
cohérence multi-services (planification + notifications + BFF + web) : jugement requis.

---

## LOT 4 — Surfacer le délai (préavis) comme date limite dans la validation

### Objectif (parent : avant → après)

- **Avant** : le délai (« jeudi 12 h », « 2 jours ouvrés ») n'existe pour le parent que sous
  forme d'une phrase molle dans l'e-mail. **Dans l'app**, au moment de valider, il ne sait
  pas **quand** il doit s'y prendre. Donnée captée, jamais rendue actionnable à l'écran.
- **Après** : au moment d'éditer/valider la semaine, chaque crèche/école affiche sa **date
  limite concrète** (« À valider avant jeudi 12 h (le 02/07) »), et signale si le délai est
  **peut-être dépassé**. Le parent sait quoi **et quand**.

### Périmètre exact (front-only — aucun backend, aucun contrat)

**Nouveau module pur :**

- `apps/web/src/planning/delaiPreavis.ts` (à côté du précédent `planning/etatJourGarde.ts`,
  module pur testable) + `apps/web/src/planning/delaiPreavis.test.ts`.

**Intégration :**

- `apps/web/src/notifications/EditeurSemaine.tsx` : le `useMemo` `groupes` (≈ l.47) porte
  déjà `id`/`libelle`/`contrats` par établissement — **ajouter `preavisRegle`** (lu depuis
  `data.etablissements`, qui l'expose déjà) et **rendre la ligne de délai** sous l'en-tête de
  groupe (`<h4>`, l.104).
- Style : réutiliser tokens/classes (`--ambre`, `.muted`, `.debit` si dépassé). Ajouter au
  besoin une petite classe `.delai-preavis` dans `styles.css` (mobile-first).

**Hors périmètre :** `semaine/besoins` (déjà porteur de `preavisRegle` — **ne pas le
modifier**) ; l'e-mail `recapMardi.ts` (inchangé) ; `EncartValidation.tsx` (on ne duplique
pas le délai là pour l'instant, H5).

### Décisions déjà prises

**A. Signature du module pur.**

```ts
import type { PreavisRegle } from '../types/bff';

export interface DelaiPreavis {
  readonly texte: string; // libellé parent prêt à afficher
  readonly dateLimite: string | null; // ISO YYYY-MM-DD (null si 'aucun délai')
  readonly depasse: boolean; // vrai si dateLimite < aujourdhui (si fourni)
}

/** null ⇒ aucune ligne à afficher (pas de règle de délai). */
export function delaiPreavis(
  regle: PreavisRegle | null,
  semaineIso: string, // semaine cible (ex. '2026-W28')
  aujourdhui?: string, // ISO YYYY-MM-DD injecté (testabilité) ; absent ⇒ depasse=false
): DelaiPreavis | null;
```

- Utiliser **`joursDeLaSemaine(semaineIso)`** de `@creche-planner/shared-semaine` pour
  obtenir le **lundi cible** (`jours[0]`, ISO `YYYY-MM-DD`). (Fonction déjà utilisée par le
  scheduler et `semaine-besoins`.)
- Formatage des dates via les utils web existants (`utils/dates.ts` : `dateCourteFr` /
  `dateLongueFr` / `LIBELLES_JOURS`) — **vérifier les noms exacts** dans le fichier avant
  usage.

**B. Algorithme.**

- `regle === null` → **retourner `null`** (aucune ligne).
- **`JOUR_HEURE { jour, heure }`** : `dateLimite` = l'occurrence de `jour` (LUNDI..DIMANCHE)
  dans la **semaine précédant** le lundi cible, c.-à-d. la date, dans l'intervalle
  `[lundiCible − 7, lundiCible − 1]`, dont le jour de semaine == `jour` (elle est **unique**
  dans cet intervalle de 7 jours). `texte` = **« À valider avant {jourFr} {heure} (le
  {dateCourte}) »** (ex. « À valider avant jeudi 12:00 (le 02/07) »).
- **`JOURS_OUVRES { valeur }`** :
  - `valeur === 0` → `dateLimite` = **lundi cible** ; `texte` = **« À valider avant le début
    de la semaine »**.
  - `valeur ≥ 1` → `dateLimite` = **`valeur` jours ouvrés (lun–ven)** avant le lundi cible
    (reculer jour par jour depuis le lundi cible en ne comptant que lun–ven jusqu'à atteindre
    `valeur`). `texte` = **« À valider au moins {valeur} jour(s) ouvré(s) à l'avance (avant
    le {dateCourte}) »**.
- **`depasse`** : si `aujourdhui` fourni et `dateLimite !== null` et `dateLimite < aujourdhui`
  (comparaison lexicographique ISO sûre) → `true`. Quand `depasse`, **préfixer** le texte :
  **« ⏰ Délai peut-être dépassé — prévenez la crèche au plus vite. »** (le texte de base
  suit).
- Purté totale : aucune horloge interne, aucune I/O. `aujourdhui` est **injecté** (le
  composant passe la date du jour ; les tests passent une date fixe).

**C. Rendu dans `EditeurSemaine`.**

- Étendre le mapping `groupes` pour inclure `preavisRegle` de l'établissement
  correspondant (`data.etablissements.find(e => e.etablissementId === …)?.preavisRegle ??
null`).
- Sous le `<h4>{groupe.libelle}</h4>`, si `delaiPreavis(preavisRegle, semaineIso, aujourdhui)`
  n'est pas `null`, afficher un `<p>` :
  - classe `.muted` par défaut ; **`.debit`** (+ `role="note"`/`aria-live` léger) si `depasse`.
  - icône `🕒` décorative (`aria-hidden`) devant le texte.
- `aujourdhui` : calculé au niveau composant (`new Date()` formaté `YYYY-MM-DD` via l'util
  date existant). **Ne pas** appeler `Date` dans le module pur.

### Conventions à respecter

- Module **pur et testé** (le repo privilégie le test unitaire du domaine pur, cf.
  `planning/etatJourGarde.ts` `classerAbsence()`).
- `PreavisRegle` est une **union discriminée** (`type: 'JOURS_OUVRES' | 'JOUR_HEURE'`) —
  **switch exhaustif**, pas de `default` silencieux (respect unions exhaustives).
- `readonly T[]` (pas `ReadonlyArray<T>`), `noUncheckedIndexedAccess` (gérer les accès
  d'index potentiellement `undefined`).

### Critères d'acceptation

**Comportement (parent) :**

- [ ] Dans l'éditeur de la semaine, chaque crèche/école avec un délai affiche sa **date
      limite concrète** (jour + heure ou jours ouvrés + date).
- [ ] Un délai **passé** (relativement à aujourd'hui) est signalé « peut-être dépassé ».
- [ ] Une crèche **sans** règle de délai n'affiche **aucune** ligne (pas de bruit).

**Technique :**

- [ ] `delaiPreavis` couvert par des tests : `JOUR_HEURE`, `JOURS_OUVRES` (0, 1, 2…),
      passage de semaine (lundi cible), `depasse` vrai/faux, `null`.
- [ ] Aucun appel réseau ni changement de contrat ; `nx run-many -t typecheck test -p web`
      vert.

### Comment vérifier

1. `corepack pnpm@10.34.2 nx test web` (dont `delaiPreavis.test.ts`).
2. UI locale (stack + Vite `:4200`) : ouvrir une notification du mardi → `EditeurSemaine` ;
   pour une crèche à préavis « jeudi 12 h » et une école à « 2 jours ouvrés », vérifier les
   deux libellés de date limite (375px + desktop). Forcer une semaine dont le délai est
   passé pour voir l'avertissement « dépassé ». Capture à l'appui.

### Pièges connus

- **Calcul de date** : la date limite d'un préavis « jeudi » pour la semaine N+1 est le jeudi
  de la semaine N (**précédente**), pas celui de la semaine cible — bien reculer dans
  `[lundiCible−7, lundiCible−1]`.
- **Pas d'appel `Date`/`Math.random` dans le module pur** (testabilité) — injecter
  `aujourdhui`.
- Vérifier les **noms exacts** des utils de `utils/dates.ts` avant de les appeler
  (`dateCourteFr`/`LIBELLES_JOURS`…).

### Modèle d'exécution

**Opus 4.8.** Le module de dates ouvrées/limite demande de la rigueur (cas limites,
exhaustivité) et une intégration a11y propre — jugement d'implémentation.

---

## 4. Récapitulatif « definition of done » (global)

- [ ] 4 PR (une par lot), Lot 3 après Lot 2 mergé.
- [ ] **Zéro migration de base** ; **zéro nouvelle dépendance** ; **zéro renommage** de
      route/event/table (H1).
- [ ] Langage parent : aucune occurrence visible de « établissement destinataire »,
      « préavis », « types proposés », « e-mail du service » (Lots 1, et libellés cohérents en
      3).
- [ ] Angles morts fermés : crèche **sans e-mail** (Lot 2) et **archivée** (Lot 3) sont
      **visibles** au parent, jamais silencieuses, jamais envoyées à vide.
- [ ] `nx affected -t typecheck lint test` vert ; **Pact + `can-i-deploy` verts** (Lots 2/3) ;
      `openapi-types.spec.ts` vert.
- [ ] Preuves UI mobiles (375px) à l'appui pour Lots 1, 2, 4.

---

## 5. Chemin du plan

`.claude/plans/qualite-etablissements.md`
