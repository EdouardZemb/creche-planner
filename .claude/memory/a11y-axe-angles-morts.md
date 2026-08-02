---
name: a11y-axe-angles-morts
description: "L'audit axe-core e2e peut être vert alors que des contrastes réels échouent — liste des angles morts et méthode de vérification"
metadata:
  node_type: memory
  type: project
  originSessionId: c08e87da-25b6-43d8-8c19-11474fbae2b3
  modified: 2026-07-29T13:05:42.598Z
---

`apps/web/e2e/a11y.e2e.spec.ts` lance axe-core (tags WCAG 2.1 AA, **aucune règle désactivée, aucun `exclude`**) sur ~8 routes et passait au vert alors que plusieurs contrastes échouaient réellement (constaté 2026-07-29).

**Angles morts d'axe à ne PAS confondre avec « conforme »** :

- **Indicateurs de focus** : jamais évalués. L'outline global `:focus-visible` était `--bleu` sur l'en-tête `--bleu` → 1:1, invisible, et axe ne dit rien.
- **Bordures de contrôles** (1.4.11) : `input`/`textarea` à `--bordure` (#e5e7eb) = 1,2:1 — aucune règle axe ne les couvre.
- **Contrôles désactivés** : exemptés par WCAG 1.4.3 (« composants inactifs »), donc axe les ignore — mais un libellé illisible reste un défaut d'UX réel.
- **`opacity` d'ancêtre** : axe classe souvent ces cas en `incomplete`, et le spec ne journalise `incomplete` **sans l'asserter**. C'est ainsi que `.fc-day-other` (0.3 → 1,6:1) et `.etab-carte.est-archive` (0.6) passaient.
- Éléments jamais rendus par les mocks (notification **lue**, établissement **archivé**) : hors de portée par construction.

**Méthode qui a marché** : balayage `getComputedStyle` dans le navigateur (stack Docker + Vite, cf. [[verif-ui-locale-stack]]) — pour chaque nœud texte, composer les `opacity` d'ancêtres, remonter jusqu'au 1er fond opaque, calculer le ratio sRGB. À refaire route par route ET aux 3 largeurs 320 / 375 / 1280 px. Attention : le fond effectif part de **l'élément lui-même** (son propre `background`), pas du parent.

**Piège de spécificité rencontré** : `.app-header a { color: white }` (0,1,1) bat `.skip-link` (0,1,0) — inverser les couleurs du lien d'évitement le rendait blanc sur blanc. Vérifier le rendu **calculé**, pas le CSS écrit.

Lié : [[verif-ui-locale-stack]], [[code-conventions-strict]]
