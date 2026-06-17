# 13 — Validation accessibilité runtime (runbook CT-UT)

> Statut : **Partiellement exécuté** · Version 0.2 · 2026-06-05
> (volet instrumenté 2026-06-05 ✅ · volet humain NVDA/VoiceOver + panel utilisateurs à faire)
> Runbook **actionnable** des méthodes de validation **manuelles** de la
> [spec 11 §6](11-spec-accessibilite-ct-ut.md) — celles que l'automatisation ne couvre pas —
> et clôture du [doc 12 LOT 7](12-plan-implementation-accessibilite.md) (revue clavier +
> lecteur d'écran). L'audit **axe-core automatisé** (§6.3, volet outillé) est traité à part
> dans le spec E2E `apps/web/e2e/a11y.e2e.spec.ts` : on le **référence** sans le redérouler.
> Un testeur doit pouvoir dérouler ce doc **sans relire** toute la spec 11.

## 1. Pré-requis

| Élément                   | Détail                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------- |
| Servir l'app              | `pnpm nx serve web` → ouvrir **http://localhost:4200**                              |
| BFF amont                 | si les écrans coût/contrat appellent l'API, démarrer la stack (`docker compose up`) |
| Navigateur                | Chrome/Edge récent (DevTools) **et** Firefox (recoupement)                          |
| Lecteur d'écran (Windows) | **NVDA** (gratuit) — raccourci `Insert` = touche NVDA                               |
| Lecteur d'écran (macOS)   | **VoiceOver** — `Cmd+F5` pour activer ; `VO` = `Ctrl+Option`                        |
| Audit axe automatisé      | déjà couvert : `pnpm nx e2e web` (spec `apps/web/e2e/a11y.e2e.spec.ts`)             |
| Données de test           | un foyer fictif (≥ 2 enfants), un contrat crèche + un volet ALSH                    |

> Convention : remplir la colonne **OK/KO** au fil de l'eau ; tout KO renvoie à un écart
> consigné en [§9](#9-consignation-des-résultats).

## 2. Test au clavier seul (spec 11 §6.4)

Objectif : dérouler le **parcours complet** (créer foyer → contrat → planifier absence/ALSH
en lot → lire le coût) **sans souris**. Règles transverses : focus **toujours visible**,
ordre de tabulation **logique**, **aucun piège** clavier (on peut toujours sortir avec
`Tab`/`Shift+Tab`/`Échap`).

| #   | Action clavier                                         | Résultat attendu                                                         | OK/KO |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------ | ----- |
| 0   | `Tab` depuis le haut de page                           | 1er arrêt = lien d'évitement « Aller au contenu » (UT-02 CA3)            |       |
| 1   | `Entrée` sur le lien d'évitement                       | focus saute dans `<main>`/`<h1>`                                         |       |
| 2   | `Tab` dans la nav, `Entrée` sur « Foyer »              | navigation ; focus déplacé sur le `<h1>` (UT-02)                         |       |
| 3   | `Tab` jusqu'au formulaire foyer, saisir les champs     | ordre logique, libellés lus, focus visible                               |       |
| 4   | `Tab` jusqu'à « Ajouter un enfant », `Entrée`          | nouvelle ligne enfant ; focus géré                                       |       |
| 5   | atteindre « Retirer » d'un enfant                      | nom accessible **contextuel** « Retirer l'enfant X » (UT-06)             |       |
| 6   | soumettre avec une erreur (ex. nb enfants vide)        | focus porté sur la 1re section concernée ; message lu (UT-04/05)         |       |
| 7   | naviguer vers « Contrats », `Entrée` sur « Supprimer » | la **Modale** s'ouvre, focus initial sur « Annuler » (UT-03)             |       |
| 8   | `Échap` dans la modale                                 | modale fermée, focus rendu au déclencheur ; aucune suppression           |       |
| 9   | rouvrir, `Tab`/`Shift+Tab` dans la modale              | focus **piégé** dans la modale (focus-trap) tant qu'ouverte              |       |
| 10  | aller au Planning, atteindre les onglets enfant/mode   | flèches **←/→** changent d'onglet ; `Home`/`End` au besoin (UT-01)       |       |
| 11  | un onglet actif                                        | un **seul** onglet `tabindex=0` ; `Tab` entre dans le `tabpanel` associé |       |
| 12  | dans le calendrier, sélectionner plusieurs jours       | multi-sélection accessible au clavier ; absence posée (UT-07 CA3)        |       |
| 13  | « appliquer à la semaine type » au clavier             | saisie **en lot** déclenchée sans souris (UT-07)                         |       |
| 14  | changer de mois puis revenir                           | absences saisies **conservées** (UT-07 CA1)                              |       |
| 15  | saisir le volet **ALSH** d'un contrat                  | la colonne ALSH écrit bien le coût ALSH (UT-10)                          |       |
| 16  | atteindre le panneau coût                              | montants/delta lisibles ; `+`/`-` présent (UT-09) ; sigles focusables    |       |
| 17  | `Tab` jusqu'au bout de page                            | aucun focus perdu hors écran ; pas de piège                              |       |

## 3. Test lecteur d'écran (spec 11 §6.3, volet manuel)

Cible explicite : **UT-01** (onglets) et **UT-02** (changement de route). Dérouler **deux
fois** : NVDA (Windows/Firefox) puis VoiceOver (macOS/Safari).

### 3.1 Script NVDA

1. Lancer NVDA, ouvrir http://localhost:4200, presser `Insert+↓` pour la lecture continue.
2. Naviguer par titres (`H`) puis par régions (`D`) ; vérifier landmarks et `<h1>` unique/page.
3. Aller aux onglets du Planning, parcourir avec **←/→**.
4. Changer de page via la nav.

### 3.2 Script VoiceOver

1. `Cmd+F5`, ouvrir l'app, `VO+A` lecture continue ; `VO+U` (rotor) pour titres/landmarks.
2. Atteindre les onglets, naviguer **←/→** ; ouvrir le rotor « éléments de formulaire » au besoin.
3. Déclencher un changement de route et écouter l'annonce.

| #   | Cible                            | Constat attendu                                                            | OK/KO |
| --- | -------------------------------- | -------------------------------------------------------------------------- | ----- |
| 1   | Onglets planning (UT-01)         | l'élément est annoncé comme **« onglet, sélectionné, x sur y »**           |       |
| 2   | Contenu d'onglet (UT-01)         | le panneau est annoncé **« tabpanel »** lié à l'onglet (`aria-labelledby`) |       |
| 3   | Flèche →/← (UT-01)               | l'onglet suivant prend le focus et est annoncé sélectionné                 |       |
| 4   | Changement de page (UT-02)       | le nouveau **titre de page est annoncé** (région `aria-live="polite"`)     |       |
| 5   | Après navigation (UT-02)         | le focus arrive sur le `<h1>` de la nouvelle page, lu en premier           |       |
| 6   | Lien d'évitement (UT-02)         | « Aller au contenu » annoncé et fonctionnel                                |       |
| 7   | Bouton « Retirer » (UT-06)       | nom unique contextuel, pas un « bouton » muet répété                       |       |
| 8   | Sigles RFR/PSU/ABCM/ALSH (UT-08) | l'abréviation expose sa **forme longue** au lecteur                        |       |
| 9   | Modale suppression (UT-03)       | rôle **dialog** annoncé ; focus sur « Annuler » ; `Échap` ferme            |       |
| 10  | Erreur de champ (UT-04/05)       | le message est rattaché au champ (`aria-describedby`) et annoncé           |       |

## 4. Inspection d'utilisabilité multi-évaluateurs (spec 11 §6.1)

≥ 3 évaluateurs **indépendants** parcourent les flux **planning** et **coûts**, notent les
écarts puis consolident. Sévérité Nielsen : 0 (cosmétique) → 4 (catastrophe).

| #   | Heuristique de Nielsen            | Question d'inspection (flux planning/coûts)                             | Sév. 0-4 |
| --- | --------------------------------- | ----------------------------------------------------------------------- | -------- |
| 1   | Visibilité de l'état              | la sauvegarde des absences / le mois actif sont-ils visibles ?          |          |
| 2   | Correspondance système↔monde réel | sigles et libellés parlent-ils le langage métier crèche ?               |          |
| 3   | Contrôle & liberté                | annuler une saisie en lot / fermer la modale est-il simple ?            |          |
| 4   | Cohérence & standards             | une même action (confirmer) utilise-t-elle toujours la Modale ? (UT-03) |          |
| 5   | Prévention des erreurs            | la saisie en lot évite-t-elle les saisies jour-par-jour risquées ?      |          |
| 6   | Reconnaissance > rappel           | les sigles sont-ils explicités sur place ? (UT-08)                      |          |
| 7   | Flexibilité & efficience          | raccourcis clavier / semaine type accélèrent-ils l'expert ? (UT-07)     |          |
| 8   | Esthétique & sobriété             | le panneau coût reste-t-il lisible, sans surcharge ?                    |          |
| 9   | Diagnostic des erreurs            | les messages disent-ils **quoi** et **où** corriger ? (UT-04)           |          |
| 10  | Aide & documentation              | l'aide contextuelle des sigles est-elle atteignable ? (UT-08)           |          |

## 5. Test d'utilisabilité modéré (spec 11 §6.2)

**Participants** : 5 à 8 gestionnaires de crèche / courtiers (profil réel), session
individuelle modérée 30–40 min, méthode « think-aloud ». **Ne pas** guider la souris.

**Tâches mesurées :**

| Tâche                                                                   | Mesure                  | Critère d'efficience          |
| ----------------------------------------------------------------------- | ----------------------- | ----------------------------- |
| T1 — Saisir un **mois complet** d'absences (avant UT-07, jour-par-jour) | temps (s), nb clics     | référence « avant »           |
| T2 — Saisir le même mois **en lot** (après UT-07)                       | temps (s), nb clics     | **baisse nette** vs T1        |
| T3 — Expliquer les sigles RFR/PSU/ABCM/ALSH rencontrés (UT-08)          | % bonnes réponses       | compréhension ↑ vs sans aide  |
| T4 — Supprimer un contrat puis annuler (UT-03)                          | succès O/N, hésitations | parcours sans erreur          |
| T5 — Lire le coût du mois et dire s'il y a économie/dépassement (UT-09) | succès O/N              | lecture sans la couleur seule |

**Métriques d'efficience à consolider** : temps moyen par tâche, taux de réussite,
nombre d'erreurs, nombre d'appels à l'aide. Comparer T1↔T2 pour chiffrer le gain UT-07.

## 6. Questionnaire SUS (spec 11 §6.5)

Administrer après les tâches (§5), échelle 1 = Pas du tout d'accord … 5 = Tout à fait d'accord.

| #   | Item (français)                                                                    |
| --- | ---------------------------------------------------------------------------------- |
| 1   | Je pense que j'utiliserais volontiers cet outil régulièrement.                     |
| 2   | Je trouve cet outil inutilement complexe.                                          |
| 3   | Je trouve cet outil facile à utiliser.                                             |
| 4   | Je pense que j'aurais besoin du soutien d'un technicien pour utiliser cet outil.   |
| 5   | J'ai trouvé que les différentes fonctions de cet outil sont bien intégrées.        |
| 6   | Je trouve qu'il y a trop d'incohérences dans cet outil.                            |
| 7   | J'imagine que la plupart des gens apprendraient à utiliser cet outil très vite.    |
| 8   | J'ai trouvé cet outil très lourd à utiliser.                                       |
| 9   | Je me suis senti(e) en confiance en utilisant cet outil.                           |
| 10  | J'ai eu besoin d'apprendre beaucoup de choses avant de pouvoir utiliser cet outil. |

**Scoring SUS** : items **impairs** → (réponse − 1) ; items **pairs** → (5 − réponse).
Somme des 10 contributions (0–40) **× 2,5** → score **/100**. Moyenner sur les participants.
Repère usuel : **≥ 68** = au-dessus de la moyenne ; viser ≥ 80 (cf. satisfaction spec 11 §5).

## 7. Test de contraste instrumenté (spec 11 §6.6)

Mesurer les ratios **sur l'app rendue** (pas sur la maquette), tokens lus dynamiquement.

1. App servie, ouvrir DevTools › Console.
2. Lire les tokens : `getComputedStyle(document.documentElement).getPropertyValue('--gris')`
   (idem `--muted`, et la couleur de fond effective de la zone testée).
3. Identifier une occurrence réelle de chaque token (texte secondaire, libellés atténués)
   et relever la **taille de police rendue** via l'inspecteur (panneau Computed).
4. Calculer le ratio premier-plan/fond avec un vérificateur WCAG (DevTools « Contrast » dans
   le color picker, ou outil équivalent).

Campagne **2026-06-05** (instrumentée via `getComputedStyle` + calcul WCAG sur l'app servie,
fond effectif `#fafafa`) :

| Token / usage                               | Taille rendue | Seuil WCAG AA | Ratio mesuré | OK/KO  |
| ------------------------------------------- | ------------- | ------------- | ------------ | ------ |
| `--gris` `#6b7280` / texte secondaire       | 13,6 px / 400 | 4.5:1         | **4,63:1**   | **OK** |
| `#111827` / `h1`                            | 24 px / 700   | 3:1 (grand†)  | **17:1**     | **OK** |
| `--vert` `#15803d` / delta « économie »     | normal        | 4.5:1         | **4,81:1**   | **OK** |
| `--rouge` `#b91c1c` / delta « dépassement » | normal        | 4.5:1         | **6,2:1**    | **OK** |

† « Grand texte » WCAG = ≥ 24 px, ou ≥ 18,66 px **gras**. En-dessous, exiger **4.5:1**.

> ⚠️ `--gris` passe de justesse (**4,63** vs 4,5). Garde-fou : ne pas réduire sa taille de police
> sous 13 px ni l'éclaircir, sous peine de repasser sous le seuil AA.

## 8. Traçabilité méthode → exigences → critère de succès

| Méthode (spec 11 §6)              | Exigences UT couvertes                   | Critère de succès (spec 11 §5)       |
| --------------------------------- | ---------------------------------------- | ------------------------------------ |
| §6.1 Inspection multi-évaluateurs | UT-01, UT-03, UT-04, UT-07, UT-08, UT-09 | §5.2 cohérence · §5.3 erreurs utiles |
| §6.2 Test d'utilisabilité modéré  | UT-07, UT-08, UT-09                      | §5.4 efficience                      |
| §6.3 Lecteur d'écran (manuel)     | UT-01, UT-02, UT-03, UT-05, UT-06, UT-08 | §5.1 WCAG AA crédible                |
| §6.3 axe-core (auto, e2e)         | UT-01, UT-02, UT-05                      | §5.1 · §5.6 non-régression           |
| §6.4 Clavier seul                 | UT-01, UT-02, UT-03, UT-07               | §5.1 · §5.4                          |
| §6.5 SUS                          | (transverse satisfaction)                | §5 satisfaction visée                |
| §6.6 Contraste instrumenté        | UT-09 (et AA texte)                      | §5.1 WCAG AA crédible                |

## 9. Consignation des résultats

Gabarit à remplir à chaque campagne (une ligne par méthode exécutée).

### Campagne 2026-06-05 — vérification instrumentée (assistée par agent, dev `vite serve`)

Pilotée au navigateur (DOM/ARIA + événements clavier synthétiques + calcul de contraste). Couvre
le **scaffolding** que le lecteur d'écran restitue ; l'**écoute audio** NVDA/VoiceOver reste à faire
par un humain (lignes dédiées ci-dessous laissées « à faire »).

| Méthode (§6.x)                 | Date       | Évaluateur   | Score / Verdict                  | Écarts relevés (id + sév.)   |
| ------------------------------ | ---------- | ------------ | -------------------------------- | ---------------------------- |
| §6.4 Clavier seul              | 2026-06-05 | agent (auto) | **OK** (UT-01/02/03/06 vérifiés) | EC-01 ✅ corrigé             |
| §6.3 Scaffolding ARIA (SR)     | 2026-06-05 | agent (auto) | **OK** (rôles/états/liaisons OK) | EC-01 ✅ corrigé             |
| §6.3 Lecteur d'écran NVDA      | _à faire_  | _humain_     | _audio à confirmer_              |                              |
| §6.3 Lecteur d'écran VoiceOver | _à faire_  | _humain_     | _audio à confirmer_              |                              |
| §6.1 Inspection heuristique    | _à faire_  |              |                                  |                              |
| §6.2 Test d'utilisabilité      | _à faire_  | _5-8 users_  |                                  |                              |
| §6.5 SUS (score /100)          | _à faire_  | _users_      |                                  |                              |
| §6.6 Contraste instrumenté     | 2026-06-05 | agent (auto) | **OK** (4 combinaisons ≥ AA, §7) | `--gris` marge faible (4,63) |

**Détail des vérifications runtime (dev) :**

- **UT-01 onglets** — câblage complet sur les **deux** niveaux (Enfants, Modes) : `role=tab/tablist/
tabpanel`, `aria-selected`, `aria-controls`↔`aria-labelledby`, **roving tabindex** (sélectionné=0).
  Clavier : **flèche** déplace le focus, **Entrée/Espace** active (motif **activation manuelle** APG).
- **UT-02 route** — à la navigation : focus déplacé sur `main#contenu` (`tabindex=-1`), région
  `role=status`/`aria-live=polite` annonce le titre, lien d'évitement « Aller au contenu »→`#contenu`.
- **UT-03 modale** — `role=dialog`, `aria-modal`, titre lié ; primaire destructif « Supprimer le
  contrat » + « Annuler » ; **focus-trap** (Tab/Shift+Tab bouclent) ; **Échap** ferme sans supprimer
  et **rend le focus au déclencheur**. ⚠️ **EC-01** ci-dessous.
- **UT-06 boutons** — « Retirer l'enfant Mia/Zoé » et « Supprimer le contrat de Mia » : noms
  accessibles contextuels.
- **UT-08 sigles** — `<abbr title>` (ex. RFR→« Revenu fiscal de référence »), `tabindex=0` (atteignable).
- **UT-04/05 erreurs** — la validation de `nbEnfantsACharge` (`min=1`, `required`) passe par la
  **contrainte HTML5 native** (message + focus pris en charge par le navigateur). La liaison custom
  `aria-describedby`→id (UT-05) ne se manifeste que sur une **erreur serveur par champ** : non
  reproductible sans BFF ici, **couverte par test unitaire**.

**Écarts :**

- **EC-01 (Sév. 1) — ✅ RÉSOLU le 2026-06-05.** _Modale de confirmation : focus initial sur « × »
  (Fermer) au lieu de « Annuler »._ Cause : `ModaleConfirmation` (parent) redirigeait le focus vers
  « Annuler » dans un `useEffect`, mais le focus du « × » posé par `Modale` (enfant) n'était pas
  écrasé de façon fiable (course d'effets / StrictMode). **Correctif** : `Modale` accepte désormais
  une prop `refFocusInitial` et focalise cette cible en priorité ; `ModaleConfirmation` lui passe
  `refAnnuler` et son `useEffect` de redirection est supprimé (source unique de vérité, pas de
  course). **Vérifié au runtime** (focus initial = « Annuler ») + tests `Modale`/`ModaleConfirmation`
  (15) + suite web (206) + E2E (8) verts. Conforme **UT-03 CA2**.
- **`--gris` marge faible** (Sév. 0) — 4,63:1, voir garde-fou §7.

> **Clôture** : tout écart de sévérité ≥ 2 ouvre un correctif avant de revendiquer
> **WCAG 2.1 AA** (spec 11 §5.1) ; les écarts ≤ 1 partent au backlog avec justification.
> **Statut au 2026-06-05** : aucun écart ≥ 2 ; EC-01 (Sév. 1) **corrigé le jour même** → la
> revendication **AA reste valide** sous réserve de la passe audio NVDA/VoiceOver (humaine).
