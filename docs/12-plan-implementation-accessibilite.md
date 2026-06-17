# 12 — Plan d'implémentation : accessibilité AA & utilisabilité (CT-UT)

> Statut : **À valider** · Version 0.1 · 2026-06-04
> Met en œuvre la [spec 11](11-spec-accessibilite-ct-ut.md). Découpé en **lots à fichiers
> disjoints** exécutables dans des **sessions Claude Code indépendantes** (en parallèle quand les
> dépendances le permettent), sans conflit de merge — même principe que la
> [doc 08](08-plan-implementation-ux.md).

## 1. Principe de découpage

- **Front-only.** Tout se passe dans `apps/web/src`. Aucune modification de service, domaine,
  contrat d'API, ni de dépendance npm (sauf justification explicite).
- **Propriété de fichiers exclusive.** Chaque lot **possède** un ensemble de fichiers et ne touche
  **que** ceux-là (+ les `.test.tsx` voisins). Aucun fichier partagé entre deux lots parallèles.
- **Interfaces de props stables.** Les composants gardent leurs signatures ; un lot consomme les
  primitives d'un autre via l'interface existante.
- **Le Lot 1 est une fondation séquentielle.** Il crée les primitives a11y partagées
  (`Abbr`, `ModaleConfirmation`, hooks persistance/annonce) consommées par les lots 2→6.
- **Une branche + une PR par lot** (`feat/a11y-<lot>`), squash merge, CI verte obligatoire.

## 2. Graphe de dépendances

```
            ┌────────────────────────────────────────────┐
            │  LOT 1 — Fondation a11y (primitives + hooks) │  ← séquentiel, à merger d'abord
            └────────────────────────────────────────────┘
                 │        │        │        │        │
        ┌────────┘   ┌────┘   ┌────┘   ┌────┘   └────────┐
        ▼            ▼        ▼        ▼                 ▼
   ┌─────────┐ ┌─────────┐ ┌────────┐ ┌─────────┐ ┌──────────┐
   │ LOT 2   │ │ LOT 3   │ │ LOT 4  │ │ LOT 5   │ │ LOT 6    │   ← parallélisables
   │ Nav/    │ │ Onglets │ │Calendr.│ │ Formul. │ │ Coûts &  │
   │ focus   │ │ planning│ │absences│ │ & confir│ │ sigles   │
   └─────────┘ └─────────┘ └────────┘ └─────────┘ └──────────┘
        └────────────┴─────────┴─────────┴──────────────┘
                              ▼
                     ┌─────────────────┐
                     │ LOT 7 — Intégr. │  ← après merge des lots 2→6
                     └─────────────────┘
```

| Lot | Exigences                         | Dépend de | Parallélisable avec |
| --- | --------------------------------- | --------- | ------------------- |
| 1   | socle UT-03/07/08                 | —         | (seul)              |
| 2   | UT-02                             | 1         | 3, 4, 5, 6          |
| 3   | UT-01                             | 1         | 2, 4, 5, 6          |
| 4   | UT-07                             | 1         | 2, 3, 5, 6          |
| 5   | UT-03, UT-04, UT-05, UT-06, UT-10 | 1         | 2, 3, 4, 6          |
| 6   | UT-08 (coûts), UT-09              | 1         | 2, 3, 4, 5          |
| 7   | vérif transverse + axe-core       | 2→6       | (seul)              |

## 3. Definition of Done commune (tous les lots)

1. CA de la/les exigence(s) couverts par des **tests** (Vitest + Testing Library) verts —
   rôles/attributs ARIA, focus, navigation clavier selon l'exigence.
2. `pnpm nx run web:lint web:typecheck web:test web:build` verts.
3. Aucun fichier hors périmètre du lot modifié ; aucune dépendance npm ajoutée sans justification.
4. Aucune régression de l'E2E Playwright existant.
5. Interfaces de props inchangées (sauf si le lot en est explicitement propriétaire).
6. **Aucune modification du calcul ni des contrats d'API.**
7. Commits Conventional Commits ; PR `feat/a11y-<lot>` ; doc 06 mise à jour à la clôture du lot.

---

## LOT 1 — Fondation a11y : primitives & hooks partagés

**Exigences** : socle de UT-03 (confirmation), UT-07 (persistance), UT-08 (sigles), UT-02 (annonce).
**Nature** : surtout des **fichiers nouveaux**. Faible risque de conflit.

**Fichiers possédés :**

- `apps/web/src/ui/Abbr.tsx` _(nouveau)_ — abréviation accessible (`<abbr title>` + tooltip
  atteignable au clavier/lecteur d'écran)
- `apps/web/src/utils/glossaire.ts` _(nouveau)_ — définitions des sigles (RFR, PSU, ABCM, ALSH…)
- `apps/web/src/ui/ModaleConfirmation.tsx` _(nouveau)_ — wrapper de la `Modale` existante pour une
  **confirmation destructive** (action primaire nommée + « Annuler », focus initial sur « Annuler »)
- `apps/web/src/hooks/useAnnonceRoute.ts` _(nouveau)_ — région live + déplacement de focus au
  changement de route (helper consommé par le Lot 2)
- `apps/web/src/hooks/usePersistanceAbsences.ts` _(nouveau)_ — persistance des absences par
  (contrat, mois) (helper consommé par le Lot 4)
- `.test.tsx`/`.test.ts` voisins des nouveaux fichiers

**Tâches :**

1. `Abbr` : rend `<abbr title="…">` avec un nom accessible ; le titre est **atteignable** au
   clavier (focusable/`tabindex` si tooltip) et exposé aux lecteurs d'écran. Tester le rôle/title.
2. `glossaire.ts` : table unique sigle → libellé long (« RFR » → « Revenu fiscal de référence »,
   « PSU » → « Prestation de service unique », « ABCM », « ALSH »…). Source de vérité unique.
3. `ModaleConfirmation` : s'appuie sur `Modale` (Lot 1 de la Phase 10, **ne pas la dupliquer**) ;
   props `{titre, message, libelleConfirmer, onConfirmer, onAnnuler, destructif?}`. Focus initial
   sur « Annuler ». Tester focus-trap/Échap (hérités) + focus initial.
4. `useAnnonceRoute` : expose une région `aria-live="polite"` et déplace le focus vers une cible
   (`<h1>`/`<main>`, `tabindex="-1"`) à chaque changement de `location.pathname`.
5. `usePersistanceAbsences` : lit/écrit les absences par (contrat, mois) de façon stable au
   changement de mois (la **source** reste l'état applicatif/serveur ; ce hook évite la perte).

**DoD spécifique** : primitives testées (rôles ARIA, focus initial de `ModaleConfirmation`,
annonce de route). Ne **branche** encore rien dans les pages (rôle des lots 2→6).

---

## LOT 2 — Navigation & focus au changement de route

**Exigences** : UT-02 (🔴, WCAG 2.4.3). **Dépend de** : Lot 1 (`useAnnonceRoute`).

**Fichiers possédés :**

- `apps/web/src/App.tsx`
- `apps/web/src/App.test.tsx`

**Tâches :**

1. Câbler `useAnnonceRoute` : à chaque navigation, **déplacer le focus** vers le `<h1>` de la page
   (ou `<main id="contenu">`, `tabindex="-1"`) — CA1.
2. **Annoncer** le changement de page via la région live (titre courant) — CA2.
3. Préserver le **lien d'évitement** existant (« Aller au contenu ») — CA3.
4. Tests : après une navigation simulée, le focus est sur le titre et l'annonce est émise.

> Ne touche **pas** aux pages (lots 3/5/6) : seulement la coquille `App.tsx`.

---

## LOT 3 — Onglets accessibles du planning

**Exigences** : UT-01 (🔴, WCAG 4.1.2/1.3.1). **Dépend de** : Lot 1 (aucune primitive requise,
mais merge après pour éviter le rebase).

**Fichiers possédés :**

- `apps/web/src/planning/PlanningPage.tsx`
- `apps/web/src/planning/PlanningPage.test.tsx`

**Tâches :**

1. **Compléter** le motif ARIA Tabs : chaque `role="tab"` reçoit `id` + `aria-controls` ; le
   contenu associé devient `role="tabpanel"` `aria-labelledby` vers l'onglet — CA1.
2. **Navigation clavier** : flèches gauche/droite (Home/End optionnels) ; un seul onglet
   `tabindex="0"` (roving tabindex) — CA2.
3. _Alternative documentée_ : si le motif complet est trop lourd, **réduire** à
   `<button type="button" aria-pressed>` (pas de motif partiel) — CA3.
4. Tests : rôles/attributs, navigation flèches, focus géré.

> Ne modifie **pas** les calendriers (Lot 4) ni le panneau coût (Lot 6) ; props inchangées.

---

## LOT 4 — Persistance & saisie en lot des absences

**Exigences** : UT-07 (🟠, efficience). **Dépend de** : Lot 1 (`usePersistanceAbsences`).

**Fichiers possédés :**

- `apps/web/src/planning/CalendrierCreche.tsx`
- `apps/web/src/planning/CalendrierCreche.test.tsx`

**Tâches :**

1. **Persistance** : brancher `usePersistanceAbsences` pour qu'un changement de mois **ne perde
   plus** les absences saisies (par (contrat, mois)) — CA1.
2. **Saisie en lot** : permettre une multi-sélection de jours ou « appliquer à la semaine type »,
   réduisant le nombre d'interactions — CA2.
3. **Accessibilité clavier** de la saisie en lot (cohérent EX-08 livré) — CA3.
4. Tests : non-perte au changement de mois, saisie en lot, parcours clavier.

> Ne touche **pas** au `CalendrierAbcm` (hors périmètre de ce lot) ni à `PlanningPage` (Lot 3).

---

## LOT 5 — Formulaires : confirmation, erreurs, liaisons, bug ALSH

**Exigences** : UT-03 (🟠), UT-04 (🟠), UT-05 (🟡), UT-06 (🟡), UT-10 (🟠 bug).
**Dépend de** : Lot 1 (`ModaleConfirmation`, `Abbr`/`glossaire` pour UT-08 côté formulaires).

**Fichiers possédés :**

- `apps/web/src/foyer/ContratsPage.tsx` (UT-03 : remplacer `window.confirm`)
- `apps/web/src/foyer/FoyerFormPage.tsx` (UT-05 liaison erreur, UT-06 nom bouton, UT-08 sigles)
- `apps/web/src/foyer/ContratForm.tsx` (UT-10 bug ALSH/cantine, UT-08 sigles)
- `apps/web/src/foyer/useContrats.ts` (si la suppression y est orchestrée)
- `apps/web/src/utils/erreurs.ts` (UT-04 message actionnable)
- les `.test.tsx` voisins (`ContratsPage`, `FoyerFormPage`, `ContratForm`)

**Tâches :**

1. **UT-03** : remplacer `window.confirm()` de suppression de contrat par `ModaleConfirmation`
   (Lot 1) — action primaire « Supprimer le contrat », focus initial sur « Annuler », parcours
   BFF inchangé.
2. **UT-04** : dans `erreurs.ts`, rendre le message générique **orientant** (champs/section à
   vérifier) ; porter le focus sur la **première section concernée** ; préserver l'inline par
   champ quand le BFF le fournit ; `role="alert"` conservé.
3. **UT-05** : donner un `id` au message d'erreur de `nbEnfantsACharge` (helper `idErreur`) et le
   référencer en `aria-describedby`.
4. **UT-06** : `aria-label` contextuel sur chaque bouton « Retirer » (« Retirer l'enfant Mia »).
5. **UT-10** : corriger le binding AbcmEditor — la colonne « Inscrit ALSH » écrit dans le **champ
   ALSH** attendu (pas `cantine`) ; vérifié vs le DTO ; **sans** changer le contrat d'API (si la
   cause est amont, documenter l'écart).
6. **UT-08 (formulaires)** : envelopper les sigles (RFR/PSU/ABCM/ALSH) dans `Abbr` à leur première
   occurrence dans ces écrans.

> La suppression d'autres entités peut réutiliser `ModaleConfirmation` ; ne pas réintroduire
> `window.confirm` ailleurs.

---

## LOT 6 — Coûts : sigles & information non colorée

**Exigences** : UT-08 (🟡, côté coûts), UT-09 (⚪). **Dépend de** : Lot 1 (`Abbr`/`glossaire`).

**Fichiers possédés :**

- `apps/web/src/couts/PanneauCoutMois.tsx`
- `apps/web/src/couts/CoutsAnnuelsPage.tsx`
- `apps/web/src/utils/money.ts` (UT-09, retouche **optionnelle** du repère non coloré)
- les `.test.tsx` voisins (`PanneauCoutMois`, `CoutsAnnuelsPage`)

**Tâches :**

1. **UT-08 (coûts)** : envelopper les sigles métier des écrans coûts dans `Abbr` (première
   occurrence). Réutilise `glossaire.ts` (Lot 1).
2. **UT-09** : **conserver** le préfixe signé `+`/`-` du delta (CA1) ; _optionnel_ ajouter un
   repère non coloré (▲/▼ ou libellé « économie/dépassement », notamment pour l'égalité) — CA2.
3. Tests : présence du nom accessible des sigles ; redondance non colorée du delta si implémentée.

> `utils/money.ts` n'est touché **que** par ce lot (aucun autre lot ne l'édite) → pas de conflit.

---

## LOT 7 — Intégration & vérification d'accessibilité

**Exigences** : critères de succès produit (spec 11 §5) + méthodes de validation (§6).
**Dépend de** : merge des lots 2→6.

**Fichiers possédés :** ajustements transverses légers + docs.

**Tâches :**

1. `pnpm nx run-many -t lint typecheck test build` vert sur les **13 projets** ; `format:check` OK.
2. Relancer l'**E2E Playwright** `apps/web` (non-régression).
3. **Audit automatisé** `axe-core`/Lighthouse sur l'app servie ; consigner le score AA.
4. **Revue clavier + lecteur d'écran** du parcours complet (créer foyer → contrat → planifier
   absence/ALSH en lot → lire le coût), ciblant onglets (UT-01) et navigation de route (UT-02).
5. Mettre à jour la **doc 06** (§ Phase 12) et cocher la DoD de la **doc 05** (Phase 12) ;
   actualiser le score d'utilisabilité visé (objectif WCAG 2.1 **AA**).

---

## 4. Lancement des sessions (procédure)

1. **Session Lot 1** d'abord, seule. Merger sa PR.
2. Une fois Lot 1 sur `main`, lancer **en parallèle** les sessions Lots 2, 3, 4, 5, 6 (fichiers
   disjoints → pas de conflit).
3. Merger les PR 2→6 (ordre indifférent ; CI verte par PR).
4. **Session Lot 7** en dernier (intégration, axe-core, revue clavier, docs).

## 5. Prompts de lancement (à coller dans chaque session)

> Préambule commun à coller en tête de **chaque** prompt :
>
> « Projet `creche-planner` (Nx monorepo, front `apps/web` React 18 + Vite). Lis d'abord
> `docs/11-spec-accessibilite-ct-ut.md` et `docs/12-plan-implementation-accessibilite.md`. Tu
> réalises **uniquement le lot indiqué** : ne modifie **que** les fichiers listés. Front-only,
> aucune dépendance npm, interfaces de props stables, aucun changement de calcul/contrat d'API.
> Respecte les standards `docs/03`. Travaille en TDD quand pertinent. Termine par `pnpm nx run
web:lint web:typecheck web:test web:build` vert. Crée une branche `feat/a11y-<lot>` et ouvre une PR. »

- **Lot 1** : « …Réalise le **LOT 1 — Fondation a11y**. Crée `ui/Abbr.tsx`, `utils/glossaire.ts`,
  `ui/ModaleConfirmation.tsx` (sur la `Modale` existante), `hooks/useAnnonceRoute.ts`,
  `hooks/usePersistanceAbsences.ts`. Ne branche rien dans les pages. Teste les primitives. »
- **Lot 2** : « …Réalise le **LOT 2 — Navigation & focus de route** (UT-02). Fichier : `App.tsx`.
  Câble `useAnnonceRoute` (focus vers `<h1>`/`<main>` + annonce live). »
- **Lot 3** : « …Réalise le **LOT 3 — Onglets planning** (UT-01). Fichier :
  `planning/PlanningPage.tsx`. Complète le motif ARIA Tabs (tabpanel/aria-controls + flèches) ou
  réduis à des boutons `aria-pressed`. »
- **Lot 4** : « …Réalise le **LOT 4 — Absences** (UT-07). Fichier : `planning/CalendrierCreche.tsx`.
  Persiste les absences au changement de mois (`usePersistanceAbsences`) + saisie en lot accessible. »
- **Lot 5** : « …Réalise le **LOT 5 — Formulaires** (UT-03/04/05/06/10). Fichiers : `foyer/*`,
  `utils/erreurs.ts`. Remplace `window.confirm` par `ModaleConfirmation`, rends les erreurs
  actionnables, lie erreur↔champ `nbEnfantsACharge`, nomme les boutons « Retirer », corrige le bug
  ALSH/cantine, enveloppe les sigles dans `Abbr`. »
- **Lot 6** : « …Réalise le **LOT 6 — Coûts & sigles** (UT-08/09). Fichiers : `couts/*`,
  `utils/money.ts`. Enveloppe les sigles dans `Abbr`, conserve le préfixe signé du delta (+ repère
  non coloré optionnel). »
- **Lot 7** : « …Réalise le **LOT 7 — Intégration** après merge des lots 2→6. run-many + E2E +
  axe-core + revue clavier/lecteur d'écran ; mets à jour docs 05/06. »

## 6. Risques & parades

| Risque                                             | Parade                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Sigles UT-08 sur 2 écrans (foyer + coûts)          | Primitive `Abbr` + `glossaire` au Lot 1 ; chaque lot l'**utilise** dans ses fichiers.   |
| Motif tabs partiel (pire que rien)                 | UT-01 impose **complet ou réduit** (`aria-pressed`), jamais partiel ; test ARIA.        |
| `window.confirm` réintroduit ailleurs              | `ModaleConfirmation` réutilisable (Lot 1) ; revue Lot 7.                                |
| Bug ALSH/cantine masque un défaut de contrat amont | UT-10 corrige le binding **front** ; si cause amont, **documenter** sans toucher l'API. |
| Régression du calcul / contrat d'API               | Périmètre **front-only** strict ; E2E + pacts inchangés = garde-fou.                    |
| Persistance d'absences introduit un état divergent | UT-07 : la **source** reste l'état applicatif/serveur ; le hook évite la perte seule.   |
