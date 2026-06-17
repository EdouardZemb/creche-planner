# 07 — Spécification UX, navigation & interface

> Statut : **À valider** · Version 0.1 · 2026-06-04
> Décrit le _quoi_ et le _pourquoi_ des améliorations d'**expérience utilisateur**,
> de **navigation** et d'**interface** de `apps/web`. Le _comment_ (découpage en lots,
> fichiers, prompts de session) est dans la [doc 08](08-plan-implementation-ux.md).
> Complète la spec fonctionnelle (doc 01) sans la remplacer : le _métier_ est inchangé,
> on traite ici la **forme** (parcours, orientation, accessibilité, finition visuelle).

## 1. Contexte & motivation

La Phase 8 a livré une interface web fonctionnelle (React 18 + Vite PWA, calendrier
FullCalendar, panneau coût, vue annuelle, simulation) et la Phase 9 a posé une première
couche d'accessibilité/responsive. Un **audit en lecture seule** (2026-06-04, 3 agents :
navigation, design visuel/CSS, accessibilité/UX) a révélé que le socle est sain mais
**inachevé** : impasses de navigation, désynchronisation d'état, fonctions métier
inaccessibles au clavier, et un système de design embryonnaire (≈ 90 % du style en
`style={{}}` inline, états visuels manquants).

Objectif de ce lot : faire passer l'outil de _« fonctionne »_ à _« agréable et fiable
au quotidien »_, sans toucher au calcul ni à l'architecture microservices.

## 2. Périmètre

### Dans le périmètre

- **Navigation** : routing robuste (404, foyer introuvable), source de vérité unique du
  foyer courant, indication de la page active, titres de page, état deep-linkable.
- **Accessibilité (WCAG 2.1 AA visé)** : clavier, focus, modales, sémantique (landmarks,
  titres, onglets, tableaux), liaison erreur↔champ, messages de statut.
- **Système de design** : tokens CSS, états (hover/active/focus/disabled/loading/vide),
  factorisation de l'inline vers des classes, primitives réutilisables (modale, état vide,
  badge, statut de sauvegarde), responsive des tableaux/calendriers.
- **Cohérence de contenu** : libellés (accents), formatage des dates/montants (i18n fr-FR).

### Hors périmètre

- Toute modification du **calcul de coût** (`libs/*-domain`, services) — interdit.
- Tout changement de **contrat d'API** (BFF `/api/v1`, pacts, DTO `libs/contracts`).
- Refonte graphique « marque » (charte, logo, illustrations) — backlog ultérieur.
- Internationalisation multilingue (l'app reste **francophone**).
- Nouvelles fonctionnalités métier (US-01..07 doc 01 inchangées).

> ⚠️ **Contrainte forte** : ces améliorations sont **front-only** (`apps/web/src`). Aucune
> dépendance npm nouvelle sans justification (cohérent Phases 7/8/9 : tout fait main).
> Les interfaces de props entre composants restent **stables** (permet le travail en lots
> parallèles, cf. doc 08).

## 3. Principes UX directeurs

1. **Pas d'impasse.** Tout état d'erreur ou vide propose une **action de sortie** (lien/bouton).
2. **L'URL est la source de vérité.** Le `foyerId` de la route pilote tout ; `localStorage`
   ne sert qu'à restaurer le dernier foyer à la racine `/`.
3. **Tout est faisable au clavier.** Aucune fonction métier ne dépend exclusivement de la souris.
4. **Le système avant l'instance.** On crée une classe/primitive réutilisable plutôt que de
   répéter du style inline ; on centralise libellés, couleurs et formatages.
5. **Feedback systématique.** Chargement, succès, erreur et vide ont chacun un rendu explicite
   et annoncé aux lecteurs d'écran.
6. **Cohérence.** Mêmes libellés (accentués), mêmes couleurs (tokens), mêmes composants partout.

## 4. Exigences

Chaque exigence porte une **sévérité** issue de l'audit (🔴 critique · 🟠 important · 🟡 mineur)
et des **critères d'acceptation (CA)** testables.

### EX-01 — Foyer introuvable : écran de récupération 🔴

Un `foyerId` d'URL inexistant/supprimé ne doit plus laisser l'utilisateur bloqué.

- **CA1** Ouvrir `/foyers/<inexistant>/planning` affiche un écran « Foyer introuvable »
  avec un bouton primaire **« Créer un nouveau foyer »** (→ `/foyers/new`).
- **CA2** Si un foyer valide existe en `localStorage`, l'écran propose aussi **« Revenir à mon foyer »**.
- **CA3** Une panne réseau (5xx) affiche un message distinct du 404 avec un bouton **« Réessayer »**
  (on ne propose pas « créer un foyer » sur une simple indisponibilité).

### EX-02 — `foyerId` de l'URL = source de vérité unique 🔴

- **CA1** Le header dérive ses liens du `foyerId` de la **route active**, pas de `localStorage`.
- **CA2** Naviguer sur le foyer A (URL) puis cliquer un lien du header reste sur le foyer A.
- **CA3** `localStorage` n'est lu **que** par la redirection racine `/` (restauration initiale).

### EX-03 — Vraie page 404 🟠

- **CA1** Une URL inconnue (`/foyer/x/planing`) affiche « Page introuvable » avec des liens
  explicites (Planning, Contrats, Nouveau foyer), au lieu d'une redirection muette vers `/`.

### EX-04 — Indication de la page active 🟠

- **CA1** Le lien de la page courante dans le header est mis en évidence visuellement **et**
  porte `aria-current="page"` (via `NavLink`).
- **CA2** Le lien « marque » n'est pas marqué actif sur les sous-pages.

### EX-05 — Titre de page (`document.title`) 🟠

- **CA1** Chaque page met à jour le titre de l'onglet (« Planning — Crèche Planner »,
  « Contrats — Crèche Planner », « Coûts annuels — Crèche Planner », « Nouveau foyer — … »).

### EX-06 — État de navigation deep-linkable 🟠

- **CA1** Le **mois** affiché sur le planning est porté par l'URL (query param), partageable
  et restauré au rechargement et au bouton retour navigateur (comme `simule` aujourd'hui).
- **CA2** L'onglet enfant/mode actif est restauré de façon cohérente (URL ou état stable).

### EX-07 — États vides orientés action 🟠

- **CA1** Le planning sans contrat/enfant affiche un état vide avec un CTA **« Créer un contrat »**
  (→ `/foyers/:id/contrats`).
- **CA2** La liste de contrats vide propose le bouton de création visible (pas seulement en bas).

### EX-08 — Saisie absence/ALSH accessible au clavier 🔴

La saisie d'absence (crèche) et de journée ALSH (ABCM) ne doit plus dépendre du seul clic souris.

- **CA1** Il existe une alternative clavier pour ouvrir la saisie d'un jour (cellule focusable +
  `Enter`/`Espace`, ou liste de jours avec bouton par ligne).
- **CA2** Le parcours « saisir une absence prévenue » est réalisable de bout en bout au clavier.

### EX-09 — Modales accessibles 🔴

- **CA1** Chaque modale (absence crèche, journée ALSH) porte `role="dialog"`, `aria-modal="true"`
  et `aria-labelledby` pointant son titre.
- **CA2** Le focus est déplacé dans la modale à l'ouverture et **restauré** sur le déclencheur à
  la fermeture ; il est **piégé** dans la modale tant qu'elle est ouverte.
- **CA3** `Échap` ferme la modale ; un clic sur l'overlay ferme aussi.

### EX-10 — Sémantique & landmarks 🟠

- **CA1** Les liens du header sont dans `<nav aria-label="Navigation principale">`.
- **CA2** Un **lien d'évitement** (« Aller au contenu ») mène au `<main>`.
- **CA3** Chaque page a un `<h1>` unique ; pas de saut de niveau de titre.
- **CA4** Les onglets (enfants/modes) exposent un motif accessible (`aria-selected`/`aria-current`
  ou rôles tablist/tab) et un `type="button"`.

### EX-11 — Validation de formulaire accessible 🟠

- **CA1** Un champ en erreur porte `aria-invalid="true"` et `aria-describedby` vers l'id de son
  message d'erreur.
- **CA2** Les champs obligatoires sont indiqués (astérisque + légende ou `aria-required`).
- **CA3** Les valeurs de démonstration en dur (Mia/Zoé/montants) ne sont plus pré-remplies en
  production (ou derrière un flag de démo).

### EX-12 — Messages de succès 🟠

- **CA1** Après création/modification/suppression (contrat, foyer), un message de succès transitoire
  s'affiche dans une région `role="status"` (`aria-live="polite"`).

### EX-13 — Cohérence des libellés & formats 🟠

- **CA1** Les libellés de mode sont centralisés (un seul `LIBELLES_MODE`) et **accentués** partout
  (« Crèche PSU », « Périscolaire », « Enregistré », « Durée », « Préavis »…). Aucun libellé ASCII
  non accentué visible à l'écran.
- **CA2** Le mode n'est jamais affiché brut (`CRECHE_PSU`) à l'utilisateur.
- **CA3** Les dates affichées le sont au format français (`15/06/2026` ou « 15 juin 2026 »), jamais
  en ISO brut (`2026-06-15`).
- **CA4** Les montants restent formatés via l'util `money` (locale fr-FR), avec préfixe signé pour
  les deltas (pas d'information par la **couleur seule**).

### EX-14 — Système de design (tokens & états) 🟠

- **CA1** Une palette unique de tokens CSS (`:root`) couvre toutes les couleurs, y compris les
  couleurs de mode des calendriers (plus aucun hexadécimal dupliquant un token dans le `.tsx`).
- **CA2** Les boutons et liens-boutons ont des états `:hover` et `:active` (avec transition).
- **CA3** Les onglets, modales, badges, cartes et statut de sauvegarde sont stylés par des **classes**
  réutilisables, pas par du style inline dupliqué.
- **CA4** Une échelle d'espacement et une hiérarchie de titres (`h1/h2/h3`) sont définies en CSS.

### EX-15 — Responsive 🟠

- **CA1** Les tableaux larges (coûts annuels, ABCM du `ContratForm`) ont un conteneur `overflow-x:auto`
  - une `min-width` de table : ils **scrollent** au lieu de se comprimer sur mobile.
- **CA2** Le panneau coût du planning ne provoque pas de débordement entre 769 px et ~950 px (tablette).
- **CA3** Sur mobile (≤ 768 px), les onglets enfants/modes passent à la ligne (`flex-wrap`).

### EX-16 — Finitions (lot polish) 🟡

- **CA1** Classe morte `.panneau-cout` traitée (ajoutée ou retirée) ; `key={i}` de la liste d'enfants
  remplacé par un id stable ; `scope="col"`/`scope="row"` sur les tableaux ; `aria-live` sur les
  indicateurs de chargement ; badge « SIMULATION » unifié ; fil d'Ariane léger / nom de foyer optionnel.

## 5. Critères de succès produit

1. **Aucune impasse** : tout 404/foyer introuvable/état vide offre une sortie (EX-01, 03, 07).
2. **Parcours clavier complet** : créer foyer → contrat → planifier (y compris absence/ALSH) →
   lire le coût, sans souris (EX-08, 09, 10, 11).
3. **Cohérence visible** : zéro libellé non accentué, zéro date ISO, zéro mode brut à l'écran (EX-13).
4. **Finition** : hover/focus partout, états vides/chargement/succès explicites (EX-12, 14).
5. **Non-régression** : `nx run-many -t lint typecheck test build` vert sur les 13 projets ;
   E2E Playwright existant toujours vert ; aucune modification du calcul ni des contrats d'API.

## 6. Traçabilité audit → exigences

| Audit (sévérité)                                | Exigence(s)         |
| ----------------------------------------------- | ------------------- |
| C1 foyerId invalide → impasse                   | EX-01               |
| C2 désync URL ↔ localStorage                    | EX-02               |
| C3 saisie absence/ALSH non clavier              | EX-08               |
| C4 modales non accessibles                      | EX-09               |
| Lien actif / `document.title` / 404 muette      | EX-04, EX-05, EX-03 |
| `mois` hors URL / états vides sans CTA          | EX-06, EX-07        |
| Hover/couleurs/inline/responsive                | EX-14, EX-15        |
| Succès / titres / nav / onglets / erreurs liées | EX-12, EX-10, EX-11 |
| Accents / dates ISO / mode brut                 | EX-13               |
| `scope`/`key`/classe morte/`aria-live`/badge    | EX-16               |
