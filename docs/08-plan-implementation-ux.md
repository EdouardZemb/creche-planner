# 08 — Plan d'implémentation UX/navigation (sessions indépendantes)

> Statut : **À valider** · Version 0.1 · 2026-06-04
> Met en œuvre la [spec 07](07-spec-ux-navigation.md). Découpé en **lots à fichiers
> disjoints** pour être exécutés dans des **sessions Claude Code indépendantes** (en
> parallèle quand les dépendances le permettent), sans conflit de merge.

## 1. Principe de découpage

- **Front-only.** Tout se passe dans `apps/web/src`. Aucune modification de service,
  domaine, contrat d'API, ni de dépendance npm (sauf justification explicite).
- **Propriété de fichiers exclusive.** Chaque lot **possède** un ensemble de fichiers et
  ne touche **que** ceux-là (+ les `.test.tsx` voisins). Aucun fichier n'est partagé entre
  deux lots exécutables en parallèle → pas de conflit git.
- **Interfaces de props stables.** Les composants enfants gardent leurs signatures de props.
  Un lot qui consomme un composant d'un autre lot s'appuie sur l'interface existante.
- **Le Lot 1 est une fondation séquentielle.** Il crée les tokens CSS + les primitives
  partagées (état vide, modale, badge, hooks, libellés, couleurs, formats). Les lots 2→6
  **consomment** ces primitives ; ils démarrent une fois le Lot 1 mergé.
- **Une branche + une PR par lot** (`feat/ux-<lot>`), squash merge. CI verte obligatoire.

## 2. Graphe de dépendances

```
            ┌────────────────────────────────────────────┐
            │  LOT 1 — Fondation (CSS + primitives)        │  ← séquentiel, à merger d'abord
            └────────────────────────────────────────────┘
                 │        │        │        │        │
        ┌────────┘   ┌────┘   ┌────┘   ┌────┘   └────────┐
        ▼            ▼        ▼        ▼                 ▼
   ┌─────────┐ ┌─────────┐ ┌────────┐ ┌─────────┐ ┌──────────┐
   │ LOT 2   │ │ LOT 3   │ │ LOT 4  │ │ LOT 5   │ │ LOT 6    │   ← parallélisables
   │ Coquille│ │ Planning│ │Calendr.│ │ Formul. │ │ Coûts    │
   └─────────┘ └─────────┘ └────────┘ └─────────┘ └──────────┘
        └────────────┴─────────┴─────────┴──────────────┘
                              ▼
                     ┌─────────────────┐
                     │ LOT 7 — Polish  │  ← après merge des lots 2→6
                     │ + intégration   │
                     └─────────────────┘
```

| Lot | Dépend de | Parallélisable avec |
| --- | --------- | ------------------- |
| 1   | —         | (seul)              |
| 2   | 1         | 3, 4, 5, 6          |
| 3   | 1         | 2, 4, 5, 6          |
| 4   | 1         | 2, 3, 5, 6          |
| 5   | 1         | 2, 3, 4, 6          |
| 6   | 1         | 2, 3, 4, 5          |
| 7   | 2→6       | (seul)              |

## 3. Definition of Done commune (tous les lots)

1. CA de la/les exigence(s) couverts par des **tests** (Vitest + Testing Library) verts.
2. `pnpm nx run web:lint`, `web:typecheck`, `web:test`, `web:build` verts.
3. Aucun fichier hors périmètre du lot modifié ; aucune dépendance npm ajoutée.
4. Aucune régression de l'E2E Playwright existant (le lanceur le lance si concerné).
5. Interfaces de props inchangées (sauf si le lot en est explicitement propriétaire).
6. Commits Conventional Commits ; PR `feat/ux-<lot>` ; doc 06 mise à jour à la clôture du lot.

---

## LOT 1 — Fondation : design system & primitives partagées

**Exigences** : EX-14, EX-13 (centralisation), socle de EX-01/07/09/12.
**Nature** : surtout des **fichiers nouveaux** + `styles.css`. Faible risque de conflit.

**Fichiers possédés :**

- `apps/web/src/styles.css` (tokens, états, classes réutilisables)
- `apps/web/src/ui/EtatVide.tsx` _(nouveau)_ — état vide/erreur avec titre + action(s)
- `apps/web/src/ui/Modale.tsx` _(nouveau)_ — dialog accessible (focus-trap, Échap, overlay)
- `apps/web/src/ui/Badge.tsx` _(nouveau)_ — badge (dont « SIMULATION »)
- `apps/web/src/ui/StatutSauvegarde.tsx` _(nouveau)_ — badge idle/enregistré/erreur
- `apps/web/src/ui/Spinner.tsx` _(nouveau)_ — indicateur de chargement (`role="status"`)
- `apps/web/src/hooks/useTitrePage.ts` _(nouveau)_ — met à jour `document.title`
- `apps/web/src/utils/libelles.ts` _(nouveau)_ — `LIBELLES_MODE` unique (accentué)
- `apps/web/src/utils/couleurs.ts` _(nouveau)_ — couleurs de mode lues depuis les tokens CSS
- `apps/web/src/utils/dates.ts` (existant) — ajouter `formaterDateFr(iso)` si absent
- `.test.tsx`/`.test.ts` voisins des nouveaux fichiers

**Tâches :**

1. **Tokens CSS** dans `:root` : palette complète (bleu/rouge/vert/bordure/gris + violet
   périscolaire `#7c3aed`, ambre ALSH `#b45309`), échelle d'espacement (`--esp-1..6`),
   tailles de titres (`h1:1.5rem`, `h2:1.15rem`, `h3:1rem`).
2. **États & classes** : `.btn:hover/:active` + transition ; `.btn.secondaire:hover` ;
   `.app-header a.active` (lien actif) ; `.onglet`/`.onglet.actif` (avec `flex-wrap` parent) ;
   `.modal-overlay`/`.modal` (+ `box-shadow`) ; `.badge`/`.badge-simulation` ;
   `.carte` ombre légère ; `.table-couts-wrap table { min-width }` + règles responsive ;
   `@keyframes spin` ; `.etat-vide`. Décider du sort de `.panneau-cout` (la définir, ex.
   `position:sticky; top:1rem`).
3. **Primitives** : implémenter `EtatVide`, `Modale` (focus-trap + restauration du focus +
   `role="dialog"`/`aria-modal`/`aria-labelledby`, fermeture Échap/overlay), `Badge`,
   `StatutSauvegarde`, `Spinner`. Tests d'accessibilité (focus, Échap, rôles).
4. **Centralisation** : `LIBELLES_MODE` accentué unique ; `couleurs.ts` exposant la couleur
   par mode via `getComputedStyle(--token)` (FullCalendar reçoit du JS) ; `formaterDateFr`.
5. **Hook** `useTitrePage(titre)` (effet + suffixe « — Crèche Planner »).

**DoD spécifique** : primitives testées (rôles ARIA, focus-trap de `Modale`, fermeture Échap).
Ne **branche** encore rien dans les pages (c'est le rôle des lots 2→6).

---

## LOT 2 — Coquille de navigation

**Exigences** : EX-01, EX-02, EX-03, EX-04, EX-05, EX-10 (nav/skip-link/h1 de l'App).
**Dépend de** : Lot 1 (`EtatVide`, `useTitrePage`, classes header).

**Fichiers possédés :**

- `apps/web/src/App.tsx`
- `apps/web/src/hooks/useFoyer.ts`
- `apps/web/src/utils/store.ts`
- `apps/web/src/App.test.tsx` _(nouveau si absent)_

**Tâches :**

1. **Source de vérité URL** (EX-02) : extraire le `foyerId` actif de la route (ex.
   `useMatch('/foyers/:foyerId/*')` ou contexte) ; le header `Entete` dérive ses liens de
   ce `foyerId`, plus de `getFoyerId()`. `localStorage` n'est lu que par `Accueil` (`/`).
2. **NavLink actif** (EX-04) : remplacer les `<Link>` de nav par `<NavLink>` (classe `active`
   - `aria-current`), `end` sur la marque. Style fourni par Lot 1.
3. **404 réelle** (EX-03) : route `*` → composant « Page introuvable » (liens explicites)
   au lieu de `<Navigate to="/">`.
4. **Foyer introuvable** (EX-01) : exposer l'erreur de `useFoyer` (distinguer 404 vs 5xx) et,
   dans les pages OU via un garde de route, afficher `EtatVide` adapté (CTA « Créer un foyer »,
   « Revenir à mon foyer », « Réessayer »). _Choix d'implémentation : un wrapper de route
   `<GardeFoyer>` qui charge le foyer et rend `EtatVide` sur 404/5xx, sinon les enfants — évite
   de dupliquer la logique dans chaque page et garde les pages (lots 3/5/6) hors de ce sujet._
5. **Landmarks** (EX-10) : `<nav aria-label="Navigation principale">` + skip-link vers `<main id="contenu">`.
6. **Titres** (EX-05) : câbler `useTitrePage` (ou le poser dans chaque page — à arbitrer ;
   si posé dans les pages, le noter pour les lots 3/5/6 qui les possèdent).

> ⚠️ Si EX-05 est implémenté **dans les pages**, le Lot 2 ne fait que fournir le hook (déjà
> en Lot 1) ; chaque page l'appelle dans son propre lot. Pour éviter un couplage, **préférer**
> le titre câblé par page → Lot 2 ne touche pas aux fichiers de page.

---

## LOT 3 — Page Planning (onglets, URL, états vides, libellés)

**Exigences** : EX-06, EX-07, EX-10 (onglets ARIA), EX-13 (libellés planning), EX-05 (titre).
**Dépend de** : Lot 1 (`EtatVide`, `LIBELLES_MODE`, `useTitrePage`, classes `.onglet`).

**Fichiers possédés :**

- `apps/web/src/planning/PlanningPage.tsx`
- `apps/web/src/planning/usePlanning.ts` (si besoin pour l'état URL)
- `apps/web/src/planning/PlanningPage.test.tsx`

**Tâches :**

1. **Mois dans l'URL** (EX-06) : porter `mois` via `useSearchParams` (comme `simule`) ;
   restauration au rechargement/retour. Idéalement l'onglet enfant/mode actif aussi.
2. **Onglets accessibles** (EX-10/CA4) : `aria-selected`/`aria-current` + `type="button"`,
   classes `.onglet`/`.onglet.actif` (Lot 1), `flex-wrap`.
3. **États vides** (EX-07) : remplacer les messages morts par `EtatVide` avec CTA
   « Créer un contrat » (→ `/foyers/:id/contrats`).
4. **Libellés** (EX-13) : utiliser `LIBELLES_MODE` (accentué) ; supprimer les libellés ASCII
   locaux (« Creche PSU », « Periscolaire »…). Badge « SIMULATION » via `Badge` (Lot 1).
5. **Titre** (EX-05) : `useTitrePage('Planning')`.

> Ne modifie **pas** les calendriers (Lot 4) ni le panneau coût (Lot 6) : seulement la page
> conteneur et le passage de props (inchangées).

---

## LOT 4 — Calendriers (accessibilité, modales, clavier, dates, couleurs)

**Exigences** : EX-08, EX-09, EX-13 (accents/dates dans les calendriers), EX-14 (couleurs tokens).
**Dépend de** : Lot 1 (`Modale`, `StatutSauvegarde`, `couleurs.ts`, `formaterDateFr`, `LIBELLES_MODE`).

**Fichiers possédés :**

- `apps/web/src/planning/CalendrierCreche.tsx`
- `apps/web/src/planning/CalendrierAbcm.tsx`
- `apps/web/src/planning/CalendrierCreche.test.tsx`
- `apps/web/src/planning/CalendrierAbcm.test.tsx`

**Tâches :**

1. **Modales accessibles** (EX-09) : remplacer les overlays inline par `Modale` (Lot 1) —
   `role="dialog"`, focus-trap, Échap, restauration du focus.
2. **Saisie clavier** (EX-08) : fournir une alternative clavier à `dateClick` (cellules
   focusables `tabindex` + `Enter`/`Espace`, ou liste de jours avec bouton « Saisir »).
   Vérifier le parcours « absence prévenue » au clavier.
3. **Couleurs** (EX-14) : remplacer les hexadécimaux en dur par `couleurs.ts` (tokens).
4. **Dates & libellés** (EX-13) : `formaterDateFr` pour les titres de modale et en-têtes
   (`Absence du 15/06/2026`) ; accents partout (« Enregistré », « Durée », « Préavis »,
   « Journée », « Demi-journée », « individualisé »…). Statut de sauvegarde via `StatutSauvegarde`.
5. `type="button"` sur les boutons de modale.

---

## LOT 5 — Formulaires (validation a11y, succès, défauts démo)

**Exigences** : EX-11, EX-12, EX-13 (libellés contrats), EX-16 (scope ABCM, key enfants), EX-05.
**Dépend de** : Lot 1 (`Badge`/statut, classes, `LIBELLES_MODE`, `Spinner`).

**Fichiers possédés :**

- `apps/web/src/foyer/ContratForm.tsx`
- `apps/web/src/foyer/FoyerFormPage.tsx`
- `apps/web/src/foyer/ContratsPage.tsx`
- `apps/web/src/foyer/useContrats.ts`
- les `.test.tsx` voisins (`ContratForm`, `FoyerFormPage`, `ContratsPage`)

**Tâches :**

1. **Validation liée** (EX-11) : `aria-invalid` + `aria-describedby` champ↔message (id par message) ;
   marquer les champs obligatoires (astérisque + légende / `aria-required`).
2. **Succès** (EX-12) : message transitoire `role="status"` après création/édition/suppression
   (contrat, foyer).
3. **Défauts démo** (EX-11/CA3) : retirer les valeurs Mia/Zoé/montants en dur (ou flag démo).
4. **Libellés** (EX-13) : `LIBELLES_MODE` partout ; pas de mode brut.
5. **Finitions** (EX-16) : `scope="col"`/`<th scope="row">` sur le tableau ABCM ; `key` stable
   (id par ligne d'enfant au lieu de `key={i}`).
6. **Titres** (EX-05) : `useTitrePage('Contrats')` / `'Nouveau foyer'`.

> La suppression reste sur `window.confirm` (acceptable) — peut être migrée vers `Modale` en Lot 7
> si souhaité ; ne pas le faire ici pour rester dans le périmètre.

---

## LOT 6 — Coûts (responsive, sémantique tableau, titres, libellés)

**Exigences** : EX-15 (tableau annuel), EX-13 (mode brut/dates), EX-10 (h1/h3), EX-16, EX-05.
**Dépend de** : Lot 1 (classes `.table-couts-wrap`, `LIBELLES_MODE`, `Spinner`, `Badge`).

**Fichiers possédés :**

- `apps/web/src/couts/CoutsAnnuelsPage.tsx`
- `apps/web/src/couts/PanneauCoutMois.tsx`
- `apps/web/src/couts/useCouts.ts`
- `apps/web/src/couts/CoutsAnnuelsPage.test.tsx`
- `apps/web/src/couts/PanneauCoutMois.test.tsx`

**Tâches :**

1. **Responsive** (EX-15) : conteneur `overflow-x` + `min-width` table (classes Lot 1).
2. **Sémantique** (EX-16) : `scope="col"` sur en-têtes, `<th scope="row">` sur la colonne Mois ;
   `aria-live`/`Spinner` sur les chargements.
3. **Titres** (EX-10) : `<h1>` « Coûts annuels » ; pas de saut de niveau (panneau en `h2/h3`).
4. **Libellés** (EX-13) : `PanneauCoutMois` affiche `LIBELLES_MODE[mode]` (pas `CRECHE_PSU`) ;
   dates en `formaterDateFr` ; badge « SIMULATION » via `Badge`. Conserver les préfixes signés
   (pas d'info par couleur seule).
5. **Titre page** (EX-05) : `useTitrePage('Coûts annuels')`.

---

## LOT 7 — Polish & intégration finale

**Exigences** : EX-16 restants + vérif transverse.
**Dépend de** : merge des lots 2→6.

**Fichiers possédés :** ceux non encore traités + ajustements transverses légers
(`styles.css` retouches mineures, breadcrumb optionnel dans `App.tsx`).

**Tâches :**

1. Fil d'Ariane léger / rappel du foyer courant (optionnel, EX-16).
2. Uniformisation finale des liens inter-pages (s'appuyer sur le header NavLink).
3. (Option) Migrer `window.confirm` de suppression vers `Modale`.
4. **Intégration** : `pnpm nx run-many -t lint typecheck test build` sur les 13 projets ;
   relancer l'E2E Playwright `apps/web` ; revue d'accessibilité manuelle au clavier du parcours
   complet (créer foyer → contrat → planifier absence/ALSH → lire coût).
5. Mettre à jour la **doc 06** (§ Phase 10) et cocher la DoD de la doc 05.

---

## 4. Lancement des sessions (procédure)

1. **Session Lot 1** d'abord, seule. Merger sa PR.
2. Une fois Lot 1 sur `main`, lancer **en parallèle** les sessions Lots 2, 3, 4, 5, 6 (chacune
   sur sa branche, fichiers disjoints → pas de conflit).
3. Merger les PR 2→6 (ordre indifférent ; CI verte par PR).
4. **Session Lot 7** en dernier, pour le polish transverse et l'intégration.

Chaque session démarre par le **prompt de lancement** ci-dessous (§5), à coller tel quel.

## 5. Prompts de lancement (à coller dans chaque session)

> Préambule commun à coller en tête de **chaque** prompt :
>
> « Projet `creche-planner` (Nx monorepo, front `apps/web` React 18 + Vite). Lis d'abord
> `docs/07-spec-ux-navigation.md` et `docs/08-plan-implementation-ux.md`. Tu réalises **uniquement
> le lot indiqué** : ne modifie **que** les fichiers listés pour ce lot. Front-only, aucune
> dépendance npm, interfaces de props stables. Respecte les standards `docs/03`. Travaille en TDD
> quand pertinent. Termine par `pnpm nx run web:lint web:typecheck web:test web:build` vert. Crée
> une branche `feat/ux-<lot>` et ouvre une PR. »

- **Lot 1** : « …Réalise le **LOT 1 — Fondation** (§ doc 08). Crée les tokens CSS, les classes
  réutilisables et les primitives `EtatVide`/`Modale`/`Badge`/`StatutSauvegarde`/`Spinner`, le hook
  `useTitrePage`, et les utils `libelles.ts`/`couleurs.ts`/`formaterDateFr`. Ne branche encore rien
  dans les pages. Teste les primitives (rôles ARIA, focus-trap, Échap). »
- **Lot 2** : « …Réalise le **LOT 2 — Coquille de navigation**. Fichiers : `App.tsx`,
  `hooks/useFoyer.ts`, `utils/store.ts`. Couvre EX-01/02/03/04/05/10. »
- **Lot 3** : « …Réalise le **LOT 3 — Page Planning**. Fichiers : `planning/PlanningPage.tsx`
  (+ `usePlanning.ts` si besoin). Couvre EX-06/07/10/13/05. Ne touche pas aux calendriers. »
- **Lot 4** : « …Réalise le **LOT 4 — Calendriers**. Fichiers : `planning/CalendrierCreche.tsx`,
  `planning/CalendrierAbcm.tsx`. Couvre EX-08/09/13/14. »
- **Lot 5** : « …Réalise le **LOT 5 — Formulaires**. Fichiers : `foyer/ContratForm.tsx`,
  `foyer/FoyerFormPage.tsx`, `foyer/ContratsPage.tsx`, `foyer/useContrats.ts`. Couvre EX-11/12/13/16/05. »
- **Lot 6** : « …Réalise le **LOT 6 — Coûts**. Fichiers : `couts/CoutsAnnuelsPage.tsx`,
  `couts/PanneauCoutMois.tsx`, `couts/useCouts.ts`. Couvre EX-15/13/10/16/05. »
- **Lot 7** : « …Réalise le **LOT 7 — Polish & intégration** après merge des lots 2→6. Finitions
  EX-16, breadcrumb optionnel, run-many + E2E + revue clavier, mise à jour doc 06. »

## 6. Risques & parades

| Risque                                          | Parade                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| Conflit sur `styles.css` (touché par plusieurs) | **Seul le Lot 1** édite `styles.css` ; lots 2→6 n'utilisent que des classes.          |
| `document.title` câblé à 2 endroits             | Décision : titre **posé par page** (lots 2/3/5/6), hook fourni par Lot 1.             |
| Changement de props entre page et enfant        | Interfaces de props **gelées** ; tout besoin de prop nouvelle → Lot 7.                |
| Régression du calcul / contrat d'API            | Périmètre **front-only** strict ; E2E + pacts inchangés = garde-fou.                  |
| `Modale` insuffisante pour un cas calendrier    | Lot 1 livre `Modale` générique ; le Lot 4 peut l'étendre par props, pas la dupliquer. |
