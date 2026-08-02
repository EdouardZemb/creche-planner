# Plan qualité — Coquille, navigation & communication (rappels + mail au service)

> **Rôle du fichier.** Plan d'exécution auto-portant. L'exécutant (Opus 4.8, ou Sonnet 5
> pour les lots marqués délégables) n'a **pas** accès à la conversation qui a produit ce
> plan : tout ce qui est nécessaire est ici. Aucune décision produit n'est laissée ouverte.
> Chaque lot = **une PR**.

---

## 1. Contexte & objectif

L'app (planner de crèche, parents sur mobile) a déjà eu une passe qualité dédiée sur **tous
ses écrans de fonctionnalité** (dashboard, planning, coûts, crèches & écoles, contrats, ma
famille, mon profil, cloche/désabo). Restaient **non audités** : (a) la **coquille** — tout
ce qu'un parent traverse _autour_ des écrans (premier chargement, sélection de famille,
récupération d'erreur, 404, navigation, hors-ligne) — et (b) deux **failles de fiabilité de
fond** côté notifications, invisibles jusqu'à ce qu'elles cassent la confiance (« mon rappel
est-il vraiment parti ? »).

Deux audits (front-shell + backend) ont établi le constat suivant :

- **Coquille** : bien construite (récupération sans impasse, focus au changement de route,
  retry/timeout du client, barre d'onglets en zone du pouce, migration « foyer » → « famille »
  réelle) — mais **5 défauts concrets et bornés** subsistent, tous visibles côté parent
  mobile.
- **Backend** : pipeline événementiel irréprochable (outbox → livraison at-least-once →
  projections idempotentes). Sur les « gaps » remontés, **3 sont déjà couverts** (isolation
  foyer active en prod, back-fill `enfant_id` fait, doublon-au-crash borné et documenté).
  Restent **2 vraies failles non-trackées**, du même registre.

Le chantier a ensuite été **étendu** (demande commanditaire) à un troisième axe, la
**communication au service** — trois points concrets remontés en usage :

- **(c) Lien du mail de rappel cassé.** Le _chemin_ du lien est correct (corrigé en #180,
  déployé), mais l'**URL de base** émise pointe sur l'**IP LAN du serveur** (`192.168.1.129`,
  certificat non fiable → `ERR_CERT_AUTHORITY_INVALID`, et injoignable hors réseau local) au
  lieu du **domaine public** à certificat valide. Cause = **configuration** (`SERVER_ORIGIN`
  → `NOTIF_APP_URL`/`NOTIF_PUBLIC_API_URL`), pas le code.
- **(d) Mail envoyé aux établissements peu lisible et incomplet.** Le corps est régénéré
  côté serveur à partir du **delta seul** (jours modifiés), en phrasé télégraphique. Le
  parent veut : un récap **de la semaine complète** dès qu'il y a une modification, **mieux
  formulé**, et **éditable dans l'app avant l'envoi**.

Ce plan corrige ces **10 points** en **9 lots** : 4 front « coquille » (L1-L4) + 2 backend
« fiabilité des rappels » (L5-L6) + 1 lien de rappel (L7) + 2 « mail au service » (L8-L9).
Objectif : faire franchir à la coquille, à la fiabilité **et à la communication au service**
le même palier « prototype → produit pro » que les écrans.

---

## 2. Décisions du commanditaire (répondues avant rédaction)

- **Périmètre validé** : « Coquille & navigation » (4 lots front) **+** « Fiabilité des
  rappels » (2 lots backend). C'est la version _« front impeccable ET backend solide »_.
- **Ambition hors-ligne** : option **étendue** — le parent doit pouvoir **consulter** en
  hors-ligne (cache lecture), pas seulement voir un message. Contrainte associée tranchée
  ci-dessous : **ne jamais faire passer un contenu en cache pour du contenu à jour**.
- **Éditabilité du mail au service (L8-L9)** : **tout le corps du mail est éditable**. Le
  parent part d'un brouillon pré-rempli (semaine complète, lisible) et peut **tout réécrire** ;
  **c'est son texte exact qui part**. Conséquence assumée : le serveur n'est plus l'auteur
  unique du corps (il **journalise et envoie ce que le client fournit**, après validation +
  échappement), tout en gardant les invariants de sécurité (destinataire **résolu serveur**,
  routabilité, dry-run, allowlist, idempotence).
- **Lien de rappel (L7)** : symptôme confirmé = erreur **TLS** sur `192.168.1.129`. C'est un
  problème de **config/déploiement** (URL de base = IP LAN), pas un bug de code. Correctif =
  **action ops** (pointer sur le domaine public à cert valide) **+** un **garde-fou au boot**
  qui rend cette mauvaise config **bruyante** (échec démarrage en prod).

---

## 3. Hypothèses assumées (défauts pris — corrigibles avant lancement)

1. **URL `/foyers/:id` conservée telle quelle.** Pas de renommage en `/familles/:id` : les
   e-mails de rappel **déjà envoyés** contiennent des deep-links `/foyers/:id/planning?...`
   (cf. `NotificationInApp.lien`), et sur PWA mobile l'URL est rarement vue. Bénéfice visible
   faible, risque de casser des liens existants élevé → **hors périmètre**.
2. **Signal de fraîcheur hors-ligne = bannière globale**, pas d'horodatage par carte (workbox
   n'expose pas simplement la date de mise en cache à la page ; une bannière « données de
   votre dernière connexion » est honnête et suffisante).
3. **Pas de file d'attente d'écritures hors-ligne** : une écriture tentée hors-ligne échoue
   avec un message clair (« Vous êtes hors-ligne… »). Seule la **consultation** est servie en
   cache. (Une file offline serait une feature à part entière, hors palier qualité.)
4. **Cache API = données du parent sur son propre appareil** (PWA `display: standalone`,
   mono-utilisateur) : pas de préoccupation multi-comptes sur un même profil navigateur.
5. **GAP A (envoi à la crèche)** : corrigé par **reprise à la ré-action du parent**
   (l'envoi reste _human-in-the-loop_ : un parent relit un brouillon puis clique « Envoyer »).
   **Surtout PAS de reaper** qui ré-enverrait automatiquement un mail à une **vraie crèche**
   sans le parent dans la boucle.
6. **GAP B (rappel du mardi)** : priorité = **rendre un raté visible** (état terminal +
   alerte), **pas** de re-livraison tardive spéculative d'un rappel devenu périmé (un rappel
   « validez la semaine prochaine » livré une fois la semaine commencée a peu de valeur).
7. **Multi-foyer (Lot 3) est un cas rare** (mode borné, familles rattachées à plusieurs
   foyers ; l'app gère un « foyer de référence unique » en temps normal). Le sélecteur reste
   **proportionné** (N petit, 2–3).
8. **Aucune nouvelle dépendance npm** : `Intl.ListFormat` est natif ; `workbox` vient déjà de
   `vite-plugin-pwa`.
9. **Aucune migration DB** : L5, L6, **L8** se font **sans changement de schéma** (réutilisation
   de `created_at` pour L5 ; nouvelle valeur `varchar` pour L6, colonne `varchar(16)` sans
   contrainte CHECK ; colonnes `sujet`/`corps` déjà présentes pour L8).
10. **Un seul lot touche un contrat inter-services** : **L8** élargit le corps de
    `POST /v1/notifications/envois/etablissement` (Pact `api-gateway ↔ svc-notifications`).
    Élargissement **rétro-compatible** (champs optionnels) → régénérer le pact + `can-i-deploy`.
    Tous les autres lots ne touchent aucun contrat.
11. **Mail au service = corps éditable, texte brut.** Le parent édite du **texte brut** (objet
    - corps) ; le serveur l'**échappe** en HTML pour l'e-mail (pas de HTML libre du client →
      pas d'injection). Le **destinataire reste résolu côté serveur** (jamais fourni par le
      client), tout comme routabilité/dry-run/allowlist/idempotence.
12. **Le lien de rappel est déjà correct dans le code** (chemin `…/foyers/:id/planning?semaine=…`,
    corrigé #180). Ne **pas** re-corriger le chemin. L7 = garde-fou boot + action ops (URL de base).

> Si l'une de ces hypothèses ne te convient pas, corrige-la **avant** de lancer les lots
> concernés (elle change leur contenu).

---

## 4. Conventions transverses (valables pour TOUS les lots)

**Environnement & commandes**

- Package manager : **`corepack pnpm@10.34.2`** (jamais le pnpm global 8.x). Toutes les
  commandes nx passent par `pnpm nx …`.
- **`nx test <projet>` ne typecheck PAS.** Pour un projet, lancer systématiquement :
  `pnpm nx run-many -t typecheck test lint -p <projet>` (ex. `-p web`, `-p svc-notifications`).
- Lint : ESLint 9 **flat config type-aware**, ratchet `warn → error` (un nouveau warning
  casse la CI). Pas de `eslint-disable` sans justification.
- **Windows** : pour les commandes qui touchent `node_modules`/symlinks (`pnpm install`),
  utiliser **PowerShell**, jamais Git Bash.

**Code (web)**

- **`verbatimModuleSyntax`** activé côté web : importer les types avec `import type { … }`.
- **React Compiler** actif (`babel-plugin-react-compiler`, target 19) : **ne pas** ajouter
  de `useMemo`/`useCallback`/`memo` manuels par défaut.
- **Tokens de design existants** (dans `apps/web/src/styles.css:1-40`) : couleurs `--bleu`
  `#1d4ed8`, `--gris` `#4b5563` (AA garanti), `--bordure` `#e5e7eb`, `--ambre` `#b45309`,
  `--rouge` `#b91c1c`, `--vert` `#15803d` ; espacements `--esp-1..6` ; titres `--h1` `1.5rem`
  / `--h2` `1.15rem` / `--h3` `1rem`. **Réutiliser** ces tokens, ne pas inventer de valeurs.
- Composants UI partagés à réutiliser (dans `apps/web/src/ui/`) : `Spinner` (accessible,
  `role="status"`), `EtatVide` (bloc titre + description + actions), `Modale` /
  `ModaleConfirmation`, `Badge`, `StatutSauvegarde`, `Abbr`. **Ne pas** ré-implémenter.
- Le repo **génère** les types BFF depuis l'OpenAPI de la gateway
  (`apps/web/src/api/openapi-types.gen.ts`, réexporté par `types/bff.ts`). Ne pas éditer le
  fichier `.gen.ts` à la main ; s'en servir comme source de vérité des formes.

**Pièges globaux du repo**

- **Worktree** : si l'exécution se fait dans un git worktree, **préfixer tous les chemins**
  par le répertoire du worktree — sinon les éditions partent dans le **clone principal** et
  donnent un « faux vert ». Vérifier `git rev-parse --show-toplevel` avant d'éditer. Un
  worktree neuf n'a pas de `node_modules` → `pnpm install` d'abord (PowerShell).
- **`/pacts` est dans `.prettierignore`** : ne pas reformater les fichiers de `pacts/`.
- **`nx test web`** tourne sous vitest ; le **Service Worker (PWA) n'est PAS actif en `vite
dev`** — il ne l'est qu'en build de prod. Toute vérif offline passe par un **build +
  preview** (ou la stack docker), cf. Lot 4.
- Vérif UI locale : cf. le mémo repo `verif-ui-locale-stack.md` — stack docker + seed, puis
  `web` en Vite dev :4200. Builder `shared-semaine` avant `nx test web` si besoin.

**Branche & PR**

- `main` est protégée : **une branche par lot**, PR avec le check `ci` vert. Ne jamais
  pousser depuis le clone d'origine ; travailler dans le clone `-public`.
- Commits : Conventional Commits, sujet **≤ 100 caractères** (commitlint).

**Ordre & dépendances des lots**

- **Lots 1 → 2 → 3 → 4** touchent tous `apps/web/src/App.tsx` : les exécuter **dans cet
  ordre** (ou rebaser après chaque merge) pour éviter des conflits mécaniques dans `App.tsx`.
  Les dépendances dures sont notées dans chaque lot.
- **Lots 5, 6, 7** (backend `svc-notifications`) sont **orthogonaux** au front et entre eux :
  parallélisables à tout moment.
- **Lots 8 → 9** (mail au service) : **L9 dépend de L8 mergé** (L8 ouvre le pipeline d'envoi
  du corps, L9 le remplit côté front). L8 est backend + contrat ; L9 est front.
- **Un seul lot touche un contrat Pact : L8.** Tous les autres laissent `pact-drift` et
  `pact-can-i-deploy` verts **sans** régénération (le vérifier quand même). Pour L8 :
  régénérer le pact et re-vérifier `can-i-deploy` (cf. « Comment vérifier » de L8).

---

# LOTS FRONT — « Coquille & navigation »

## Lot 1 — Correctifs mobile-PWA & accessibilité de la coquille

**Objectif (parent).** _Avant_ : sur iPhone en PWA installée, la barre d'onglets se colle
sous la barre home et le contenu peut passer sous l'encoche (l'effort « safe-area » du CSS
est **inerte**) ; hors d'un foyer, les liens d'en-tête sont des cibles < 44px ; les écrans de
récupération n'ont pas de `<h1>` et un mauvais spinner tourne même en « animations réduites » ;
un « ... » ASCII traîne. _Après_ : l'app respecte l'encoche et la barre home dans toutes les
orientations, toutes les cibles tactiles ≥ 44px, la structure de titres est correcte pour les
lecteurs d'écran, et les animations respectent `prefers-reduced-motion`.

**Périmètre exact.**

- `apps/web/index.html` (ligne 6 : balise viewport).
- `apps/web/src/styles.css` : `.app-header` (57-65), `.app-header a` (76-80), bloc
  `prefers-reduced-motion` (1309-1313), `.spinner-roue` (745-753).
- `apps/web/src/ui/EtatVide.tsx` : niveau de titre.
- `apps/web/src/App.tsx` : poser la nouvelle prop d'`EtatVide` sur les **6** usages pleine
  page (lignes 83, 93, 345, 376, 387, 399).
- `apps/web/src/planning/PlanningPage.tsx:241` : remplacer le `...` ASCII par `…`.
- Tests associés : `apps/web/src/ui/EtatVide.test.tsx` (adapter à la prop).
- **Hors périmètre** : ne pas toucher aux 8 usages _in-page_ d'`EtatVide` (empty-states dans
  des pages qui portent déjà un `<h1>`) : `couts/CoutsAnnuelsPage.tsx:372`,
  `etablissements/EtablissementsPage.tsx:625`, `foyer/ContratsPage.tsx:201`,
  `foyer/FoyerFormPage.tsx:227`, `notifications/ClocheNotifications.tsx:93` & `:101`,
  `planning/PlanningPage.tsx:269` & `:333` → **restent en `<h2>`**.

**Décisions déjà prises (exactes).**

1. **Viewport** — `apps/web/index.html:6`, remplacer par :
   ```html
   <meta
     name="viewport"
     content="width=device-width, initial-scale=1, viewport-fit=cover"
   />
   ```
2. **En-tête sûr sous l'encoche** — `viewport-fit=cover` fait passer le contenu sous
   l'encoche : `.app-header` doit alors respecter les insets **haut/gauche/droite** (les 4
   insets _bas_ existants aux lignes 193/252/286/292 deviennent enfin actifs et restent
   inchangés). Remplacer le `padding` de `.app-header` (styles.css:62) par :
   ```css
   padding: calc(0.6rem + env(safe-area-inset-top))
     max(0.9rem, env(safe-area-inset-right)) 0.6rem
     max(0.9rem, env(safe-area-inset-left));
   ```
3. **Cibles tactiles de l'en-tête (états hors-foyer)** — `.app-header a` (styles.css:76-80)
   n'a pas de hauteur minimale ; hors d'un contexte foyer (Mes familles, Mon profil, Nouvelle
   famille — cf. `App.tsx:266-288`), ce sont les seuls liens de nav et ils sont < 44px.
   Ajouter à la règle `.app-header a` :
   ```css
   display: inline-flex;
   align-items: center;
   min-height: 44px;
   ```
   _(Ne dégrade pas la barre d'onglets mobile : celle-ci cible `.nav-onglets a`, règle plus
   spécifique, min-height 3.25rem déjà présente.)_ Vérifier au 375px que la `.marque` et la
   `.cloche` restent alignées ; si l'`inline-flex` casse un alignement, préférer `min-height`
   seul + `line-height: 44px`.
4. **Niveau de titre d'`EtatVide`** — ajouter une prop optionnelle **`titrePrincipal?: boolean`**
   (défaut `false`). `EtatVide.tsx:44` rend `<h2>` quand `false`, `<h1>` quand `true`
   (conserver la classe `etat-vide-titre`). Poser `titrePrincipal` (valeur `true`) sur les 6
   usages pleine page listés au périmètre — ce sont les écrans où `EtatVide` **est** le titre
   de la page (aucun autre `<h1>`).
5. **Spinner & animations réduites** — le bloc `@media (prefers-reduced-motion: reduce)`
   (styles.css:1309-1313) ne coupe que `.squelette-bloc`. Y ajouter :
   ```css
   .spinner-roue {
     animation: none;
   }
   ```
   _(La roue reste visible, figée ; `Spinner` garde son texte `role="status"`.)_
6. **Typo** — `PlanningPage.tsx:241` : `Chargement de votre famille...` → `Chargement de
votre famille…` (glyphe `…`, cohérent avec le reste de l'app). _(Le reste de ce loader est
   traité en Lot 2 ; ici seule la typo.)_

**Conventions à respecter.** Tokens CSS existants ; ne pas introduire de media query nouvelle
(réutiliser les blocs existants) ; garder la classe `etat-vide-titre`. Mettre à jour
`EtatVide.test.tsx` pour couvrir le rendu `<h1>` vs `<h2>` selon la prop.

**Critères d'acceptation.**

- [ ] iPhone (ou devtools « iPhone 14 Pro », mode standalone simulé) : la barre d'onglets ne
      chevauche plus la barre home ; l'en-tête ne passe pas sous l'encoche ; pas de contenu
      coupé en paysage.
- [ ] Au 375px, hors contexte foyer, chaque lien d'en-tête (`Mes familles`, `Mon profil`,
      `Nouvelle famille`) a une cible ≥ 44px (mesurable via l'inspecteur).
- [ ] Les écrans « Mes familles » (0 foyer), « Session expirée », « Famille introuvable »,
      « Service indisponible », « Page introuvable » ont un `<h1>` unique (plan de titres qui
      démarre en h1). Les empty-states in-page listés restent en `<h2>`.
- [ ] Avec `prefers-reduced-motion: reduce`, la roue du `Spinner` ne tourne plus.
- [ ] Plus aucun `...` ASCII dans un texte visible de `PlanningPage`.
- [ ] `pnpm nx run-many -t typecheck test lint -p web` vert.

**Comment vérifier.**

1. `pnpm nx run-many -t typecheck test lint -p web`.
2. Rendu réel : `pnpm nx build web && pnpm nx preview web` (ou Vite dev pour le non-PWA), pane
   navigateur en **375px** puis en simulant `display-mode: standalone`. Contrôler la
   safe-area via l'inspecteur (les `env(safe-area-inset-*)` doivent être non nuls sous un
   device à encoche ; devtools → « Device Toolbar » → device à encoche).
3. Bascule `prefers-reduced-motion` (devtools → Rendering → Emulate CSS media) → roue figée.
4. Inspecter l'outline du document (extension a11y ou `document.querySelectorAll('h1')`) sur
   les 5 écrans pleine page.

**Pièges connus.** `viewport-fit=cover` **sans** l'inset-top de l'en-tête (point 2) tuck le
contenu sous l'encoche : les deux vont **ensemble**. Ne pas mettre de `min-height` sur
`.app-header a` de façon à toucher aussi `.nav-onglets a` (la règle mobile est plus
spécifique, mais vérifier au 375px qu'aucune régression d'alignement n'apparaît). `nx test
web` ne typecheck pas → lancer la commande combinée.

**Modèle d'exécution recommandé.** **Opus 4.8** pour orchestrer, mais l'essentiel est
mécanique : les points 1, 2, 3, 5, 6 (CSS/HTML) sont **délégables à Sonnet 5** une fois la
prop d'`EtatVide` (point 4) posée. Le point 4 (prop + sélection des 6 call-sites + test)
demande un minimum de jugement → à garder sur Opus ou à décrire mot pour mot à Sonnet.

---

## Lot 2 — États de chargement unifiés & annonce de route fiable

**Objectif (parent).** _Avant_ : le **tout premier écran** au démarrage est une ligne de
texte gris nu (`<p class="muted">Chargement de votre session…</p>`), non annoncée ; plusieurs
pages ont ce même loader famélique là où d'autres ont un vrai spinner/squelette ; et sur un
écran de récupération (404-famille rendu à l'URL `/dashboard`), le lecteur d'écran annonce
« Aujourd'hui » alors que l'écran dit « Famille introuvable ». _Après_ : un composant de
chargement **cohérent, visible et annoncé** partout ; l'annonce de route correspond
**toujours** à l'écran réellement affiché.

**Périmètre exact.**

- **Nouveau composant** : `apps/web/src/ui/ChargementPage.tsx` (+ `ChargementPage.test.tsx`).
- Remplacement des loaders **de niveau écran** (liste exacte ci-dessous).
- **Source de vérité unique du titre** pour aligner annonce ↔ `document.title` :
  - `apps/web/src/hooks/useTitrePage.ts`
  - `apps/web/src/hooks/useAnnonceRoute.ts`
  - `apps/web/src/App.tsx` (fonction `titreDepuisPathname` 415-435, `Coquille` 443-480).
- **Hors périmètre** : les loaders _inline de sous-composant_ (`notifications/EditeurSemaine.tsx:101`,
  `notifications/RelectureEnvoi.tsx:331`, `foyer/ContratsPage.tsx:194` & `:259`) — laissés
  tels quels (petits blocs partiels, pas des « la page charge »). Ne pas toucher au squelette
  du dashboard (`DashboardJourPage.tsx:463-471`), qui est déjà un bon état de chargement.

**Décisions déjà prises (exactes).**

1. **Composant `ChargementPage`** — un bloc centré : roue (`aria-hidden`) + **texte visible**,
   le tout dans un conteneur `role="status" aria-live="polite"` (donc annoncé **une** fois).
   API : `ChargementPage({ message }: { message: string })`. Réutiliser les classes
   `.spinner`/`.spinner-roue` existantes (styles.css:739-753) et ajouter une classe
   `.chargement-page` (centrage vertical léger, `padding: var(--esp-6)`, `gap: var(--esp-3)`,
   texte en `--gris`). Exemple de structure :
   ```tsx
   export function ChargementPage({ message }: { message: string }) {
     return (
       <div className="chargement-page" role="status" aria-live="polite">
         <span className="spinner-roue" aria-hidden="true" />
         <p className="muted">{message}</p>
       </div>
     );
   }
   ```
2. **Sites à remplacer** (loaders de niveau écran → `<ChargementPage message="…" />`,
   messages **inchangés**) :
   - `App.tsx:38` → `message="Chargement de votre session…"`
   - `App.tsx:77` → `message="Chargement de votre session…"`
   - `App.tsx:120` → `message="Recherche d'une famille existante…"` (garder le glyphe `…`)
   - `foyer/ContratsPage.tsx:165` (loader **de tête de page**) → `message="Chargement de votre famille…"`
   - `foyer/FoyerModifierPage.tsx:60` → `message="Chargement de votre famille…"`
   - `profil/MonProfilPage.tsx:405` → `message="Chargement de votre profil…"`
   - `planning/PlanningPage.tsx:241` → `message="Chargement de votre famille…"` (remplace le
     `<div className="carte muted">…</div>`)
   - `etablissements/EtablissementsPage.tsx:591` → `message="Chargement des crèches et écoles…"`
3. **Annonce de route = même source que `document.title`.** Cause du bug : `titreDepuisPathname`
   (App.tsx:415-435) dérive le titre annoncé du **chemin**, alors que `GardeFoyer` peut rendre
   un écran d'erreur au **même** chemin. Correction : faire lire l'annonce depuis le **titre
   réellement posé par la page** (chaque écran, y compris de récupération, appelle déjà
   `useTitrePage(...)`).
   - Créer un contexte léger `TitrePageContext` (état `string` + setter) fourni dans
     `Coquille` (au-dessus de `<Routes>`).
   - `useTitrePage(titre)` : en plus de poser `document.title`, appelle le setter du contexte
     avec `titre` (le titre **sans** le suffixe « — Crèche Planner »).
   - `useAnnonceRoute` : au lieu de recevoir `titreDepuisPathname(pathname)`, **publier la
     valeur courante du contexte** dans la région live, et **re-publier quand cette valeur
     change** (pas seulement au changement de `pathname`) — ainsi le swap tardif
     `Outlet → FoyerIntrouvable` (même chemin, mais `useTitrePage('Famille introuvable')`)
     est annoncé correctement. Conserver le comportement « ne pas bouger le focus au premier
     rendu » et « déplacer le focus vers `refCible` au changement de `pathname` ».
   - `titreDepuisPathname` : **conservée uniquement** comme _fallback_ pour le `document.title`
     initial si aucune page n'a encore posé de titre ; ne plus la brancher sur l'annonce.
   - **Contrainte d'ordre React à exploiter** : les effets des enfants s'exécutent **avant**
     ceux du parent → quand on navigue, la page pose son titre (contexte) avant que
     `Coquille` ne réagisse. Écrire le hook de façon à ne pas boucler (mettre le titre dans un
     `ref` pour l'effet, comme le fait déjà `useAnnonceRoute` avec `refAnnonce`).
4. **Testid préservé** : la région live garde `data-testid="annonce-route"` (App.tsx:454) et
   la classe `sr-only`.

**Conventions à respecter.** `import type` (verbatimModuleSyntax). Ne pas ajouter de mémo
manuel (React Compiler). Réutiliser `.spinner-roue`/`.muted`. Le contexte doit avoir une
valeur par défaut hors provider (comme `MoiContext`) pour ne pas casser les tests de
composants isolés qui montent une page sans `Coquille`.

**Critères d'acceptation.**

- [ ] Au démarrage à froid, l'écran de session/découverte affiche `ChargementPage` (roue +
      texte visible), pas une ligne grise nue ; l'état est annoncé (`role="status"`).
- [ ] Les 8 sites listés utilisent `ChargementPage` avec les messages exacts ci-dessus.
- [ ] En rendant un `GardeFoyer` en erreur (404-famille) à l'URL `/foyers/:id/dashboard`,
      la région `data-testid="annonce-route"` annonce **« Famille introuvable »** (et non
      « Aujourd'hui ») ; `document.title` et l'annonce **concordent**.
- [ ] Le focus est toujours déplacé vers `<main id="contenu">` au changement de route
      (non régressé), et pas au premier rendu.
- [ ] `pnpm nx run-many -t typecheck test lint -p web` vert (dont un test du hook couvrant le
      cas « titre change sans changement de pathname »).

**Comment vérifier.**

1. `pnpm nx run-many -t typecheck test lint -p web`.
2. Test unitaire ajouté : monter `Coquille` sur une route dont le foyer 404, forcer la
   résolution de `useFoyer` en erreur, asserter le texte de `annonce-route`.
3. Rendu réel : Vite dev :4200 ; couper le réseau au boot (devtools offline) pour voir
   `ChargementPage` ; naviguer vers une URL de foyer inexistante et écouter/inspecter la
   région live.

**Pièges connus.** Ne pas déclencher une boucle de rendu en mettant le titre du contexte en
dépendance de l'effet d'annonce (utiliser un `ref`, cf. `refAnnonce` existant). Les tests de
pages isolées (`*.test.tsx`) montent souvent la page **sans** `Coquille`/`TitrePageProvider` :
la valeur par défaut du contexte doit rendre `useTitrePage` inoffensif (setter no-op). `nx
test web` ne typecheck pas.

**Modèle d'exécution recommandé.** **Opus 4.8** — le point 3 (source de vérité du titre,
ordre des effets, non-régression du focus) demande du jugement. Le point 2 (remplacement
mécanique des 8 loaders) est délégable à Sonnet 5 **une fois `ChargementPage` créé**.

---

## Lot 3 — Sélecteur « Mes familles » réel (fin du stub)

**Objectif (parent).** _Avant_ : une famille rattachée à **plusieurs** foyers voit deux
boutons identiques « Ouvrir la famille 1 » / « Ouvrir la famille 2 » — impossible de savoir
laquelle est laquelle. _Après_ : chaque famille est identifiée par **les prénoms de ses
enfants** (« Famille de Léa et Noé »), l'identifiant naturel pour un parent.

> **Contexte de rareté** : cet écran n'apparaît que si `moi.foyers.length > 1` (mode borné,
> multi-foyer). C'est un cas rare — le lot reste **proportionné** (pas de sur-ingénierie).

**Périmètre exact.**

- `apps/web/src/App.tsx` : `MesFoyersPage` (73-103), **uniquement la branche N-foyer**
  (92-102). Extraire un sous-composant `SelecteurFamilles`.
- Éventuel petit CSS dans `apps/web/src/styles.css` (classe `.selecteur-familles`).
- Test : `apps/web/src/App.test.tsx` (ajouter un cas multi-foyer).
- **Hors périmètre** : la branche **0-foyer** (79-91) reste sur `EtatVide` (inchangée, hormis
  le `titrePrincipal` posé au Lot 1) ; le mode hérité et le routage `Accueil` ne changent pas ;
  aucune modification du BFF (`/moi` continue de ne renvoyer que des ids).

**Décisions déjà prises (exactes).**

1. **Données** — `MoiVue.foyers` = `string[]` (ids seulement) ; `FoyerVue` n'a **aucun nom**.
   L'identité lisible d'une famille se lit via **`api.lireFoyer(id)`** (GET `/v1/foyers/:id`),
   qui renvoie `{ foyer: FoyerVue, enfants: EnfantVue[], parents: ParentVue[] }`. Le
   sélecteur charge le dossier de **chaque** id de `moi.foyers` (N petit) via
   `Promise.all(moi.foyers.map((id) => api.lireFoyer(id, { signal })))`, idéalement encapsulé
   dans un `useAsync` (cf. `hooks/useAsync.ts`).
2. **Libellé d'une famille** — fonction pure `libelleFamille(dossier)` :
   - Prénoms d'enfants présents → `Famille de <liste FR>` où la liste FR utilise
     `new Intl.ListFormat('fr', { style: 'long', type: 'conjunction' }).format(prenoms)`
     (ex. `['Léa','Noé']` → « Léa et Noé » ; `['Léa','Noé','Tom']` → « Léa, Noé et Tom »).
   - Sinon (aucun enfant) → parent **principal** (`parents.find(p => p.principal)` sinon
     `parents[0]`) : `Famille <prenom nom>` si un prénom/nom existe, sinon son `email`.
   - Sinon → `'Ma famille'` (repli ultime).
3. **Rendu** — remplacer les boutons ordinaux par une **liste de cartes** cliquables, chacune
   un `<Link to={\`/foyers/${id}/dashboard\`}>` portant le libellé (et, en secondaire discret,
   le nombre d'enfants : « 2 enfants » — facultatif mais recommandé pour distinguer deux
   familles homonymes). Titre de page inchangé : « Choisir une famille ».
4. **États** — pendant le chargement des dossiers : `<ChargementPage message="Chargement de
vos familles…" />` (composant du Lot 2 → **dépendance : Lot 2 mergé**). En cas d'échec de
   chargement d'**un** dossier : dégrader **gracieusement** pour cette carte seulement
   (libellé de repli « Ouvrir cette famille ») — **ne jamais** bloquer tout le sélecteur ni
   masquer les familles qui ont chargé. Si **tous** échouent : `EtatVide` « Impossible de
   charger vos familles » + action « Réessayer ».
5. **Accessibilité** — la liste est une vraie liste (`<ul>/<li>`), chaque carte un lien avec
   un nom accessible = le libellé de la famille. Cibles ≥ 44px.

**Conventions à respecter.** `useAsync` pour le fetch groupé (annulation via `signal`).
`import type`. Réutiliser `EtatVide`, `ChargementPage` (Lot 2), tokens CSS. Pas de mémo
manuel. `Intl.ListFormat` est natif (aucune dépendance).

**Critères d'acceptation.**

- [ ] Avec 2 foyers (chacun avec des enfants), le sélecteur affiche « Famille de <prénoms> »
      pour chacun, distincts, chaque carte menant à `/foyers/:id/dashboard`.
- [ ] Un foyer sans enfant retombe sur le parent principal (nom ou e-mail), jamais sur un
      ordinal.
- [ ] Si un `lireFoyer` échoue, sa carte affiche un repli mais les autres restent lisibles ;
      si tous échouent, `EtatVide` « Réessayer ».
- [ ] Pendant le chargement : `ChargementPage`. Branche 0-foyer inchangée.
- [ ] Cibles ≥ 44px ; `<ul>/<li>` ; nom accessible = libellé.
- [ ] `pnpm nx run-many -t typecheck test lint -p web` vert (test multi-foyer ajouté).

**Comment vérifier.**

1. `pnpm nx run-many -t typecheck test lint -p web`.
2. Test : mocker `api.moi` (→ 2 foyers) et `api.lireFoyer` (→ dossiers avec enfants) ; asserter
   les libellés et les `href`. Ajouter un cas « un `lireFoyer` rejette ».
3. Rendu réel : impossible sans mode borné multi-foyer réel ; se contenter du test + inspection
   visuelle en injectant deux ids si la stack de dev le permet.

**Pièges connus.** `MesFoyersPage` est aussi touchée par le Lot 1 (prop `titrePrincipal` sur
la branche 0-foyer, App.tsx:93 pour la branche N — qui **disparaît** ici) : après ce lot,
`titrePrincipal` ne subsiste que sur la branche 0-foyer (App.tsx:83). Ne pas casser le routage
`Accueil` (App.tsx:43-55) qui redirige vers `/mes-foyers` en cas de N foyers. `nx test web` ne
typecheck pas.

**Dépendance.** **Lot 2 mergé** (utilise `ChargementPage`). Ordonner après Lot 1 et Lot 2.

**Modèle d'exécution recommandé.** **Opus 4.8** — jugement sur le parcours, la dégradation
gracieuse par carte, et la forme du libellé.

---

## Lot 4 — Conscience hors-ligne & consultation en cache

**Objectif (parent).** _Avant_ : PWA installable **sans aucune** conscience du hors-ligne — en
4G/métro, une coupure donne une erreur générique « Service indisponible », et rien n'est
consultable hors-ligne (le SW ne met en cache que la coquille, pas les données). _Après_ : le
parent **sait** qu'il est hors-ligne (bannière claire), peut **consulter** les écrans
récemment vus (dashboard, planning, coûts…) depuis le cache, et ne prend **jamais** un contenu
en cache pour un contenu à jour.

**Périmètre exact.**

- `apps/web/vite.config.mts` : `workbox.runtimeCaching` (le bloc `workbox` existe déjà,
  lignes 42-47, avec `navigateFallbackDenylist` à conserver).
- **Nouveau hook** : `apps/web/src/hooks/useEnLigne.ts` (+ test).
- **Nouveau composant** : `apps/web/src/ui/BanniereHorsLigne.tsx` (+ test).
- `apps/web/src/App.tsx` : `Coquille` (443-480) rend la bannière sous `<Entete/>`.
- `apps/web/src/styles.css` : classe `.banniere-hors-ligne`.
- `apps/web/src/utils/erreurs.ts` : message d'erreur _offline-aware_ (petit ajout).
- **Hors périmètre** : **pas** de file d'attente d'écritures hors-ligne (cf. hypothèse 3) ;
  pas d'horodatage par carte (cf. hypothèse 2) ; ne pas toucher au flux de reconnexion Access
  (`utils/reconnexion.ts`) ni au `navigateFallbackDenylist` `/cdn-cgi/`.

**Décisions déjà prises (exactes).**

1. **Cache lecture des GET API** — dans `vite.config.mts`, ajouter à `workbox` (à côté de
   `navigateFallbackDenylist`) :
   ```js
   runtimeCaching: [
     {
       urlPattern: ({ url, request }) =>
         request.method === 'GET' && url.pathname.startsWith('/api/v1/'),
       handler: 'NetworkFirst',
       options: {
         cacheName: 'api-lecture-v1',
         networkTimeoutSeconds: 4,
         // Ne mettre en cache QUE les vraies 200 : jamais une redirection Access
         // opaque (status 0), pour ne pas « avaler » une session expirée hors-ligne.
         cacheableResponse: { statuses: [200] },
         expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24, purgeOnQuotaError: true },
       },
     },
   ],
   ```
   Rationale (à respecter) : **NetworkFirst** → en ligne le parent a toujours le réseau
   d'abord (frais) ; hors-ligne (ou > 4s) il retombe sur le cache. `statuses: [200]` exclut
   l'`opaqueredirect` d'Access (le client le voit alors comme réseau et déclenche
   `AuthExpiredError` → écran « Session expirée », comportement inchangé). Expiration 24h pour
   qu'un cache oublié périme.
2. **Détection en ligne/hors-ligne** — hook `useEnLigne(): boolean` : initialise à
   `navigator.onLine`, s'abonne aux événements `window` `online`/`offline`, se désabonne au
   démontage. `navigator.onLine` est un **indice** (peut être `true` sur un wifi captif) : on
   l'assume suffisant pour la bannière.
3. **Bannière** — `BanniereHorsLigne` : rendu **uniquement** quand `useEnLigne() === false`.
   Bloc `role="status" aria-live="polite"`, **collant sous l'en-tête**, texte exact :
   > **Vous êtes hors-ligne.** Les informations affichées peuvent dater de votre dernière
   > connexion.
   > Style `.banniere-hors-ligne` : fond ambre clair `#fef3c7`, texte `#92400e`, bordure
   > basse `1px solid var(--ambre)`, `padding: var(--esp-2) var(--esp-4)`, `font-size: 0.9rem`,
   > `text-align: center` (contraste `#92400e` sur `#fef3c7` ≈ AA). Sur mobile, elle se pose
   > **sous** l'en-tête et **au-dessus** du contenu ; ne pas la mettre dans la barre d'onglets
   > fixe du bas.
4. **Placement** — dans `Coquille` (App.tsx), juste après `<Entete />` et **avant** la région
   live d'annonce (`data-testid="annonce-route"`), rendre `<BanniereHorsLigne />`.
5. **Message d'erreur offline-aware** — dans `utils/erreurs.ts`, en **tête** de
   `messageErreur(e)` (avant le mapping ApiError/TypeError) :
   ```ts
   if (typeof navigator !== 'undefined' && navigator.onLine === false) {
     return 'Vous êtes hors-ligne. Reconnectez-vous pour enregistrer vos changements.';
   }
   ```
   _(Ainsi une **écriture** tentée hors-ligne — qui échoue faute de réseau — affiche un
   message juste au lieu de « Service indisponible ». La lecture, elle, est servie par le
   cache et ne produit pas d'erreur.)_ Conserver tout le mapping existant en repli.

**Conventions à respecter.** Aucune dépendance nouvelle (workbox déjà présent via
`vite-plugin-pwa` ; `registerType: 'autoUpdate'` fait qu'un nouveau SW s'active tout seul).
`import type`. Réutiliser tokens `--ambre`, `--esp-*`. Tests vitest pour `useEnLigne`
(simuler `online`/`offline` via `window.dispatchEvent(new Event('offline'))`) et
`BanniereHorsLigne` (présence/absence selon l'état).

**Critères d'acceptation.**

- [ ] En build de prod + preview, hors-ligne, un écran **déjà visité** (dashboard, planning)
      **se réaffiche** depuis le cache (pas d'erreur), et la **bannière** hors-ligne est
      visible.
- [ ] De retour en ligne, la bannière disparaît et les données se rafraîchissent au prochain
      chargement (NetworkFirst).
- [ ] Une **session Access expirée** (en ligne) mène toujours à l'écran « Session expirée »
      (le cache ne masque pas l'expiration ; l'`opaqueredirect` n'est pas mis en cache).
- [ ] Une **écriture** tentée hors-ligne affiche « Vous êtes hors-ligne… » (pas « Service
      indisponible »).
- [ ] Bannière : `role="status"`, contraste AA, ne recouvre pas la barre d'onglets.
- [ ] `pnpm nx run-many -t typecheck test lint -p web` vert.

**Comment vérifier.**

1. `pnpm nx run-many -t typecheck test lint -p web`.
2. **PWA/offline** (le SW n'est **pas** actif en Vite dev) : `pnpm nx build web && pnpm nx
preview web`, ouvrir la preview, visiter dashboard+planning (peupler le cache), puis
   devtools → Network → **Offline**, recharger : les écrans doivent s'afficher + bannière.
   Vérifier dans Application → Cache Storage la présence de `api-lecture-v1`.
3. Basculer online→offline→online et observer la bannière (événements `online`/`offline`).
4. Tester l'expiration Access : simuler une 302 opaque n'est pas en cache (inspection du
   cache : aucune entrée `status 0`).

**Pièges connus.** **Le SW ne tourne qu'en build de prod** — vérifier offline en
`build + preview`, jamais en `vite dev` (sinon « faux négatif »). Ne pas élargir le
`urlPattern` aux méthodes non-GET (les écritures ne doivent pas être mises en cache). Garder
`cacheableResponse.statuses: [200]` (sinon on met en cache l'`opaqueredirect` d'Access et on
casse le flux de reconnexion hors-ligne). Conserver `navigateFallbackDenylist: [/^\/cdn-cgi\//]`.
Le hook doit gérer l'absence de `navigator`/`window` côté tests (garde `typeof`).

**Dépendance.** Ordonner après Lots 1-3 (tous touchent `App.tsx`/`Coquille`). Indépendant sur
le fond.

**Modèle d'exécution recommandé.** **Opus 4.8** — la config workbox (sémantique NetworkFirst,
cacheableResponse, interaction avec le flux Access) et la garantie « jamais de contenu périmé
pris pour frais » demandent du jugement.

---

# LOTS BACKEND — « Fiabilité des rappels » (svc-notifications)

> **Contexte partagé.** Service `apps/svc-notifications` (NestJS + Drizzle + Postgres + NATS).
> Tests = **vitest unitaires, sans Postgres ni SMTP** (fakes en mémoire). Horloge : un port
> injectable **`CLOCK`** existe déjà (`apps/svc-notifications/src/scheduler/clock.ts:7-17`,
> défaut `horlogeSysteme = { maintenant: () => new Date() }`) et est **déjà** injecté dans le
> scheduler. Migrations : dossier `apps/svc-notifications/src/database/migrations/`, dernière
> = `0016_notification_cle_idempotence.sql`. **Ces deux lots ne nécessitent AUCUNE migration**
> (cf. décisions). Aucun contrat inter-services n'est modifié → `can-i-deploy` reste vert.

## Lot 5 — Reprise d'un envoi à la crèche bloqué ou échoué (GAP A)

**Objectif (parent & système).** _Avant_ : l'envoi du récap validé **à la crèche/école**
(`POST /v1/notifications/envois/etablissement`) réserve une ligne `envoi_etablissement` en
`EN_COURS` **avant** l'appel SMTP ; un crash/timeout entre la réservation et la finalisation
laisse la ligne **coincée en `EN_COURS` pour toujours**. Pire : à la **ré-action** du parent,
le code fait un `onConflictDoNothing` et **retourne la ligne coincée sans jamais rappeler le
mailer** → la crèche n'est jamais prévenue, et le parent ne peut pas débloquer la situation.
_Après_ : quand le parent relance l'envoi, une ligne **non terminale** (`EN_COURS` bloquée ou
`ECHEC`) est **reprise** — le mailer est ré-invoqué et la ligne finalisée ; une ligne
**terminale de succès** (`ENVOYE`/`DRY_RUN`) reste idempotente (aucun ré-envoi).

> **Décision structurante (hypothèse 5).** L'envoi est **human-in-the-loop** (le parent relit
> un brouillon puis clique « Envoyer »). On corrige donc la **reprise à la ré-action du
> parent** — **PAS** de reaper/cron qui ré-enverrait automatiquement un mail à une **vraie
> crèche** hors de la boucle humaine. Un reaper auto-sendeur serait un **défaut**, pas un
> correctif.

**Périmètre exact.**

- `apps/svc-notifications/src/envoi/envoi.service.ts` : méthode `envoyer` (119-226), helpers
  `envoiExistant` (369-393), `versResultat` (395-408).
- `apps/svc-notifications/src/envoi/envoi.module.ts` : fournir `CLOCK` au module envoi.
- Test : `apps/svc-notifications/src/envoi/envoi.service.spec.ts` (idempotence/ECHEC : 436-513).
- **Vérif front (mineure)** : `apps/web/src/notifications/RelectureEnvoi.tsx` — s'assurer
  qu'un résultat `EN_COURS`/`ECHEC` s'affiche comme « échec, réessayez », **jamais** comme
  succès. **Ajuster seulement si** le rendu actuel présente `EN_COURS` comme un succès.
- **Hors périmètre** : la table `envoi_etablissement` (aucune migration) ; le flux recap
  hebdo (Lot 6) ; l'allowlist mailer ; le contrat BFF (le champ `statut` de
  `EnvoiEtablissementResultat` peut déjà valoir `EN_COURS`/`ECHEC` — inchangé).

**Décisions déjà prises (exactes).**

1. **Injecter `CLOCK` dans `EnvoiService`** — remplacer les `new Date()` de `envoi.service.ts`
   (lignes 187 et 207) par `this.clock.maintenant()` ; l'injecter via le constructeur
   (`@Inject(CLOCK) private readonly clock: Clock`) et le fournir dans `envoi.module.ts`
   (`{ provide: CLOCK, useValue: horlogeSysteme }`, comme `scheduler.module.ts:36`). Import
   depuis `../scheduler/clock` (ou déplacer `clock.ts` en `../common/` si un lint de frontière
   l'exige — vérifier `nx lint`).
2. **Reprise status-aware** — dans `envoyer`, quand la réservation `EN_COURS` **échoue** par
   conflit (`insere.length === 0`, actuellement 166-176) : lire la ligne existante
   (`envoiExistant`) puis :
   - `statut ∈ { 'ENVOYE', 'DRY_RUN' }` (succès terminal) → **retourner** telle quelle
     (idempotent, aucun ré-envoi). Comportement actuel conservé pour ce cas.
   - `statut === 'ECHEC'` → **reprendre** : ré-exécuter le corps d'envoi (mise à jour
     `statut='EN_COURS'` de la ligne existante, appel `this.mailer.envoyer(...)` (180),
     finalisation `ENVOYE`/`DRY_RUN`/`ECHEC` (186-211)).
   - `statut === 'EN_COURS'` → distinguer _bloquée_ vs _concurrente_ par l'**âge** via
     `created_at` (schema.ts:332) et `this.clock.maintenant()` :
     - si `maintenant - created_at ≥ DELAI_REPRISE_EN_COURS_MS` → considérée **bloquée**
       (crash) → **reprendre** (comme `ECHEC`).
     - sinon → un envoi est **réellement en cours** (double-clic quasi simultané) →
       **retourner** la ligne `EN_COURS` sans ré-envoyer (honnête « en cours »).
   - Constante à ajouter en tête de service : `const DELAI_REPRISE_EN_COURS_MS = 2 * 60_000;`
     (2 min — très au-delà d'un timeout SMTP réaliste). Documenter par un commentaire que le
     risque résiduel de double-envoi concurrent au-delà de 2 min est négligeable et cohérent
     avec la tolérance « au plus un doublon » déjà documentée ailleurs (schema.ts:439-444 côté
     recap).
3. **Pas de nouvelle colonne** : l'âge se mesure sur `created_at` existant. Reprendre une
   ligne bloquée met `statut='EN_COURS'` **sans** réécrire `created_at` (auto-guérison : une
   nouvelle panne laisse `created_at` ancien → reprenable au prochain clic). _(Décision :
   éviter une migration pour ce cas rare et user-driven.)_
4. **Refactor propre** : extraire le corps « update EN_COURS → send → finalize » (aujourd'hui
   inline dans `envoyer`) en une méthode privée `executerEnvoi(ligneOuValeurs)` réutilisée par
   le chemin « première réservation » et le chemin « reprise », pour ne pas dupliquer l'appel
   mailer et la finalisation.

**Conventions à respecter.** Ne pas toucher au contrat BFF ni à la forme de
`EnvoiEtablissementResultat`. Garder l'insert initial en `onConflictDoNothing` (la
distinction se fait **après** le conflit). Logs : conserver le style pino structuré existant ;
sur une reprise, logger en `info` « reprise d'un envoi <foyer>/<semaine>/<etab> (statut
précédent: X) ». Tests vitest avec le fake DB `stores`-map (spec.ts:438,454,473) et
`vi.setSystemTime()`/clock injecté pour l'âge.

**Critères d'acceptation.**

- [ ] Un envoi dont la ligne est `ECHEC` puis re-tenté par le parent **ré-appelle le mailer**
      et finit `ENVOYE` (ou `DRY_RUN` en bac à sable).
- [ ] Une ligne `EN_COURS` **plus vieille que 2 min** est reprise (mailer ré-appelé) ; une
      `EN_COURS` **récente** n'est pas ré-envoyée (retour « en cours »).
- [ ] Une ligne `ENVOYE`/`DRY_RUN` n'est **jamais** ré-envoyée (idempotence préservée).
- [ ] Aucun changement de schéma ; aucune migration ajoutée.
- [ ] Le front n'affiche jamais un résultat `EN_COURS`/`ECHEC` comme un succès.
- [ ] `pnpm nx run-many -t typecheck test lint -p svc-notifications` vert ; si le front est
      touché, `-p web` vert aussi.

**Comment vérifier.**

1. `pnpm nx run-many -t typecheck test lint -p svc-notifications`.
2. Tests unitaires ajoutés dans `envoi.service.spec.ts` couvrant les 4 branches (ENVOYE →
   no-op ; ECHEC → resend ; EN_COURS vieux → resend ; EN_COURS récent → no-op), avec un clock
   contrôlé.
3. **Preuve bout-en-bout** (idempotence) : un test vérifie que **deux** appels successifs sur
   une ligne `ENVOYE` n'appellent le mailer qu'**une** fois, et que le chemin reprise l'appelle
   bien sur `ECHEC`.
4. `pnpm nx affected -t test` autour du service ; vérifier `pact-can-i-deploy` inchangé (aucun
   contrat modifié).

**Pièges connus.** L'`onConflictDoNothing` cible la contrainte unique
`envoi_etablissement_foyer_semaine_etab_uq` (schema.ts:336-342) — ne pas la modifier. Le fake
DB des tests est keyé **par l'objet table Drizzle** : bien passer l'objet `envoiEtablissement`.
`new Date()` restant ailleurs dans le service = à remplacer par le clock **uniquement** aux
sites 187/207 (finalisation) pour ne pas déstabiliser d'autres tests. Un éventuel lint de
frontière Nx peut refuser un import `scheduler/clock` depuis `envoi/` → si c'est le cas,
déplacer `clock.ts` dans un module commun du service et mettre à jour l'import du scheduler.
**Ne pas** introduire de `@Cron`/reaper.

**Modèle d'exécution recommandé.** **Opus 4.8** — machine à états, idempotence, respect du
human-in-the-loop, tests avec horloge.

---

## Lot 6 — Le rappel du mardi n'est jamais perdu en silence (GAP B)

**Objectif (parent & système).** _Avant_ : le rappel hebdo « validez la semaine prochaine »
est renvoyé à chaque tick tant que sa fenêtre est ouverte (mardi ≥ heure → dimanche, Paris),
mais la requête de reprise est **couplée à la semaine cible N+1** (`semaineProchaine(now)`) :
dès que le calendrier avance, un créneau resté `ECHEC` devient **structurellement inatteignable**
— jamais requêté, jamais retenté, **silencieusement abandonné** (seulement des logs `WARN`
indistincts d'un échec transitoire vite résolu). _Après_ : un créneau qui n'a **jamais** abouti
et dont la fenêtre est **close** passe à un **état terminal explicite `ABANDONNE`**, avec un
log **`error`** dédié + une métrique — le raté devient **visible et diagnosticable**, plus
jamais silencieux.

> **Décision structurante (hypothèse 6).** On **ne** re-livre **pas** spéculativement un rappel
> devenu périmé (faible valeur une fois la semaine commencée). La valeur est de **rendre le
> raté visible** pour permettre une intervention (recontacter le parent, diagnostiquer le SMTP).

**Périmètre exact.**

- `apps/svc-notifications/src/scheduler/scheduler.hebdo.ts` : `declencher` (130-152) ;
  constantes (48-61).
- `apps/svc-notifications/src/scheduler/envoi-recap.service.ts` : ajout d'une requête de
  balayage + d'une transition terminale (à côté de `aRetenter` 67-78 et `marquerEchec`
  114-129).
- `apps/svc-notifications/src/database/schema.ts` : enum applicatif `STATUTS_ENVOI_RECAP`
  (357-362) — **ajouter la valeur `'ABANDONNE'`** (la colonne `statut` est `varchar(16)` sans
  contrainte CHECK → **aucune migration DB**).
- Observabilité : réutiliser le logger pino structuré du service + le module
  `libs/observability` (métriques) si un compteur est déjà exposé ; sinon un `logger.error`
  structuré suffit (cf. décisions).
- Tests : `apps/svc-notifications/src/scheduler/scheduler.hebdo.spec.ts` (clock injecté,
  fakes) et `envoi-recap.service.spec.ts`.
- **Hors périmètre** : le flux d'envoi nominal, la fenêtre `estFenetreEnvoi` (226-235) pour le
  chemin **heureux** (inchangée), le ledger par-parent `envoi_recap_parent` et son
  `MAX_ESSAIS_PARENT`, l'envoi à la crèche (Lot 5).

**Décisions déjà prises (exactes).**

1. **Nouvel état terminal `ABANDONNE`** — ajouter `'ABANDONNE'` à `STATUTS_ENVOI_RECAP`
   (schema.ts:357-362). C'est une valeur `varchar` (9 car. ≤ 16) : **pas de migration**. Le
   type `StatutEnvoiRecap` en dérive automatiquement.
2. **Balayage additif, hors fenêtre** — dans `declencher` (scheduler.hebdo.ts:130-152),
   **avant** le gate de fenêtre `estFenetreEnvoi`, appeler une nouvelle étape
   `await this.abandonnerSlotsExpirees(maintenant)`. Ainsi un raté est signalé **même le
   lundi / hors fenêtre**. Structure cible :
   ```ts
   async declencher(): Promise<void> {
     if (this.enCours) return;
     this.enCours = true;
     try {
       const maintenant = this.clock.maintenant();
       await this.abandonnerSlotsExpirees(maintenant);      // NOUVEAU
       if (!this.estFenetreEnvoi(maintenant)) return;
       const semaineIso = this.semaineProchaine(maintenant);
       if (this.estJourCreation(maintenant)) await this.creerNotifications(semaineIso);
       await this.traiterEnvois(semaineIso);
     } finally { this.enCours = false; }
   }
   ```
   _(Respecter le garde de ré-entrance `this.enCours` existant, 96/131-134.)_
3. **Sélection des créneaux expirés** — nouvelle méthode dans `EnvoiRecapService`,
   `slotsNonTerminesExpires(semaineCible: string): Promise<EnvoiRecapHebdoRow[]>` : sélectionne
   les lignes `envoi_recap_hebdo` avec `statut ∈ { 'A_ENVOYER', 'ECHEC' }` **et**
   `semaineIso < semaineCible`. `semaineCible = this.semaineProchaine(maintenant)` (la semaine
   encore en fenêtre) : ainsi seules les semaines **strictement passées** (fenêtre close) sont
   balayées ; la semaine cible courante (encore retentée par `traiterEnvois`) est **exclue**.
   La comparaison `semaineIso < semaineCible` sur le format `"YYYY-Www"` est lexicographique et
   correcte, y compris au passage d'année (`"2026-W52" < "2027-W01"`).
4. **Transition terminale + alerte** — `abandonnerSlotsExpirees(maintenant)` :
   - récupère les slots via `slotsNonTerminesExpires(...)` ;
   - pour chacun : `update envoi_recap_hebdo set statut='ABANDONNE', maj_le=<clock>
where (foyer_id, semaine_iso)=... and statut in ('A_ENVOYER','ECHEC')` (compare-and-set
     sur le statut, pour ne pas écraser un `ENVOYE`/`DRY_RUN` gagné entre-temps) ;
   - émet un **`logger.error`** structuré (pas `warn`) : message « récap hebdo abandonné »
     avec champs `foyerId`, `semaineIso`, `statutPrecedent`, `erreur` (dernière erreur connue).
     C'est le signal terminal distinct d'un `ECHEC` transitoire.
   - **Métrique** : si le service expose déjà un compteur via `libs/observability`, incrémenter
     `recap_hebdo_abandonne_total` (labels `foyerId` **exclu** — cardinalité) ; sinon, se
     limiter au `logger.error` structuré (interrogeable) et documenter dans la PR qu'aucun
     compteur Prom n'existait à câbler. **Ne pas** ajouter de dépendance de métrique.
5. **Idempotence du balayage** — la transition `→ ABANDONNE` est un compare-and-set : rejouée,
   elle ne re-loggue plus (le `where statut in (...)` ne matche plus une fois `ABANDONNE`).
   Le `logger.error` n'est émis **que** pour les lignes réellement transitionnées (celles dont
   l'`update ... returning` renvoie une ligne).

**Conventions à respecter.** Horloge **injectée** (`this.clock.maintenant()`), jamais
`new Date()` dans le scheduler. Style pino structuré. Pas de `@Cron` (le service utilise un
`setInterval` maison, 48/112 — ne pas introduire `@nestjs/schedule`). Tests vitest avec le
clock mock (`scheduler.hebdo.spec.ts:57-59`) et le fake DB (84-93) ; le double
`EnvoiRecapService` en mémoire (25-36) doit apprendre la nouvelle méthode.

**Critères d'acceptation.**

- [ ] Un créneau `envoi_recap_hebdo` resté `ECHEC` pour une semaine dont la fenêtre est close
      passe à **`ABANDONNE`** au tick suivant (y compris hors fenêtre / lundi).
- [ ] La transition émet **un** `logger.error` structuré (`foyerId`, `semaineIso`,
      `statutPrecedent`) — distinct des `WARN` transitoires.
- [ ] Un créneau `ENVOYE`/`DRY_RUN` n'est jamais touché ; la semaine cible **courante**
      (fenêtre ouverte) n'est pas abandonnée prématurément.
- [ ] Rejouer le balayage n'émet pas de second `error` (idempotent).
- [ ] Aucune migration DB ; `STATUTS_ENVOI_RECAP` contient `'ABANDONNE'`.
- [ ] `pnpm nx run-many -t typecheck test lint -p svc-notifications` vert.

**Comment vérifier.**

1. `pnpm nx run-many -t typecheck test lint -p svc-notifications`.
2. Tests unitaires : (a) un slot `ECHEC` d'une semaine passée → `ABANDONNE` + `error` loggé
   (spy sur le logger) ; (b) un slot de la semaine cible courante **non** abandonné ; (c)
   idempotence (2e passe : pas de 2e `error`) ; (d) un `ENVOYE` intact. Utiliser le clock mock
   pour placer « maintenant » après la fenêtre d'une semaine donnée.
3. **Preuve de non-régression** : les tests existants du scheduler (envoi nominal dans la
   fenêtre) restent verts — le balayage additif ne doit pas changer le chemin heureux.
4. `pact-can-i-deploy` inchangé (aucun contrat modifié).

**Pièges connus.** Le gate `estFenetreEnvoi` retourne tôt le **lundi** et avant l'heure le
mardi : c'est pourquoi le balayage doit être **avant** le gate (sinon un raté n'est jamais
signalé le lundi). `semaineProchaine(now)` **avance** avec le calendrier — c'est justement le
mécanisme qui rend l'ancien créneau invisible ; s'appuyer dessus comme borne « semaine encore
en fenêtre » à exclure. La comparaison de semaines ISO en `varchar` est lexicographique
(valide ici) — **ne pas** parser en nombres. `NOTIF_SCHEDULER_FORCER=1` (test-only) court-circuite
la fenêtre : vérifier que le balayage se comporte bien avec ce flag activé dans les tests.
`STATUTS_ENVOI_RECAP_PARENT` (schema.ts:421-425) est un enum **différent** (par-parent) — ne
pas y toucher.

**Modèle d'exécution recommandé.** **Opus 4.8** — logique de fenêtre/temps, état terminal,
observabilité, tests avec horloge.

---

# LOT LIEN DE RAPPEL

## Lot 7 — Lien du mail de rappel : garde-fou au boot + URL publique (config)

**Objectif (parent).** _Avant_ : le lien « valider mon planning » du mail du mardi ouvre
`https://192.168.1.129/...` → le navigateur bloque (`ERR_CERT_AUTHORITY_INVALID`, certificat
non fiable) et, hors du réseau local, l'IP est de toute façon **injoignable** → le parent ne
peut pas valider depuis le mail. _Après_ : le lien pointe vers le **domaine public à
certificat valide** (joignable partout), et une **mauvaise configuration ne peut plus repartir
en silence** (le service refuse de démarrer).

> **Constat clé.** Le _chemin_ du lien est **déjà correct** (`…/foyers/:id/planning?semaine=…`,
> corrigé en #180, déployé). Le défaut est l'**URL de base** : `NOTIF_APP_URL` (et
> `NOTIF_PUBLIC_API_URL` pour le lien de désabonnement) valent `SERVER_ORIGIN`
> (`docker-compose.server.yml:175,179`), qui est réglé sur l'**IP LAN** du serveur en prod.
> **C'est de la configuration, pas du code.** ⇒ deux volets : une **action ops** (le vrai
> correctif) + un **garde-fou au boot** (anti-régression).

**Périmètre exact.**

- `apps/svc-notifications/src/config.ts` (`appUrl` ligne 88, `publicApiUrl` lignes 89-90).
- Le bootstrap du service (`apps/svc-notifications/src/main.ts`) — brancher la validation.
- Nouveau helper pur + test (`config.ts` ou un `config.guards.ts` voisin + `*.spec.ts`).
- **Action ops (hors code)** : `.env.server.enc` sur le serveur prod (sops/age).
- **Hors périmètre** : le **chemin** du lien (`scheduler.hebdo.ts:377`, `inbox.message.ts:55`)
  — **NE PAS TOUCHER**, il est correct. Le lien in-app (relatif) n'est pas concerné.

**Décisions déjà prises (exactes).**

1. **Action ops (le correctif réel — humaine, sur le serveur).** Régler l'origine publique des
   liens d'e-mail sur le **domaine public à certificat valide joignable par un parent
   hors-LAN**. D'après la mémoire du repo (`prod-deployment-facts.md`), c'est
   **`https://creche.testlens.dev`**. ⚠️ **VALEUR À CONFIRMER PAR L'HUMAIN** avant application
   (c'est LE correctif). Deux options :
   - si l'app est servie publiquement via ce domaine (Cloudflare Access l'exige déjà) et que
     `SERVER_ORIGIN` peut valoir le domaine public : poser `SERVER_ORIGIN=https://creche.testlens.dev` ;
   - si `SERVER_ORIGIN` doit rester l'origine LAN (CORS/gateway interne, cf.
     `docker-compose.server.yml:200`) : **découpler** en fixant séparément `NOTIF_APP_URL`
     **et** `NOTIF_PUBLIC_API_URL` sur le domaine public.
     Puis **recréer le conteneur `svc-notifications`**. Secrets via sops/age (cf.
     `prod-server-access.md`), jamais en clair dans le repo.
2. **Garde-fou au boot (code, exécutable).** Valider `appUrl` **et** `publicApiUrl` au
   démarrage. Helper pur `estUrlEmailPublique(url: string): boolean` → vrai si : `new URL(url)`
   parse **sans erreur**, `protocol === 'https:'`, et `hostname` **n'est pas** un littéral IP
   (IPv4 `^\d{1,3}(\.\d{1,3}){3}$`, ou IPv6 = `hostname.includes(':')`) **ni** `localhost`.
   Au bootstrap, **en production uniquement** (`process.env['NODE_ENV'] === 'production'`) : si
   `!estUrlEmailPublique(config.appUrl)` ou `!estUrlEmailPublique(config.publicApiUrl)` →
   **throw** avec un message clair : « NOTIF_APP_URL/NOTIF_PUBLIC_API_URL doit être une URL
   https à nom de domaine public (pas une IP ni localhost) : sinon les liens des e-mails sont
   injoignables ou à certificat invalide pour les parents. Valeur reçue : <url>. » Miroir du
   pattern « garde-fou secret désabo au boot » (#209) et de `verifierConfigProduction` côté
   gateway (chercher et suivre son style).
3. **Portée prod-only.** En dev/test (`NODE_ENV` ≠ production), le garde-fou est **inactif**
   (le défaut `http://localhost:4200` et les stacks e2e restent valides).
4. **Limite connue, documentée.** Le garde-fou attrape l'IP/http/localhost (dont le cas
   **actuel** `192.168.1.129`), mais **pas** un domaine interne non public (`creche.lan`
   passerait) : c'est l'**action ops** (point 1) qui garantit le bon domaine. Le garde-fou est
   le filet, pas le correctif.

**Conventions à respecter.** Aucune dépendance nouvelle (parsing via `URL`, pas de lib IP).
Helper **pur et testé**. Logger structuré avant le throw. Ne pas modifier la forme de
`ServiceConfig` (juste valider).

**Critères d'acceptation.**

- [ ] `NODE_ENV=production` + `NOTIF_APP_URL=https://192.168.1.129` → le service **refuse de
      démarrer** avec le message explicite ; idem `NOTIF_PUBLIC_API_URL`.
- [ ] `NODE_ENV=production` + `NOTIF_APP_URL=https://creche.testlens.dev` → démarre.
- [ ] `NODE_ENV=test`/dev + `http://localhost:4200` → démarre (garde-fou inactif).
- [ ] Le **chemin** du lien reste `…/foyers/:id/planning?semaine=…` (aucune modification de
      `scheduler.hebdo.ts`/`inbox.message.ts`).
- [ ] `pnpm nx run-many -t typecheck test lint -p svc-notifications` vert.
- [ ] **Action ops** exécutée : après avoir posé la valeur confirmée et recréé le conteneur,
      un mail (dry-run/log) montre un lien `https://<domaine public>/foyers/…` (à cocher au
      déploiement, hors CI).

**Comment vérifier.**

1. `pnpm nx run-many -t typecheck test lint -p svc-notifications`.
2. Test unitaire du helper : IP→false, `https://domaine.tld`→true, `http://…`→false,
   `localhost`→false ; + test que le bootstrap prod throw sur IP et passe sur domaine.
3. **Preuve du correctif réel** = ops : inspecter un lien émis après reconfiguration.

**Pièges connus.** NE PAS re-corriger le **chemin** (déjà bon, #180). Le garde-fou **doit**
être prod-only (sinon casse dev + e2e stack : `localhost`/`http`). `NOTIF_APP_URL` = `SERVER_ORIGIN`
en compose → changer `SERVER_ORIGIN` impacte **aussi** CORS/gateway (`:200`) : d'où l'option de
**découplage** (point 1). La valeur du domaine public doit être **confirmée par l'humain**.
Secrets = sops/age serveur, jamais dans le repo.

**Modèle d'exécution recommandé.** **Opus 4.8** pour le garde-fou (helper + branchement +
tests). **L'action ops (point 1) est HUMAINE** (serveur, secrets) — Opus la **documente** et la
**signale**, il ne l'exécute pas.

---

# LOTS MAIL AU SERVICE — semaine complète, lisible & éditable

## Lot 8 — Accepter un corps édité à l'envoi (pipeline + contrat)

**Objectif (système).** Ouvrir le pipeline d'envoi pour qu'un **objet + corps fournis par le
client** soient envoyés et journalisés **tels quels** (après validation + échappement HTML),
au lieu d'être toujours régénérés côté serveur. **Rétro-compatible** : sans corps fourni, le
comportement actuel (régénération depuis le delta) est **conservé** → _aucun changement visible
côté parent tant que L9 n'est pas livré_. Ce lot **prépare** L9.

**Périmètre exact.**

- svc-notifications : `envoi/envoi.dto.ts` (`envoiEtablissementSchema` 84-90),
  `envoi/envoi.controller.ts` (57-68), `envoi/envoi.service.ts` (`envoyer` 119-226 : appel
  `construire` 124, insert `sujet`/`corps` 143-162, envoi `html`/`text` 180-185).
- BFF : `bff/validations.controller.ts` (`envoiEtablissementSchema` 39-43, `envoyer` 197-211),
  `clients/notifications.client.ts` (276-300).
- Contrat : `contract/notifications.consumer.pact.spec.ts` (POST body 281-293).
- Tests : `envoi/envoi.service.spec.ts` (436-546).
- **Hors périmètre** : la composition « semaine complète » (L9, côté front) ; la table
  `envoi_etablissement` (colonnes `sujet varchar(300)` / `corps text` **déjà présentes** →
  **pas de migration**) ; destinataire/routabilité/dry-run/idempotence (**inchangés**).

**Décisions déjà prises (exactes).**

1. **DTO élargi, rétro-compatible** (svc **et** BFF, mêmes règles) : ajouter deux champs
   **optionnels** à `envoiEtablissementSchema` :
   - `sujet?: string` — `z.string().min(1).max(300)` (colonne `varchar(300)`).
   - `corps?: string` — texte brut, `z.string().min(1).max(20000)` (borne anti-abus ; colonne `text`).
   - Invariant : **les deux ensemble ou aucun** — `.refine(d => (d.sujet == null) === (d.corps == null), 'objet et corps doivent être fournis ensemble')` → sinon **400**.
2. **Service : corps fourni prioritaire, sinon régénération** — dans `envoyer` :
   - si `sujet`+`corps` fournis : `sujet = dto.sujet` ; `texte = dto.corps` ;
     `html = échapperEnHtml(dto.corps)` (échappe `& < >`, convertit `\n`→`<br>`, enveloppe dans
     un HTML minimal). **Jamais** de HTML brut du client.
   - sinon : `const b = this.construire(...)` (actuel) → `sujet=b.sujet, corps=b.corps, texte=b.texte`.
   - Le reste **inchangé** : destinataire **résolu serveur**, routabilité, dry-run, allowlist,
     insert `envoi_etablissement` (stocke le `sujet`/`corps` **réellement envoyés** — preuve
     exacte), idempotence `onConflictDoNothing`.
3. **Échappement** : helper pur `échapperEnHtml(texte): string` — réutiliser un utilitaire
   d'échappement existant dans `apps/svc-notifications/src/email/` s'il y en a un (chercher
   `escape`/`echapp`) ; sinon en écrire un pur + testé. Objectif : le corps client (texte) ne
   peut pas injecter de balises dans l'e-mail HTML.
4. **Pact** : élargir l'interaction POST pour couvrir les champs optionnels — **garder** une
   interaction « 3 ids seuls » (rétro-compat) **et ajouter** « avec `sujet`+`corps` ».
   **Régénérer le pact à blanc** puis re-vérifier `pact-can-i-deploy`.

**Conventions à respecter.** Zod (style DTO existant). Ne pas changer `EnvoiEtablissementResultat`.
Échappement **pur et testé**. **Pact** : régénération à blanc (mémoire : pact merge → doublons ;
régénérer). `/pacts` est dans `.prettierignore` (ne pas reformater). Le fake DB des tests est
keyé par l'objet table Drizzle.

**Critères d'acceptation.**

- [ ] `POST …/envois/etablissement` avec **`{ids}` seuls** → comportement **inchangé** (corps
      régénéré depuis le delta ; tests existants verts).
- [ ] Avec **`{ids, sujet, corps}`** → le mail envoyé **et** la ligne `envoi_etablissement`
      portent l'objet/texte **fournis** ; le `html` est l'**échappement** du texte (aucun HTML
      client brut n'atteint l'e-mail).
- [ ] `sujet` seul ou `corps` seul → **400** ; `sujet` > 300 ou `corps` > 20000 → **400**.
- [ ] destinataire/routabilité/dry-run/idempotence **inchangés**.
- [ ] **Aucune migration** ; pact régénéré ; `pact-can-i-deploy` **vert**.
- [ ] `pnpm nx run-many -t typecheck test lint -p svc-notifications api-gateway` vert.

**Comment vérifier.**

1. `pnpm nx run-many -t typecheck test lint -p svc-notifications api-gateway`.
2. Tests service : chemin « 3 ids » (régénération) ; chemin « ids+corps » (corps client
   envoyé/journalisé) ; échappement (une entrée `<b>x</b>` ressort échappée dans le html) ;
   400 sur objet/corps orphelin ou trop long.
3. **Preuve bout-en-bout** : un test asserte que la ligne journalisée contient le `corps`
   client quand fourni, et le `corps` régénéré sinon.
4. Régénérer le pact (commande de génération du repo) ; `pact-can-i-deploy`.

**Pièges connus.** La **rétro-compat est obligatoire** : les appels « 3 ids » doivent continuer
à fonctionner (L9 n'est pas encore là au moment où L8 merge). **Jamais** de HTML client brut
(toujours échapper). Régénérer le pact **à blanc** (doublons sinon). `/pacts` dans
`.prettierignore`. Ne pas laisser le client fournir le **destinataire**.

**Modèle d'exécution recommandé.** **Opus 4.8** — contrat inter-services, sécurité de
l'acceptation d'un corps client, échappement.

---

## Lot 9 — Brouillon « semaine complète », lisible et éditable avant l'envoi (front)

**Objectif (parent).** _Avant_ : à la dernière étape, le parent voit un aperçu **lecture
seule**, télégraphique, des **jours modifiés seulement** (« mardi 1 juillet — modifiée »).
_Après_ : il voit un brouillon **pré-rempli avec la semaine complète** de chaque enfant
concerné, **bien formulé** (phrases de parent), qu'il peut **corriger entièrement** (objet +
corps) avant l'envoi — **c'est son texte exact qui part** au service.

**Périmètre exact.**

- `apps/web/src/notifications/RelectureEnvoi.tsx` : `BlocEnvoiEtablissement` (87-204) ; le fetch
  (268-294) qui charge **déjà** `SemaineBesoins` mais n'en utilise que `.etablissements`.
- **Nouveau module pur** : `apps/web/src/notifications/brouillonSemaineComplete.ts` (+ `.test.ts`).
- `apps/web/src/api/client.ts` (`envoyerRecapEtablissement` 695-707) : passer `sujet`/`corps`.
- `apps/web/src/types/bff.ts` si un type de corps de requête est utile.
- `apps/web/src/styles.css` : styles des champs éditables si besoin (réutiliser l'existant).
- Tests : `RelectureEnvoi.test.tsx` (l'assertion `toHaveBeenCalledWith(FOYER_ID, SEMAINE, CRECHE_ID)`
  ligne 266-270 **change**).
- **Hors périmètre** : le backend (**L8**, dépendance dure) ; le calcul routable/dry-run (vient
  du brouillon serveur, conservé) ; `CarteNonRoutable` (établissement non joignable : **pas**
  d'édition, pas d'envoi — inchangée).
- **Dépendance dure : L8 mergé.**

**Décisions déjà prises (exactes).**

1. **La donnée semaine-complète est déjà côté navigateur.** `RelectureEnvoi` charge
   `SemaineBesoins` (`api.lireSemaineBesoins`, ligne 270) — qui contient `contrats:
ContratBesoinsSemaine[]` (`besoins` datés + base `semaineType`/`semaineAbcm`) et `jours`
   (7 dates lundi→dimanche) — mais n'utilise que `.etablissements`. **Propager** `semaine.contrats`
   et `semaine.jours` jusqu'à `BlocEnvoiEtablissement` (aucun nouveau fetch).
2. **Module pur de composition** `composerBrouillonSemaineComplete({ jours, contrats, brouillon }):
{ sujet: string; corps: string }` (texte brut) :
   - **Enfants concernés** = ceux de `brouillon.enfants` (validés avec modifs) ; pour chacun,
     retrouver son `ContratBesoinsSemaine` dans `contrats` **par `contratId`**.
   - **Corps** = français lisible, phrases complètes : salutation au service, une phrase d'intro
     (« Voici le planning **complet** de la semaine du <lundi> au <dimanche> pour <prénom(s)>,
     à jour après nos derniers changements. »), puis **par enfant** un bloc **jour par jour**
     (lundi→dimanche, les 7 `jours`) donnant l'**horaire/présence effectif** de chaque jour =
     base (`semaineType`/`semaineAbcm` du jour de semaine) **fusionnée** avec l'exception datée
     de `besoins` si présente, en **marquant discrètement** les jours modifiés (suffixe
     « (modifié) », dérivé de `brouillon.enfants[].deltaModifs.jours`). Clôture polie.
   - **Objet** = « Planning de la semaine du <date lundi> — <prénom(s)> ».
3. **Réutiliser le rendu de jour existant** (cohérence écran ↔ mail) : identifier la fonction
   qui, dans `apps/web/src/notifications/besoinsSemaine.ts` et/ou `apps/web/src/planning/`,
   calcule/rend la présence + services **effectifs** d'un jour (base ⊕ exceptions datées — la
   même qu'affiche le calendrier/éditeur) et l'employer dans le composeur. **Ne pas réinventer**
   la fusion base/exceptions (risque de bug de priorité). `dateLongueFr` (`utils/dates`) et
   `libelleMode` (`utils/libelles`) pour les libellés parent.
4. **UI éditable** dans `BlocEnvoiEtablissement` :
   - remplacer l'objet lecture seule (`<em>{brouillon.sujet}</em>`, ligne 146) par un
     `<input>` **contrôlé** (`<label>` « Objet »), pré-rempli avec le `sujet` composé ;
   - remplacer l'aperçu `<pre>` (lignes 151-154) par un `<textarea>` **contrôlé** (`<label>`
     « Message au service », multi-lignes, `rows` généreux, redimensionnable), pré-rempli avec
     le `corps` composé ;
   - **conserver** : le **destinataire** (résolu serveur), le **bandeau dry-run**, la **liste
     des enfants concernés** (repère de ce qui change), la **confirmation explicite** avant
     l'action sortante réelle ;
   - états `sujet`/`corps` en `useState` seedés par le composeur ; bouton **« Rétablir le texte
     proposé »** pour réinjecter le brouillon composé.
5. **Envoi** : `api.envoyerRecapEtablissement(foyerId, semaineIso, etablissementId, { sujet, corps })`
   → le POST inclut `sujet`+`corps` (L8).
6. **Validation front** (mêmes bornes que L8) : objet **non vide ≤ 300**, corps **non vide ≤
   20000** ; envoi désactivé si invalide + message clair.
7. **Accessibilité** : `<label>` liés (`htmlFor`/`id`), textarea haut, cibles ≥ 44px, messages
   d'erreur annoncés.

**Conventions à respecter.** `import type` (verbatimModuleSyntax). Pas de mémo manuel (React
Compiler). Module de composition **pur** (aucune dépendance React) et **testé**. Réutiliser les
helpers de rendu jour + `dateLongueFr`/`libelleMode`. Tokens CSS existants.

**Critères d'acceptation.**

- [ ] Le bloc d'envoi montre un **objet éditable** + un **corps éditable** pré-remplis avec un
      récap de la **semaine complète** (7 jours) de chaque enfant concerné, en français lisible,
      jours modifiés marqués « (modifié) ».
- [ ] Le rendu d'un jour dans le mail **correspond** à ce que le parent voit à l'écran (helper
      partagé, pas de logique de fusion dupliquée).
- [ ] Le parent peut tout modifier ; à l'envoi, **son texte exact** part (`envoyerRecapEtablissement`
      reçoit `{sujet, corps}`).
- [ ] Objet/corps vides ou trop longs → envoi bloqué, message clair.
- [ ] `CarteNonRoutable` inchangée (non joignable : ni édition ni envoi).
- [ ] `pnpm nx run-many -t typecheck test lint -p web` vert (`RelectureEnvoi.test.tsx` mis à jour).

**Comment vérifier.**

1. `pnpm nx run-many -t typecheck test lint -p web`.
2. Test du module pur : un enfant avec **1** jour modifié → le corps liste **les 7 jours** (pas
   seulement le modifié), le jour modifié porte « (modifié) ».
3. Test `RelectureEnvoi` : l'appel d'envoi contient l'objet + corps **édités**.
4. Rendu réel (stack docker + Vite dev, cf. `verif-ui-locale-stack.md`) : valider une semaine
   **avec** modif → dernière étape = champs éditables pré-remplis whole-week ; éditer ; envoyer
   en **dry-run** ; vérifier que le texte parti (résultat/log) est le texte édité.
5. **Preuve bout-en-bout (L8+L9)** : le corps édité côté front = celui journalisé/envoyé côté
   service (dry-run).

**Pièges connus.** **L8 doit être mergé** (sinon le POST avec `sujet`/`corps` échoue). Le fetch
`SemaineBesoins` **existe déjà** — juste **propager** `contrats`/`jours`, ne pas re-fetcher.
**Réutiliser le même rendu de jour que l'écran** (sinon incohérence écran ↔ mail = perte de
confiance). Le « jour effectif » = base ⊕ exceptions datées : **ne pas réinventer** la fusion.
`nx test web` ne typecheck pas. **Garder la confirmation explicite** avant l'envoi réel (mail à
une vraie crèche). Établissement **non-routable** = pas d'édition (garder `CarteNonRoutable`).

**Modèle d'exécution recommandé.** **Opus 4.8** — composition lisible du domaine, réutilisation
du rendu jour, UX d'édition + validation.

---

## 5. Récapitulatif & ordonnancement

| Lot | Titre                                              | Couche                          | Modèle                            | Dépend de              | Migration | Contrat         |
| --- | -------------------------------------------------- | ------------------------------- | --------------------------------- | ---------------------- | --------- | --------------- |
| 1   | Correctifs mobile-PWA & a11y coquille              | web                             | Opus (parties **Sonnet 5**)       | —                      | non       | inchangé        |
| 2   | Chargement unifié & annonce fiable                 | web                             | Opus (remplacements **Sonnet 5**) | 1 (ordre `App.tsx`)    | non       | inchangé        |
| 3   | Sélecteur « Mes familles » réel                    | web                             | Opus                              | **2** (ChargementPage) | non       | inchangé        |
| 4   | Conscience hors-ligne & cache                      | web                             | Opus                              | 1–3 (ordre `App.tsx`)  | non       | inchangé        |
| 5   | Reprise envoi crèche bloqué/échoué                 | svc-notifications               | Opus                              | —                      | **non**   | inchangé        |
| 6   | Rappel mardi jamais perdu (ABANDONNE)              | svc-notifications               | Opus                              | —                      | **non**   | inchangé        |
| 7   | Lien rappel : garde-fou boot + URL publique        | svc-notifications + **ops**     | Opus (+ action humaine)           | —                      | non       | inchangé        |
| 8   | Mail service : accepter un corps édité (pipeline)  | svc-notifications + api-gateway | Opus                              | —                      | **non**   | **Pact élargi** |
| 9   | Mail service : brouillon semaine complète éditable | web                             | Opus                              | **8** (pipeline)       | non       | inchangé        |

- **Front coquille (1→2→3→4)** : exécuter dans l'ordre (tous touchent `App.tsx`) ; rebaser après
  chaque merge. Dépendance **dure** : Lot 3 utilise `ChargementPage` du Lot 2.
- **Backend fiabilité + lien (5, 6, 7)** : indépendants du front et entre eux — parallélisables.
- **Mail au service (8 → 9)** : **L9 dépend de L8 mergé**. L8 backend + contrat ; L9 front.
- **Déploiement** : aucun nouveau **secret**, **aucune migration**. Une **action ops** (L7 :
  corriger l'URL publique dans `.env.server.enc` + recréer le conteneur `svc-notifications`) et
  **un contrat Pact élargi** (L8, rétro-compatible → `can-i-deploy` reste vert après
  régénération). Les lots front sont web-only ; les lots backend rebâtissent l'image
  `svc-notifications` (+ `api-gateway` pour L8). Un seul **release train** en fin de chantier ;
  **l'action ops L7 doit être appliquée au déploiement** (sinon les liens restent cassés).

---

## 6. Ce que ce chantier ne fait PAS (anti-périmètre, assumé)

- Pas de renommage d'URL `/foyers/` → `/familles/` (casserait des deep-links d'e-mails déjà
  envoyés).
- Pas de file d'attente d'écritures hors-ligne (seule la **consultation** est mise en cache).
- Pas d'horodatage par carte du contenu en cache (bannière globale à la place).
- Pas de reaper/cron qui ré-enverrait automatiquement un mail à une crèche (human-in-the-loop
  préservé).
- Pas de re-livraison tardive spéculative d'un rappel périmé (on rend le raté **visible**, on
  ne le rejoue pas indéfiniment).
- Pas de refonte de la barre de navigation, ni des écrans de fonctionnalité (déjà audités).
- Pas de re-correction du **chemin** du lien de rappel (déjà correct depuis #180) : L7 ne
  touche que l'**URL de base** (config) + un garde-fou boot.
- Mail au service : **pas de HTML libre** côté client (le parent édite du **texte brut**,
  échappé côté serveur) ; le **destinataire reste résolu serveur** (jamais éditable) ; la
  **semaine complète** ne concerne que les **enfants ayant une modification** (on n'ajoute pas
  les enfants sans changement).
- Pas de nouvelle colonne DB pour le corps édité (les colonnes `sujet`/`corps` existent déjà).
