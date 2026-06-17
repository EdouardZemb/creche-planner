# 11 — Spécification : accessibilité AA & utilisabilité (audit CT-UT)

> Statut : **À valider** · Version 0.1 · 2026-06-04
> Décrit le _quoi_ et le _pourquoi_ des corrections d'**utilisabilité** et d'**accessibilité**
> de `apps/web` issues d'un audit mené au prisme **ISTQB® CT-UT** (Certified Tester – Usability
> Tester). Le _comment_ (lots, fichiers, prompts) est dans la [doc 12](12-plan-implementation-accessibilite.md).
> Fait suite à la [doc 07](07-spec-ux-navigation.md) (Phase 10, livrée) : on **ferme les écarts
> résiduels** pour atteindre un **WCAG 2.1 AA** crédible.

## 1. Contexte & motivation

Après la Phase 10 (refonte UX/navigation, design system, primitives accessibles), un **audit
d'utilisabilité statique** (2026-06-04) a évalué `apps/web` selon le cadre **CT-UT** :
**ISO 9241-11** (efficacité / efficience / satisfaction), **heuristiques de Nielsen** et
**WCAG 2.1**. Verdict : socle **mature et inhabituellement soigné** (zéro impasse de navigation,
modale et formulaires accessibles, alternative clavier au calendrier, design system cohérent).

**Score global : 82/100** — sous-scores : Efficacité 88, Efficience 80, Satisfaction 84,
Accessibilité 78. **WCAG : niveau A atteint, AA quasi atteint.** Les écarts restants sont de
**sévérité 0–3** (échelle Nielsen), aucun bloquant. Deux écarts **structurants** empêchent de
revendiquer AA : le **pattern `tablist` incomplet** et l'**absence de gestion du focus au
changement de route**.

Objectif de ce lot : **atteindre WCAG 2.1 AA** et lever les irritants d'efficience/cohérence
relevés, en restant **front-only** et sans toucher au calcul ni aux contrats d'API.

## 2. Périmètre

### Dans le périmètre

- **Accessibilité WCAG 2.1 AA** : pattern d'onglets complet, focus/annonce au changement de
  route, liaison erreur↔champ manquante, noms accessibles de boutons répétés.
- **Cohérence d'interaction** : remplacer `window.confirm()` natif par la `Modale` accessible
  existante ; messages d'erreur **actionnables**.
- **Efficience** : persistance des absences au changement de mois, saisie d'absences en lot,
  aide contextuelle pour les sigles métier.
- **Correction d'un bug fonctionnel** repéré pendant l'audit (colonne ALSH écrivant dans le champ
  cantine).

### Hors périmètre

- Toute modification du **calcul de coût** (`libs/*-domain`, services) ou de **contrat d'API**
  (BFF `/api/v1`, pacts, DTO `libs/contracts`).
- Refonte graphique « marque » ; internationalisation multilingue (l'app reste francophone).
- Nouvelles fonctionnalités métier (US-01..07 doc 01 inchangées) — la **saisie en lot** (UT-07)
  est une amélioration d'efficience de l'existant, pas une nouvelle US.
- Les exigences EX-01..16 de la doc 07 (déjà livrées en Phase 10) ne sont **pas** rejouées ici.

> ⚠️ **Contrainte forte** : **front-only** (`apps/web/src`). Aucune dépendance npm nouvelle sans
> justification ; interfaces de props stables (permet le travail en lots parallèles, cf. doc 12).

## 3. Principes directeurs (CT-UT)

1. **Conformité prouvée, pas supposée.** Chaque correction WCAG se valide par un **test**
   (rôle/attribut ARIA, focus, navigation clavier), pas seulement à l'œil.
2. **Pattern ARIA complet ou pas de pattern.** Un motif d'onglets partiel trompe les lecteurs
   d'écran ; on le **complète** (tabpanel/aria-controls/flèches) ou on le **réduit** à des boutons
   simples honnêtes (`aria-pressed`).
3. **Cohérence d'interaction.** Une même action (confirmer une suppression) utilise le **même
   composant** partout (la `Modale` maison), pas un mélange natif/maison.
4. **Message d'erreur = diagnostic + remède.** Un message doit dire **quoi** corriger et **où**,
   en langage clair (heuristique Nielsen #9).
5. **Ne pas perdre le travail de l'utilisateur.** Un changement de contexte (mois) ne doit pas
   effacer une saisie en cours (efficience).
6. **Reconnaissance plutôt que rappel.** Les sigles métier (RFR, PSU, ABCM, ALSH) sont
   explicités sur place (heuristique #6).

## 4. Exigences

Chaque exigence porte une **sévérité Nielsen** issue de l'audit (🔴 Sév. 3 · 🟠 Sév. 2 ·
🟡 Sév. 1 · ⚪ Sév. 0) et des **critères d'acceptation (CA)** testables. Les références WCAG
sont indiquées quand applicable.

### UT-01 — Pattern d'onglets accessible complet 🔴 (WCAG 4.1.2 / 1.3.1)

Les onglets enfant/mode du planning exposent un `role="tablist"`/`tab`/`aria-selected` **partiel**
(`PlanningPage.tsx`) : sans `tabpanel`/`aria-controls`/navigation clavier, ils **trompent** les
lecteurs d'écran — parfois pire que pas de rôle.

- **CA1** Chaque onglet (`role="tab"`) porte un `id` et un `aria-controls` pointant un
  `role="tabpanel"` correspondant (lui-même `aria-labelledby` vers l'onglet).
- **CA2** La navigation au **clavier** suit le motif ARIA Tabs (flèches gauche/droite pour
  changer d'onglet, `Home`/`End` optionnels) ; un seul onglet est `tabindex="0"` à la fois.
- **CA3** _Alternative acceptée_ : si le motif tabs complet est jugé trop lourd, **réduire** à des
  `<button type="button" aria-pressed>` honnêtes — mais **pas** de motif tabs partiel.

### UT-02 — Focus & annonce au changement de route 🔴 (WCAG 2.4.3)

En SPA, `App.tsx` ne déplace pas le focus ni n'annonce le changement de page : un utilisateur
lecteur d'écran reste sur le lien cliqué.

- **CA1** À chaque navigation, le focus est déplacé vers le `<h1>` de la nouvelle page (ou vers
  `<main>`), de façon programmatique (`tabindex="-1"` + `focus()`).
- **CA2** Le changement de page est **annoncé** via une région live (`aria-live="polite"`) — par
  ex. le titre de page courant.
- **CA3** Le **lien d'évitement** existant (« Aller au contenu ») continue de fonctionner.

### UT-03 — Confirmation de suppression via `Modale` accessible 🟠

La suppression de contrat utilise `window.confirm()` natif (`ContratsPage.tsx`) alors qu'une
`Modale` accessible et stylée existe (rupture de cohérence et de marque, heuristique #4).

- **CA1** La suppression d'un contrat (et toute autre action destructive) ouvre la **`Modale`**
  maison (`role="dialog"`, focus-trap, Échap/overlay), pas `window.confirm()`.
- **CA2** La modale propose une action **primaire destructive** clairement nommée
  (« Supprimer le contrat ») et une action **secondaire** « Annuler » ; le focus initial est sur
  « Annuler ».
- **CA3** Aucune régression du parcours de suppression (l'appel BFF et le retour à la liste
  restent identiques).

### UT-04 — Messages d'erreur actionnables 🟠 (heuristique #9, WCAG 3.3.1/3.3.3)

Le message « Données invalides : vérifiez votre saisie » (`utils/erreurs.ts`) n'indique **pas le
champ** quand le BFF ne renvoie pas d'erreurs structurées.

- **CA1** Quand le BFF renvoie des erreurs **par champ**, elles restent affichées **inline**
  (déjà le cas) via `aria-describedby` ; **CA inchangé**, à préserver.
- **CA2** Quand le BFF ne renvoie **pas** de détail par champ, le message générique **oriente**
  l'utilisateur (ex. « Vérifiez les champs marqués / la section X ») et le focus est porté sur la
  **première section concernée** plutôt que de rester muet.
- **CA3** Le message d'erreur bloquant reste annoncé via `role="alert"`.

### UT-05 — Liaison erreur↔champ manquante 🟡 (WCAG 1.3.1/3.3.1)

Le `<span role="alert">` d'erreur du champ `nbEnfantsACharge` (`FoyerFormPage.tsx`) n'a **pas
d'`id`**, donc n'est pas rattaché par `aria-describedby` (contrairement aux autres champs).

- **CA1** Le message d'erreur de `nbEnfantsACharge` porte un `id` (via le même helper `idErreur`
  que les autres champs) et le champ le référence en `aria-describedby`.
- **CA2** Un test vérifie l'association `aria-describedby` → `id` du message pour ce champ.

### UT-06 — Noms accessibles des boutons répétés 🟡 (WCAG 4.1.2)

Le bouton « Retirer » un enfant (`FoyerFormPage.tsx`) a un libellé **générique répété**, sans
nom unique (contrairement aux boutons contrats qui sont nommés).

- **CA1** Chaque bouton « Retirer » porte un `aria-label` contextuel
  (« Retirer l'enfant Mia » / « Retirer cet enfant » si le prénom est vide).
- **CA2** Un test vérifie l'unicité/contextualisation du nom accessible.

### UT-07 — Persistance & saisie en lot des absences 🟠 (efficience)

La saisie d'absence se fait **jour par jour** (`CalendrierCreche.tsx`) et l'état local `absences`
(`useState` non persisté) est **perdu au changement de mois**.

- **CA1** Changer de mois **ne perd plus** les absences saisies (persistance par (contrat, mois),
  ou rechargement depuis la source de vérité).
- **CA2** Une **saisie en lot** est possible (multi-sélection de jours ou « appliquer à la
  semaine type ») réduisant le nombre d'interactions pour un mois complet.
- **CA3** La saisie en lot reste **accessible au clavier** (cohérent EX-08 déjà livré).

### UT-08 — Aide contextuelle pour les sigles métier 🟡 (heuristique #6/#10)

Aucune aide en ligne n'explicite les sigles **RFR, PSU, ABCM, ALSH** côté utilisateur.

- **CA1** Les sigles affichés sont explicités sur place (`<abbr title>` et/ou tooltip accessible,
  ou une légende/aide contextuelle), au moins à leur première occurrence par écran.
- **CA2** L'aide est **atteignable au clavier** et exposée aux lecteurs d'écran.

### UT-09 — Information non portée par la couleur seule ⚪ (WCAG 1.4.1)

Le delta de coût est distingué surtout par la couleur (vert/rouge), atténué par le signe `+`/`-`
(`utils/money.ts`).

- **CA1** Le préfixe signé (`+`/`-`) est **conservé** (déjà conforme pour le delta positif/négatif).
- **CA2** _Amélioration optionnelle_ : ajouter un repère non coloré (▲/▼ ou libellé
  « économie/dépassement ») pour le cas d'égalité et renforcer la redondance.

### UT-10 — Correction du bug ALSH/cantine 🟠 (bug fonctionnel hors UX)

Repéré pendant l'audit : dans `ContratForm.tsx` (AbcmEditor), la colonne « Inscrit ALSH » écrit
dans le champ `insc.cantine` au lieu d'un champ ALSH dédié.

- **CA1** La colonne « Inscrit ALSH » écrit dans le **champ ALSH** attendu par le contrat de
  données, pas dans `cantine` ; vérifié vs le DTO de `ContratForm`.
- **CA2** Un test couvre la saisie ALSH → bon champ ; aucune régression de la saisie cantine.
- **CA3** Aucune modification de contrat d'API (correction **front** d'un mauvais binding) ; si la
  cause est en amont (DTO BFF), **documenter** l'écart sans changer le contrat (hors périmètre).

## 5. Critères de succès produit

1. **WCAG 2.1 AA crédible** : pattern onglets complet (UT-01) + focus/annonce de route (UT-02) +
   liaisons erreur↔champ complètes (UT-05) — les deux échecs structurants AA levés.
2. **Cohérence d'interaction** : plus de `window.confirm()` ; confirmation par `Modale` (UT-03).
3. **Erreurs utiles** : messages actionnables, focus porté sur la zone concernée (UT-04).
4. **Efficience** : absences persistées + saisie en lot (UT-07) ; sigles explicités (UT-08).
5. **Correction fonctionnelle** : ALSH écrit dans le bon champ (UT-10).
6. **Non-régression** : `nx run-many -t lint typecheck test build` vert sur les 13 projets ;
   E2E Playwright vert ; **aucune modification du calcul ni des contrats d'API**.

## 6. Méthodes de validation recommandées (CT-UT)

La revue statique ne tranche pas tout ; pour valider l'impact réel, appliquer :

1. **Inspection d'utilisabilité multi-évaluateurs** sur les flux planning/coûts (lever la
   subjectivité de la revue heuristique).
2. **Test d'utilisabilité modéré** (5–8 gestionnaires de crèche / courtiers) : mesurer
   l'**efficience réelle** (temps de saisie d'un mois d'absences avant/après UT-07) et la
   compréhension des sigles (UT-08).
3. **Test d'accessibilité assisté** : audit automatisé **axe-core/Lighthouse** sur l'app servie +
   **test manuel lecteur d'écran** (NVDA + VoiceOver) ciblant les onglets (UT-01) et la
   navigation entre routes (UT-02).
4. **Test au clavier seul** de bout en bout (calendrier, modales, onglets, saisie en lot).
5. **Questionnaire SUS** (System Usability Scale) post-tâche pour chiffrer la Satisfaction.
6. **Test de contraste instrumenté** sur l'app rendue (tokens CSS lus dynamiquement) pour
   confirmer les ratios `--gris`/`--muted` aux tailles de police réelles.

## 7. Traçabilité audit → exigences

| Constat d'audit (sévérité Nielsen)                       | Exigence(s) |
| -------------------------------------------------------- | ----------- |
| Sév. 3 — pattern tablist incomplet (`PlanningPage`)      | UT-01       |
| Sév. 3 — pas de focus/annonce au changement de route     | UT-02       |
| Sév. 2 — `window.confirm()` natif vs `Modale`            | UT-03       |
| Sév. 2 — message « Données invalides » non actionnable   | UT-04       |
| Sév. 2 — absences perdues au changement de mois          | UT-07       |
| Sév. 1 — `<span>` erreur `nbEnfantsACharge` sans `id`    | UT-05       |
| Sév. 1 — bouton « Retirer » enfant sans nom unique       | UT-06       |
| Sév. 1 — aucune aide contextuelle pour les sigles métier | UT-08       |
| Sév. 1 — saisie d'absences répétitive (jour par jour)    | UT-07       |
| Sév. 0 — delta distingué surtout par la couleur          | UT-09       |
| Bug fonctionnel — colonne ALSH écrit dans `cantine`      | UT-10       |
