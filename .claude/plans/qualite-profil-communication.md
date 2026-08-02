# Chantier qualité — « Profil & communication parent »

> **Livrable de planification.** Écrit par le directeur technique / designer-produit, à exécuter par Opus 4.8 (certains lots délégables à Sonnet 5, indiqué par lot).
> **Statut :** prêt à exécuter, en attente de relecture PO des hypothèses assumées (§3).
> **Date :** 2026-07-15. **Convention de nommage :** `qualite-<surface>.md` (comme `qualite-couts.md`, `qualite-etablissements.md`, `qualite-foyer-onboarding.md`).

Ce fichier est **auto-portant** : l'exécutant n'a ni la conversation d'audit, ni de mémoire préalable. Tout ce qui est nécessaire (chemins réels, décisions tranchées, libellés exacts, migrations, critères d'acceptation, commandes de vérification, pièges) est ici.

---

## 1. Contexte & objectif

L'application est un planner de crèche utilisé **en très grande majorité sur téléphone**, par des **parents** (pas des utilisateurs techniques), souvent en 4G, pressés, à une main. Plusieurs surfaces ont déjà eu une passe qualité dédiée (dashboard, planning, « valider ma semaine », établissements, foyer/onboarding, coûts). **La surface jamais auditée pour la qualité est celle de la communication & du compte du parent** : la page **Mon profil** (`/mon-profil`), la **cloche / inbox in-app** (dans l'entête), et la page publique de **désabonnement** (`/desabonnement`).

L'objectif n'est **pas** d'ajouter des fonctionnalités. C'est de faire franchir à cette surface le palier « prototype qui marche » → « produit professionnel » : **front** (clarté, mobile-first, états, langage parent, finition, a11y) **ET backend** (correction du domaine, idempotence, intégrité, résilience, contrats, sécurité). Un front impeccable sur un backend fragile n'est pas un produit — c'est un prototype mieux maquillé.

L'audit a mis au jour **trois bugs backend réels** (dont un **critique, actif en production**) qui minent la confiance du parent sans qu'il en voie la cause, et une série de défauts de finition front. Les trois bugs ont été **vérifiés de façon adversariale** (agents chargés de les réfuter) : **tous CONFIRMÉS**.

---

## 2. Décisions clés validées par le PO (réponses aux questions de cadrage)

1. **Cible :** « Profil & communication parent » (Mon profil + préférences notif + cloche/inbox + désabonnement).
2. **Ambition :** **front + backend combinés** (UX/finition **et** durcissement domaine/idempotence/intégrité/sécurité/contrats).
3. **Bug de ré-envoi du récap (L1) :** **correction complète incluse** dans ce chantier (suivi de livraison par destinataire). C'est le risque de confiance n°1 et l'envoi réel est actif en prod.
4. **Panneau cloche mobile (L6) :** **réutiliser le composant `Modale`** existant (bottom-sheet sur mobile) — on hérite gratuitement d'Échap / clic-extérieur / piège de focus / restauration du focus.
5. **Parent multi-foyer (familles recomposées) :** **hors périmètre**, gardé en **dette documentée** (§3, hypothèse H7). C'est une fonctionnalité (sélecteur de foyer), pas de la finition.

---

## 3. Hypothèses assumées (défauts pris — à corriger avant lancement si besoin)

Ces choix ont été tranchés faute d'objection ; ils sont **assumés dans le plan**. Le PO peut les corriger avant l'exécution.

- **H1 — Vouvoiement partout.** Le reste de l'app parle au « vous » (dashboard, notifications). Tous les nouveaux libellés parents sont au **vous** (« Comment souhaitez-vous être prévenu·e ? »), pas de tutoiement.
- **H2 — Pas de mode sombre.** L'app n'a aucun `prefers-color-scheme`/`data-theme` (uniquement des breakpoints de largeur). **On ne crée pas de mode sombre.**
- **H3 — Horodatage cloche en UTC.** Le nouvel affichage « JJ/MM/AAAA à HH:MM » de la cloche dérive l'heure en **UTC** (comme la date l'est déjà aujourd'hui), pour rester **déterministe en test** (aucun fuseau épinglé côté vitest web). Léger décalage possible (+1/+2 h) assumé sur un journal informationnel. (Détail : L6.)
- **H4 — « Tout marquer comme lu » = boucle client.** Pas de nouvel endpoint bulk (éviterait un aller-retour front/BFF/svc/pact/contrat disproportionné pour un lot front). On rejoue l'endpoint idempotent existant sur les non-lus **visibles**. (Détail : L6.)
- **H5 — RGPD minimal.** On surface uniquement `desabonneAt` (« E-mail désactivé le … ») ; **pas** `consentementAt` (bruit inutile).
- **H6 — L2 : garde minimale, pas de refonte du scheduler.** Le sous-item optionnel « ne réserver le créneau récap que si ≥1 carte existe » est **différé** (dette documentée) pour garder L2 minuscule et sans conflit de fichier avec L1/L3. (Détail : L2.)
- **H7 — Multi-foyer non traité** (cf. décision PO n°5). La cloche/préférences/profil restent scopés au **premier** foyer résolu ; limitation documentée dans le code (`moi.controller.ts:193-204`).
- **H8 — `can-i-deploy.mjs` inchangé.** On ne durcit pas le script de garde-déploiement (surrogate topologique ADR-0005) ; la vraie garde est la vérification provider des pacts. (Détail : L4.)
- **H9 — L1 : cap de tentatives par destinataire.** Au-delà de la correction anti-tempête (livraison au plus une fois par parent), on **borne** les ré-essais vers une adresse **définitivement invalide** (compteur `essais` + plafond), pour ne pas marteler le SMTP indéfiniment. (Détail : L1.)

> **Correction de fait (pour mémoire du repo) :** l'unicité de l'e-mail parent est **par foyer** (sur les parents actifs), **pas** globale `lower(email)`. Toute doc/mémoire disant « global » est périmée depuis le lot 5 foyer.

---

## 4. Synthèse de l'audit

### 4.1 Les 3 parcours réels du parent

- **A — « J'ouvre l'app, la cloche 🔔 affiche un chiffre ».** Panneau déroulant `maxWidth 360` calé à droite → serré/rognable à 375px ; **pas de fermeture Échap / clic-extérieur** ; **aucun état chargement/erreur/vide** au-delà d'une ligne ; date **sans heure** ; pas de « N sur M » ni « tout marquer lu ». 12 styles inline, classes CSS fantômes.
- **B — « Je règle comment je suis prévenu » (Mon profil).** Un « tableau type×canal » qui n'a **qu'une ligne** ; **jargon** (« canal », « notification de service ») ; feedback de sauvegarde ad-hoc au lieu du composant partagé ; état RGPD jamais montré. 20 styles inline.
- **C — « Je clique "Se désabonner" dans un e-mail ».** La mieux finie : POST au clic explicite (pas d'effet de bord sur GET), machine à états propre. Coince à la marge : jargon « canal ».

### 4.2 Grille backend — fragilités confirmées (adversarialement)

| #   | Sévérité               | Fragilité                                                                                                                                                                                                                                                                                   | Impact parent                                                                              |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| L1  | 🔴 **Critique (prod)** | **Tempête de ré-envoi du récap** : dédup au niveau du **slot foyer** mais envoi **par parent** sans suivi ; un co-parent injoignable fait repartir le slot en `ECHEC`, rejoué **toutes les 60 s** ⇒ le parent **principal** (trié en tête) reçoit le **même e-mail des centaines de fois**. | Boîte du parent principal spammée ; perte de confiance.                                    |
| L2  | 🟠 Haut (bon marché)   | **Snapshot vide figé** quand la planification est **indisponible** au tick de création du mardi ⇒ à la validation, faux « vous avez modifié le planning » ⇒ **brouillon de mail vers la vraie crèche/école**.                                                                               | Information fausse envoyée à un tiers au nom du parent.                                    |
| L3  | 🟡 Moyen               | **Doublons cloche** : `notification` append-only sans clé ; création in-app **avant** `marquerAbouti` ⇒ un échec/crash après insertion recrée les cartes au rejeu. `compterNonLus` charge tout en JS.                                                                                       | Cartes « à valider » dupliquées, compteur gonflé.                                          |
| L4  | 🟡 Moyen               | **Trous de contrats** : cloche (dont isolation cross-parent), désabo, 400 dernier-canal, 409 édition e-mail **non couverts par Pact** ; `can-i-deploy` reste vert malgré.                                                                                                                   | Une régression qui **fuiterait les notifs d'un autre parent** passerait en CI verte.       |
| L5  | 🟢 Bas                 | `GET /moi/profil` = 3 lectures svc-foyer séquentielles (jusqu'à ~12,6 s vs abort client 10 s), **aucune dégradation** ; secret HMAC désabo avec **fallback dev en dur** (garde compose-only).                                                                                               | Écran profil en erreur générique au moindre hoquet ; couche crypto nullifiée hors-compose. |

### 4.3 Verdicts adversariaux (résumé)

- **L1 : CONFIRMÉ.** Précision : le renvoi frappe les destinataires **ordonnés avant** celui qui échoue (tri principal-d'abord) ; **une simple try/catch ne suffit pas** — il faut **persister la livraison par parent**. Le chemin in-app est déjà sûr.
- **L2 : CONFIRMÉ.** Précision : le déclencheur est **la lecture dégradée** (`relire()===null` via `lirePlanning`→`undefined`), **pas** une semaine légitimement vide (qui renvoie `[null]`). Corriger exactement comme `calculer()` ; **vérifier que le scheduler re-tick** pour ne pas perdre la notification.
- **L3 : CONFIRMÉ.** Précision : la vraie fenêtre est **e-mail réussi puis `marquerAbouti` échoue/crash** entre les deux appels. **Réordonner ne corrige pas proprement** (transforme les doublons en cartes silencieusement perdues) ; il faut une **clé d'idempotence additive**.

---

## 5. Ordre d'exécution, dépendances & routage modèle

Un lot = une PR, exécutable et relisible isolément. **Respecter cet ordre à cause de fichiers partagés et de la numérotation des migrations.**

```
Backend svc-notifications :   L1 ──▶ L3        (L3 dépend de L1 : schema.ts, scheduler.hebdo.ts, migration 0015→0016)
                              L2               (indépendant : ne touche que validation.service.ts + son spec)
Contrats :                    L4               (indépendant)
Résilience :                  L5               (indépendant : api-gateway + svc-foyer)
Front :                       L6 ──▶ L7        (partagent styles.css ; faire L6 puis L7, ou rebaser)
Filet de tests :                     L7 ──▶ L8 ; L6 ──▶ L8   (L8 EN DERNIER : il asserte le comportement post-L6/L7)
```

**Vagues possibles en parallèle** (aucun fichier commun) : {L1, L2, L4, L5, L6}. Puis L3 (après L1), L7 (après/avec L6), enfin **L8 après L6 et L7**.

> ⚠️ **Migrations svc-notifications :** L1 et L3 ajoutent chacun une migration. **Ne jamais coder « 0015 » en dur dans les deux.** Générer via `pnpm drizzle-kit generate` (dossier `apps/svc-notifications`) qui **attribue automatiquement le prochain index** : la 1ʳᵉ mergée = `0015`, la 2ᵉ = `0016`. La 2ᵉ PR **régénère** contre l'état courant.

**Routage modèle :** tous les lots sont **Opus 4.8** (jugement d'implémentation : archi, domaine, contrats, langage parent, tests pertinents). Deux sous-tâches purement mécaniques sont **délégables à Sonnet 5 par l'exécutant Opus**, signalées en fin de lot (extraction CSS de L7 ; ajout des 3 tests axe de L8 une fois le comportement figé).

---

## 6. Conventions transverses (à respecter dans TOUS les lots)

**Général**

- Nx + pnpm. Toujours passer par **`pnpm nx`** (jamais l'outil sous-jacent). pnpm épinglé via corepack (`pnpm@10.34.2`), pas le pnpm global.
- ESLint 9 flat config **type-aware strict** (ratchet warn→error). `import type { … }` obligatoire pour les imports de types (**verbatimModuleSyntax**, web). `no-floating-promises` **erreur** → `void promesse` sur le fire-and-forget. `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. **Pas d'`enum`** (unions `as const`). Préférer `readonly` / **`readonly T[]`** (jamais `ReadonlyArray<T>`).
- **React 19 + React Compiler activé** : **ne pas ajouter `useMemo`/`useCallback`/`memo`**. Pas de `React.FC`. `react/jsx-boolean-value: never` (`<X disabled>` pas `disabled={true}`). `react/self-closing-comp`, `react/jsx-no-useless-fragment` = erreurs.
- DTO front dérivés du contrat OpenAPI (`apps/web/src/types/bff.ts`, `SchemaComposant<…>`/`ReponseJson<…>`) — **ne pas redéclarer** les shapes.
- Migrations Drizzle **additives + réversibles** (un seul train, pas d'ALTER destructif). **Générées** via `drizzle-kit`, jamais les métadonnées (`meta/_journal.json`, `meta/*_snapshot.json`) écrites à la main.
- Handlers/inserts inter-services **idempotents** (clé + `onConflictDoNothing`, ou `processed_event`).

**Commandes de vérification (exactes)**

- Web : **`pnpm nx run-many -t typecheck test -p web`** — ⚠️ **`nx test web` seul NE typecheck PAS** (piège documenté). Puis **`pnpm nx lint web`**.
- Service (`<svc>` ∈ {`svc-notifications`, `svc-foyer`, `api-gateway`}) : **`pnpm nx run-many -t typecheck test -p <svc>`** puis **`pnpm nx lint <svc>`**.
- e2e web (Playwright mocké, `dependsOn build`) : **`pnpm nx e2e web`**. e2e stack (⚠️ **destructif**, `docker compose down -v`) : `pnpm nx e2e-stack web`.
- Pacts : les specs **consumer** régénèrent les fichiers `/pacts/*.json`. **`/pacts` est dans `.prettierignore`** → **ne jamais reformater** ces JSON, ne jamais les éditer à la main. Provider verify = replay contre le vrai bundle + Postgres.
- Garde-déploiement : `node .github/workflows/scripts/can-i-deploy.mjs` doit rester **COMPATIBLE**.

**Couverture (web uniquement)** — ratchet **dur** : `statements 83 / branches 75 / functions 72 / lines 85`. Toute nouvelle branche UI **sans test** fait échouer la cible `test`. (Services : pas de ratchet web, mais couvrir les nouvelles branches par des tests unitaires.)

**Pièges d'environnement**

- **Worktrees** : si l'exécution se fait dans un worktree git, **préfixer tous les chemins** — sinon on édite par erreur le clone principal (« faux vert »). Après `pnpm install` dans un worktree, refaire l'install si les symlinks `node_modules/@creche-planner/*` sont périmés (via PowerShell, pas Bash).
- **Provider pact specs** spawnent `dist/main.js` : **builder le bundle** (`pnpm nx build <svc>`) avant le verify, sinon on rejoue un bundle périmé (faux vert).
- Tout **libellé vu par le parent** modifié doit être répercuté dans les specs qui l'assertent (unit + e2e).

**Tokens & classes de design réutilisables** (dans `apps/web/src/styles.css`, importé une fois par `main.tsx`)

- Couleurs : `--bleu #1d4ed8`, `--bleu-clair #eff6ff`, `--vert #15803d`, `--rouge #b91c1c`, `--gris #4b5563` (AA sur `--gris-clair`), `--gris-clair #f3f4f6`, `--bordure #e5e7eb`, `--ambre`, `--violet`. Espacement : `--esp-1..6` (0.25→2 rem). Titres : `--h1/--h2/--h3`.
- Classes : `.carte`, `.btn` / `.btn.secondaire` / `.btn.danger` (cible ≥ 44px), `.debit`(rouge) / `.credit`(vert) / `.muted`(gris), `.pastille` (compteur rouge), `.page-etroite`, `.champs-duo` (empile <480px), `.case-cochable` (cible ≥44px), `.sr-only`, `.skip-link`, `.etat-vide*`, `.spinner*`, `.squelette*`, `.modal*` (bottom-sheet mobile / dialog ≥768px), `.nav-onglets` (barre du pouce). Safe-area : `env(safe-area-inset-bottom)` sur la nav mobile.
- Composants UI (`apps/web/src/ui/`, tous testés) : **`Modale`** (dialog : Échap, clic-overlay, focus-trap, focus-restore, `refFocusInitial`) ; **`ModaleConfirmation`** ; **`Spinner`** (`role=status`, `label`) ; **`EtatVide`** (`ActionEtatVide[]` : `libelle`/`href`/`onClick`/`primaire`) ; **`StatutSauvegarde`** (`idle`/`en-cours`/`enregistre`/`erreur`, persiste « Enregistré à HH:MM ») ; `Badge` ; `Abbr`.
- Hooks (`apps/web/src/hooks/`) : `useTitrePage(titre)`, `useAnnonce()` (région `aria-live` polie + `annoncer`), `useAsync(fn, deps)` (AbortController + `reload()`), `useMoi()` (`{email, admin, foyers, loading}`).

---

## 7. Les lots

Chaque lot ci-dessous est **autonome** : il peut être lancé seul comme consigne d'implémentation.

---

### LOT L1 — 🔴 Stopper la tempête de ré-envoi du récap hebdo (ledger de livraison par parent)

**Modèle : Opus 4.8.** Backend `svc-notifications`. **À faire avant L3** (fichiers partagés + migration).

#### Objectif

- **Parent (avant → après) :** aujourd'hui, si un co-parent a une adresse invalide, le parent **principal** reçoit le récap « planning à valider » **en rafale** (le même e-mail toutes les 60 s pendant des jours). Après : chaque parent reçoit le récap **au plus une fois** par (foyer, semaine), même si un co-parent est injoignable et même si le scheduler retente.
- **Système :** l'idempotence de livraison passe du **slot foyer** au **destinataire** ; un échec partiel ne re-livre jamais un parent déjà servi.

#### Diagnostic (confirmé adversarialement)

La seule unité de dédup est le slot par **foyer** `envoi_recap_hebdo` (PK `(foyer_id, semaine_iso)`), terminal (`ENVOYE`/`DRY_RUN`) seulement **après** l'envoi à **tous** les destinataires. Dans `scheduler.hebdo.ts` `envoyerParParent` (~L436-484), la boucle `for (const dest of destinataires)` appelle `mailer.envoyer` **sans try/catch individuel** ; les destinataires sont triés **principal d'abord** (`destinataires.service.ts` ~L66-74). Si un destinataire **ultérieur** rejette (adresse invalide → `mailer.service.ts` `sendMail` ~L111 lève ; dry-run et allowlist **ne lèvent pas**), toute la méthode rejette → `traiterEnvois` (~L192-204) `catch` → `marquerEchec` → slot `ECHEC`. `aRetenter` (`envoi-recap.service.ts` ~L54-65) renvoie les slots `A_ENVOYER` **et** `ECHEC` ; le timer 60 s (`INTERVALLE_MS`) rejoue toute la fenêtre (mardi 8h → dimanche). À chaque tick, `envoyerRecapFoyer` reconstruit la liste et re-`envoyerParParent` vers **tout le monde** → le principal reçoit un mail identique à chaque tick. L'envoi réel est **actif en prod** (dry-run=false). Le chemin de repli `envoyerRepli` (un seul destinataire) n'est **pas** concerné.

#### Décisions déjà prises

1. **Ledger par destinataire** `envoi_recap_parent`, PK `(foyer_id, semaine_iso, parent_id)`, dans le style « enregistre-après » de `envoi_etablissement` (option a, retenue). Rejeté : (b) colonne `jsonb` sur le slot (read-modify-write non atomique multi-réplica ⇒ risque de renvoi) ; (c) suivi en mémoire (perdu entre ticks).
2. **Mécanique** dans `envoyerRecapFoyer`/`envoyerParParent` :
   - Charger une fois la carte des livraisons abouties du foyer/semaine (`livraisonsParFoyerSemaine`).
   - Pour chaque destinataire réel : **si déjà `ENVOYE`/`DRY_RUN` → SAUTER** (aucun `mailer.envoyer`, **aucune émission de jeton de désabonnement** — c'est un appel réseau one-shot à svc-foyer). Sinon : émettre jeton, composer, **`try { mailer.envoyer } catch`**. Succès → `marquerParentAbouti` (`ENVOYE` si réel, `DRY_RUN` si neutralisé) ; échec → `marquerParentEchec` (incrémente `essais`, cf. point 4) puis **continuer** la boucle.
   - **Après la boucle :** si ≥1 destinataire a échoué **ce passage** (et non capé), `envoyerParParent` **lève** (après avoir persisté les succès). Le slot bascule `ECHEC` via le `catch` existant → l'in-app (`creerNotificationsInApp`, ~L388) **n'est pas** créé et `marquerAbouti(slot)` n'est pas atteint (invariant préservé : in-app créé uniquement au passage qui solde tout le foyer).
   - Transitions gardées par **compare-and-set** `statut NOT IN ('ENVOYE','DRY_RUN')` : un parent livré n'est **jamais** rétrogradé ni relivré.
3. **Transition du slot → `ENVOYE`** = best-effort : dès qu'aucun destinataire ne reste en état **retryable** (échec `essais < CAP`). `DRY_RUN` si tous neutralisés. Sinon `ECHEC` (retryable) sans relivrer les aboutis.
4. **Cap de tentatives (H9) :** ajouter une colonne `essais integer NOT NULL DEFAULT 0` au ledger, incrémentée à chaque `marquerParentEchec`. Constante `MAX_ESSAIS_PARENT = 8`. Un parent avec `essais >= MAX_ESSAIS_PARENT` est **abandonné** pour cette semaine (traité comme « non-bloquant » pour la transition du slot, **journalisé** en `logger.warn` avec parentId/email). Objectif : ne pas marteler une adresse **définitivement invalide** indéfiniment (le parent-facing est déjà résolu par le ledger ; ceci borne le gaspillage SMTP et permet au slot de terminaliser).
5. **Repli inchangé** (`envoyerRepli`, un seul destinataire, déjà at-most-once).

#### Migration (additive, réversible)

Ajouter la table `envoiRecapParent` à `apps/svc-notifications/src/database/schema.ts` (miroir de `envoi_etablissement`/`envoi_recap_hebdo`), puis **générer** :

```
cd apps/svc-notifications && pnpm drizzle-kit generate   # attribue le prochain index (0015 OU 0016 selon l'ordre de merge L1/L3)
```

Schéma Drizzle attendu :

```ts
export const envoiRecapParent = pgTable(
  'envoi_recap_parent',
  {
    foyerId: uuid('foyer_id').notNull(),
    semaineIso: varchar('semaine_iso', { length: 8 }).notNull(),
    parentId: uuid('parent_id').notNull(),
    statut: varchar('statut', { length: 16 }).notNull(), // 'ENVOYE' | 'DRY_RUN' | 'ECHEC'
    email: varchar('email', { length: 320 }).notNull(), // adresse réellement visée (preuve figée)
    essais: integer('essais').notNull().default(0),
    messageId: varchar('message_id', { length: 998 }),
    erreur: text('erreur'),
    envoyeLe: timestamp('envoye_le', { withTimezone: true }),
    creeLe: timestamp('cree_le', { withTimezone: true }).notNull().defaultNow(),
    majLe: timestamp('maj_le', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.foyerId, t.semaineIso, t.parentId] })],
);
```

SQL = **CREATE TABLE seul** (aucun ALTER/DROP destructif). Down/rollback : `DROP TABLE "envoi_recap_parent";` (journal de reprise intra-fenêtre, aucune donnée historique métier). **Purement additive** : boot des conteneurs actuels inchangé, aucun secret/env/compose, aucun pact, `can-i-deploy` inchangé.

#### Périmètre

- **Dans :** `schema.ts` (+ type `EnvoiRecapParentRow`) ; migration générée (SQL + `meta/*`) ; `EnvoiRecapService` (`envoi-recap.service.ts`) : `livraisonsParFoyerSemaine(foyerId, semaineIso)` → Map<parentId, {statut, essais}>, `marquerParentAbouti(...)`, `marquerParentEchec(...)` (upserts `onConflictDoUpdate` avec garde compare-and-set) ; réécriture de `envoyerParParent` (try/catch par destinataire, skip-si-livré, cap) et chargement de la carte dans `envoyerRecapFoyer` ; tests.
- **Hors :** `envoyerRepli` ; le schéma/machine du slot `envoi_recap_hebdo` (reste la couche d'agrégation) ; tri des destinataires / allowlist du mailer ; tout front/`bff.ts` ; purge/rétention du ledger ; introduire un statut `EN_COURS`/reserve-then-send par parent (voir Pièges — risque de wedge).

**Fichiers :** `apps/svc-notifications/src/database/schema.ts`, `.../database/migrations/00NN_envoi_recap_parent.sql` (+ `meta/*`), `.../scheduler/envoi-recap.service.ts`, `.../scheduler/scheduler.hebdo.ts`, `.../scheduler/envoi-recap.service.spec.ts`, `.../scheduler/scheduler.hebdo.spec.ts`.

**Réutiliser :** `EnvoiService.envoyer` (`envoi/envoi.service.ts` ~L119-226) = patron canonique reserve-then-send ; `IssueEnvoiRecap` (`envoi-recap.service.ts` ~L17-21) pour l'agrégation du slot ; le double fidèle `fakeEnvoiRecap` (`scheduler.hebdo.spec.ts` ~L130-205) et le harnais `fakeDb` (`envoi-recap.service.spec.ts` ~L39-94) — **les étendre**, pas les réécrire ; `DestinataireActif` porte déjà `parentId` + `email`.

#### Critères d'acceptation

**Parent :** le principal reçoit le récap **au plus une fois** par (foyer, semaine) même avec un co-parent invalide et un retry 60 s sur toute la fenêtre ; un co-parent injoignable n'empêche pas les autres d'être servis ; aucune boîte parent ne reçoit d'e-mails en rafale.
**Technique :** sur N ticks (slot `ECHEC` à cause d'un destinataire qui lève), `mailer.envoyer` est appelé **exactement une fois** par parent déjà livré et retenté seulement pour le sous-ensemble en échec ; transitions du ledger gardées par compare-and-set (parent livré jamais rétrogradé) ; le slot ne passe `ENVOYE`/`DRY_RUN` que si aucun parent ne reste retryable ; `creerNotificationsInApp` déclenché **une seule fois** (au passage qui solde le foyer) ; **aucune émission outbox ajoutée** (le chemin scheduler n'écrit pas dans l'outbox — invariant confirmé) ; une adresse définitivement invalide est abandonnée après `MAX_ESSAIS_PARENT` (log) et le slot peut terminaliser ; migration additive, boot inchangé.

#### Comment vérifier

- `cd apps/svc-notifications && pnpm drizzle-kit generate` puis **inspecter le SQL** : un `CREATE TABLE` seul, `meta/_journal.json` gagne l'entrée d'index attendu.
- `pnpm nx run-many -t typecheck test -p svc-notifications` ; `pnpm nx lint svc-notifications`.
- **Nouveau test anti-tempête** (`scheduler.hebdo.spec.ts`) : 2 parents (`p1` principal, `p2`), `mailer.envoyer` résout pour `p1` et **rejette toujours** pour `p2` ; après 3× `declencher()`, asserter appels `p1 = 1`, `p2 = 3`, slot `ECHEC`, `creerInApp` **non appelé** ; puis faire réussir `p2` → `declencher()` → slot `ENVOYE`, `creerInApp = 1`.
- Test du cap : `p2` rejette sur `MAX_ESSAIS_PARENT` ticks → `p2` abandonné (log), slot terminalisé, `p1` toujours à 1 appel.

#### Pièges connus

- **Fenêtre de crash « enregistre-après » :** si le process meurt **entre** `sendMail` réussi et `marquerParentAbouti`, ce parent précis peut être renvoyé **une** fois au tick suivant. Dup unique (pas une tempête), symétrique au résidu accepté par `envoi_etablissement`. **NE PAS** « corriger » par un `EN_COURS`/reserve-then-send par parent : une ligne `EN_COURS` orpheline (crash avant `sendMail`) **coincerait** la sous-livraison. Documenter le résidu, ne pas sur-concevoir.
- **In-app :** garder l'invariant en faisant **lever `envoyerParParent` AVANT** l'appel `creerNotificationsInApp` (~L388) dès qu'un destinataire a échoué ce passage.
- **`onConflictDoUpdate` Drizzle :** le `SET` de l'upsert doit **ré-appliquer la garde** compare-and-set (`setWhere`/`targetWhere`) sinon un `ECHEC` pourrait écraser un `ENVOYE` concurrent (multi-réplica).
- **Ne pas** éditer `meta/_journal.json`/snapshot à la main — générer via drizzle-kit ; vérifier que le SQL est bien additif.
- Le double `fakeEnvoiRecap` est **fidèle** (il exerce la machine à états) : le modéliser aussi fidèlement pour le ledger par parent (skip-si-livré, compare-and-set), sinon le test anti-tempête passe **à tort**.
- `aRetenter` doit continuer à renvoyer les slots `ECHEC` (voulu — le sous-ensemble en échec est retenté) ; ne pas y toucher.

---

### LOT L2 — 🟠 Garde de nullité du snapshot mardi (pas de faux « planning modifié » à la crèche)

**Modèle : Opus 4.8.** Backend `svc-notifications`. Indépendant (ne touche que `validation.service.ts`).

#### Objectif

- **Parent (avant → après) :** aujourd'hui, si la planification est momentanément indisponible au tick de création du mardi, un snapshot **vide** est figé pour la semaine ; à la validation, chaque jour paraît « modifié » et un **brouillon de mail part vers la vraie crèche/école**. Après : en cas d'indisponibilité, la carte « à valider » apparaît simplement **un tick plus tard** avec le **vrai** planning ; **aucun faux « vous avez modifié le planning »**.
- **Système :** symétrie rétablie entre le lecteur de création (`notifier`) et le lecteur de validation (`calculer`) sur le signal « lecture dégradée ».

#### Diagnostic (confirmé adversarialement)

`validation.service.ts` `notifier()` (~L70-103) fige `snapshot = extraireSemaine(plannings ?? [], …)` **sans garde de nullité**, contrairement à `calculer()` (~L221-232) qui fait `if (plannings === null) return { jours: [] }`. `relire()` (~L239-252) renvoie `null` **uniquement** sur lecture dégradée (un mois revient `undefined` via `planification.client.ts` `lirePlanning` → repli `executerOuRepli`), distinct de `[null]` = « mois disponible mais aucune saisie » (= semaine légitimement vide). Le `?? []` collapse cette distinction ⇒ snapshot vide gelé (insert idempotent `onConflictDoNothing`, jamais réécrit). À la validation, `calculerDelta(∅, réel)` marque **tous** les jours ⇒ `VALIDEE_AVEC_MODIFS` ⇒ émission `SemaineValidee.v1` + brouillon établissement.

#### Décisions déjà prises

- **Option (a) : sauter la création** quand la lecture est dégradée, mirroir exact de `calculer()`. Dans `notifier()` :
  ```ts
  const plannings = await this.relire(contratId, semaineIso);
  if (plannings === null) {
    this.logger.warn(
      `Semaine ${semaineIso} contrat ${contratId} — planification indisponible, notification différée au prochain tick`,
    );
    return false; // non créée ; un tick mardi ultérieur retente avec les vraies données
  }
  const snapshot = extraireSemaine(plannings, joursDeLaSemaine(semaineIso));
  // …insert / onConflictDoNothing / returning inchangés…
  ```
- **Auto-guérison :** `creerNotifications` (`scheduler.hebdo.ts` ~L156-175) rappelle `notifier` **à chaque tick mardi (~60 s)** de `heureDeclenchement` à fin de journée Paris ⇒ une panne transitoire est récupérée en minutes. `return false` est sûr (le scheduler **ignore** déjà la valeur de retour). Mettre à jour la **JSDoc** de `notifier` (~L59-69) : `false` = « non créée (conflit **ou** dégradé-différé) ».
- **Garder le booléen** (pas de retour discriminé — aucun appelant ne le consomme comme signal).
- **Ne pas** changer le schéma (le snapshot reste `NOT NULL` ; on **n'insère pas**, on ne stocke pas de sentinelle).
- **H6 — Sous-item optionnel DIFFÉRÉ :** le « ne réserver le créneau `envoi_recap_hebdo` que si ≥1 `notification_hebdo` existe pour la semaine » (fenêtre récap-sans-carte sur panne multi-heures) est **hors périmètre L2** — évite un conflit de fichier avec L1/L3 sur `scheduler.hebdo.ts`. Documenté ici comme **dette** : sur une panne de planification durant **toute** la journée du mardi, un récap peut partir sans carte in-app correspondante (strictement plus bénin que le bug corrigé). À traiter dans une session dédiée si souhaité.

#### Périmètre

- **Dans :** garde de nullité dans `notifier` (+ WARN, + JSDoc) ; tests unitaires.
- **Hors :** `calculer`/`relire`/`valider` (déjà correctement gardés) ; tout schéma/migration ; le client planification, son contrat/timeouts/circuit-breaker, tout pact ; la mécanique exactly-once d'envoi ; le sous-item réservation (différé).

**Fichiers :** `apps/svc-notifications/src/validation/validation.service.ts`, `.../validation/validation.service.spec.ts`. _(Ne PAS toucher `scheduler.hebdo.ts` — garde L2 sans conflit avec L1/L3.)_

**Réutiliser :** `relire()` (signal null=dégradé) directement ; `calculer()` comme précédent exact de la garde `=== null` ; helpers de spec `fakeBase()`/`fakeClient()`/`absence()` + constantes `CONTRAT_ID`/`FOYER_ID`/`SEMAINE`.

#### Critères d'acceptation

**Parent :** aucun faux « vous avez modifié le planning » vers la crèche/école causé par une panne de planification au tick de création ; la carte « à valider » apparaît un tick plus tard avec la **vraie** semaine ; une semaine **légitimement vide** produit toujours une carte (vide) normale (le fix ne supprime pas les notifications légitimes).
**Technique :** `relire()===null` dans `notifier` court-circuite (aucune ligne `notification_hebdo` insérée, `return false`, WARN) ; aucun snapshot vide persisté pendant une dégradation ; un tick ultérieur avec planification disponible insère le vrai snapshot via le même `onConflictDoNothing` ; aucun changement de la logique de diff `VALIDEE_AVEC_MODIFS`, de l'émission outbox, du schéma, des migrations ou d'un pact ; `can-i-deploy` inchangé.

#### Comment vérifier

- `pnpm nx run-many -t typecheck test -p svc-notifications` ; `pnpm nx lint svc-notifications`.
- **Nouveaux tests** (`validation.service.spec.ts`) : (1) `notifier` avec client **dégradé** — `fakeClient({ '2026-06': undefined, '2026-07': undefined })` (undefined = dégradé ; `SEMAINE` 2026-W27 chevauche les deux mois → `relire` renvoie `null`) → asserter `cree===false` et `lignes.length===0`. (2) « un tick ultérieur (planif rétablie) fige le vrai snapshot » — même `fakeBase`, client sain `fakeClient({ '2026-06': { absences:[absence('2026-06-29')] } })` insère une ligne au snapshot peuplé (auto-guérison). (3) Régression : après un skip dégradé, `valider(CONTRAT_ID, SEMAINE)` lève `NotFoundException` (aucune ligne figée).
- **Confirmer** que les nouveaux tests **échouent** contre le code actuel (snapshot vide figé) et passent après la garde.

#### Pièges connus

- **Distinguer les deux « vides » :** `relire()` renvoie `null` **seulement** sur lecture dégradée. Un tableau contenant des entrées `null` (= mois disponible sans saisie) = semaine vide **légitime** qui **doit** figer un snapshot vide. Garder sur `plannings === null`, **jamais** sur la vacuité du snapshot extrait.
- Dans le `fakeClient` du spec : une clé de mois **présente à `undefined`** = dégradé ; une clé de mois **absente** = `null` (pas de saisie). Pour forcer `relire()===null`, mettre le **premier** mois couvert à `undefined`.
- Le `false` conflate désormais « conflit/déjà notifiée » et « dégradé-différé » : sûr aujourd'hui (retour ignoré) mais **mettre à jour la JSDoc**.
- **Pas** de migration, pas de snapshot nullable — le fix est de **ne pas insérer**. Aucun `/pacts` touché.

---

### LOT L3 — 🟡 Idempotence de création de l'inbox in-app + compteur `COUNT` SQL

**Modèle : Opus 4.8.** Backend `svc-notifications`. **À faire APRÈS L1** (partage `schema.ts` + `scheduler.hebdo.ts` + numérotation de migration).

#### Objectif

- **Parent (avant → après) :** après un échec/rejeu du scheduler, le parent voit aujourd'hui **des cartes « à valider » dupliquées** et un **compteur cloche gonflé**. Après : **une seule** carte par (parent, type, semaine), compteur exact.
- **Système :** création in-app rendue **idempotente** par clé métier (au lieu de dépendre de l'ordre création/`marquerAbouti`), sans transaction inter-services.

#### Diagnostic (confirmé adversarialement)

Table `notification` (`schema.ts` ~L424-449) append-only, **sans clé métier unique** (colonnes `id/parent_id/type/sujet/corps/lien/cree_le/lu_le`, **pas de colonne `semaine`**). `InboxService.creer` (`inbox.service.ts` ~L57-66) = insert nu. `creerNotificationsInApp` (`scheduler.hebdo.ts` ~L494-526) s'exécute **après** l'e-mail abouti mais **avant** `marquerAbouti` : si `marquerAbouti` échoue (ou crash) **après** l'insertion in-app, le slot repart en `ECHEC` → rejeu → **recrée** les cartes. La vraie fenêtre = e-mail réussi puis `marquerAbouti` échoue/crash (le chemin échec-mailer, lui, lève **avant** l'insert, déjà sûr). `compterNonLus` (~L104-112) charge toutes les lignes non lues en JS (`lignes.length`) au lieu d'un `COUNT` SQL.

#### Décisions déjà prises

- **Clé d'idempotence métier additive (option a).** Colonne nullable `cle_idempotence varchar(120)` + contrainte **UNIQUE `(parent_id, cle_idempotence)`**. Clé dérivée côté appelant = `` `${type}:${semaineIso}` `` (ex. `VALIDATION_HEBDO:2026-W27`), passée par le scheduler à `inbox.creer` qui insère en **`onConflictDoNothing({ target: [notification.parentId, notification.cleIdempotence] })`**. Un rejeu (même parent/type/semaine) = **no-op** → zéro doublon, **quel que soit l'ordre** création/`marquerAbouti` (donc aucun réordonnancement).
- **Back-compat par la sémantique Postgres :** les `NULL` sont **distincts** dans une UNIQUE ordinaire → lignes legacy (`cle_idempotence = NULL`) coexistent librement, comportement append-only préservé. **Pas de back-fill** (miroir de la décision `lien`/0013). **UNIQUE ordinaire**, pas d'index partiel, **pas de `NULLS NOT DISTINCT`**.
- **Rejetées :** (b) déplacer la création in-app dans la transaction du slot (ne fournit pas de clé, impose un `tx` inter-services, ne couvre pas crash-then-replay proprement) ; (c) UNIQUE `(parent_id, lien)` (le `lien` n'encode pas le `type` → collision entre types futurs partageant la même semaine ; dépend d'un `lien` non-null).
- **Compteur :** réécrire `compterNonLus` en `select({ n: count() })` + `lignes[0]?.n ?? 0` (patron `svc-planification/.../etablissement.service.ts` ~L232-238).

#### Migration (additive, réversible)

Éditer `schema.ts` (table `notification`) : colonne `cleIdempotence: varchar('cle_idempotence', { length: 120 })` + dans le tableau d'extras, `unique('notification_parent_id_cle_idempotence_unique').on(table.parentId, table.cleIdempotence)` (`unique` déjà importé) — **conserver** `index('notification_parent_id_idx')`. Puis :

```
cd apps/svc-notifications && pnpm drizzle-kit generate --name notification_cle_idempotence
```

SQL attendu (2 ordres additifs, **le prochain index libre** — probablement `0016` si L1 est mergé avant) :

```sql
ALTER TABLE "notification" ADD COLUMN "cle_idempotence" varchar(120);
--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_parent_id_cle_idempotence_unique" UNIQUE("parent_id","cle_idempotence");
```

Down/rollback : `DROP CONSTRAINT … ; DROP COLUMN "cle_idempotence";`. Sûr (colonne neuve NULL partout → aucun conflit à la création de la contrainte). Aucun pact, `can-i-deploy` inchangé, migration compatible rolling deploy.

#### Périmètre

- **Dans :** colonne + UNIQUE dans `schema.ts` ; migration générée ; `CreerNotificationInApp` (`inbox.service.ts` ~L29-37) gagne un champ **requis** `cleIdempotence: string | null` ; `InboxService.creer` insère en `onConflictDoNothing` sur la cible ; `creerNotificationsInApp` (`scheduler.hebdo.ts` ~L506-519) dérive et passe la clé ; `compterNonLus` en `COUNT` ; tests.
- **Hors :** colonne `semaine` sur `notification` ; back-fill legacy ; réordonnancement/transaction inter-services ; rendre `lien` NOT NULL ; `messageValidationHebdo` ; tout front/cloche ; index partiel / `NULLS NOT DISTINCT`.

**Fichiers :** `apps/svc-notifications/src/database/schema.ts`, `.../database/migrations/00NN_notification_cle_idempotence.sql` (+ `meta/*`), `.../inbox/inbox.service.ts`, `.../scheduler/scheduler.hebdo.ts`, `.../inbox/inbox.service.spec.ts`, `.../scheduler/scheduler.hebdo.spec.ts`.

**Réutiliser :** patron `COUNT` de `etablissement.service.ts` (~L232-238) ; patron `onConflictDoNothing({ target: [...] })` de `envoi-recap.service.ts` (~L40-47) ; précédent additif `0013_notification_lien.sql`. `count` s'importe en **valeur** depuis `drizzle-orm` (pas `import type`).

#### Critères d'acceptation

**Parent :** après un échec de `marquerAbouti` suivi d'un rejeu, **une seule** carte « Planning de la semaine … à valider » ; compteur cloche = vrai nombre de non-lus ; notifications legacy (sans clé) toujours affichées, inchangées.
**Technique :** `notification` porte `cle_idempotence` nullable + UNIQUE `(parent_id, cle_idempotence)` ; migration additive/réversible ; deux `creer` avec la même clé n'insèrent qu'une ligne, une clé `NULL` insère toujours ; le scheduler passe `` `${TYPE_VALIDATION_HEBDO}:${semaineIso}` `` ; `compterNonLus` exécute un `SELECT count()` (0 pour un parent sans non-lu) ; typecheck+test+lint verts ; `can-i-deploy` inchangé.

#### Comment vérifier

- `cd apps/svc-notifications && pnpm drizzle-kit generate --name notification_cle_idempotence` puis **inspecter** : 2 ordres additifs (`ADD COLUMN` puis `ADD CONSTRAINT UNIQUE`), aucun DROP/ALTER destructif, contrainte nommée.
- `pnpm nx run-many -t typecheck test -p svc-notifications` ; `pnpm nx lint svc-notifications`.
- Revue diff : `onConflictDoNothing` cible **exactement** `[notification.parentId, notification.cleIdempotence]`.

#### Pièges connus

- `onConflictDoNothing` doit cibler **exactement** les colonnes de la contrainte UNIQUE, sinon PG « no unique or exclusion constraint matching the ON CONFLICT specification ». (D'où le refus d'un index partiel : il obligerait à répéter le prédicat via `targetWhere`.)
- **Ne pas** ajouter `NULLS NOT DISTINCT` — c'est la distinction des NULL par défaut de Postgres qui autorise plusieurs lignes legacy append-only.
- `exactOptionalPropertyTypes` : `cleIdempotence` est un champ **requis** `string | null` (pas `?:`), fourni explicitement (`= null`) partout où l'on construit `CreerNotificationInApp`.
- L'ajout de la colonne grossit `NotificationRow` : toutes les factories complètes des specs (ex. `ligne()`) doivent inclure `cleIdempotence`.
- La création in-app **reste avant** `marquerAbouti` — voulu, l'idempotence vient désormais de la **clé**, pas de l'ordre. Ne pas réintroduire de réordonnancement.
- **Coordination L1/L3 :** si L1 est déjà mergé, sa migration a pris `0015` → celle-ci sera `0016`. **Régénérer** contre l'état courant, ne pas coder l'index en dur. `scheduler.hebdo.ts` a été modifié par L1 → **rebaser** proprement (L1 change `envoyerParParent`/`envoyerRecapFoyer`, L3 change seulement l'appel `inbox.creer` dans `creerNotificationsInApp`).

---

### LOT L4 — 🟡 Combler les 4 trous de contrats (cloche+isolation, désabo, dernier-canal, édition e-mail)

**Modèle : Opus 4.8.** Tests de contrat uniquement (`api-gateway` consumer + `svc-*` provider). Indépendant.

#### Objectif

- **Parent (avant → après) :** aujourd'hui, une régression backend qui **ferait fuiter les notifications d'un autre parent**, casserait le désabonnement, ou laisserait couper **tous** les canaux, passerait en **CI verte**. Après : chacune de ces garanties est **verrouillée par un contrat** qui échoue si le comportement dérive.
- **Système :** 4 surfaces inter-services exercées par le BFF mais non contractées deviennent couvertes (consumer + provider verify).

#### Diagnostic

4 surfaces non contractées : (1) **inbox** `GET /api/moi/notifications` + `POST /api/moi/notifications/:id/lu` **dont le 404 cross-parent** (l'isolation repose sur `and(eq(id), eq(parentId))` dans `inbox.service.ts` ~L91-101) ; (2) **désabo** `POST /api/desabonnement` 204/409/400 ; (3) **préférences** PUT **400 dernier-canal** (seul le happy-path est contracté) ; (4) **parent PUT** collision e-mail **409** à l'édition (seul le POST-add est contracté). `can-i-deploy.mjs` est un surrogate topologique (vérifie juste que le fichier pact existe et a ≥1 interaction).

#### Décisions déjà prises

- Ajouter les interactions **consumer** dans le style **PactV3/MatchersV3** existant de chaque spec, ajouter les **stateHandlers** provider manquants, et **épingler** le secret désabo côté provider svc-foyer pour que les jetons vérifient. **Ne PAS modifier `can-i-deploy.mjs`** (H8) : le provider verify rejoue chaque interaction contre le vrai bundle + Postgres = la vraie garde ; coupler le gate déploiement à du texte libre français churn-prone créerait des faux-blocages.
- **Interactions à ajouter** (résumé auto-portant ; reproduire le style des specs existantes) :

  **`notifications.consumer.pact.spec.ts` (provider `svc-notifications`)** — importer le matcher `integer` ; constantes `PARENT_INBOX_ID`, `AUTRE_PARENT_ID`, `NOTIF_INBOX_ID` (UUID v4 valides), état `ETAT_INBOX = 'un parent a une notification in-app non lue'` :
  1. **Liste** — `given(ETAT_INBOX,{parentId,id})` · GET `/api/moi/notifications?parent=<PARENT_INBOX_ID>` → 200 `{ notifications: eachLike({ id, type:'VALIDATION_HEBDO', sujet, corps, lien, creeLe, luLe:null }), nonLus: integer(1) }`.
  2. **Accusé 200** — POST `/api/moi/notifications/<NOTIF_INBOX_ID>/lu?parent=<PARENT_INBOX_ID>` → 200, objet unique avec `luLe` string (prouve la pose).
  3. **404 cross-parent (LE cas sécurité)** — POST `/api/moi/notifications/<NOTIF_INBOX_ID>/lu?parent=<AUTRE_PARENT_ID>` → 404 `{ statusCode:404, message:'notification inconnue', error:'Not Found' }`.

  **`foyer.consumer.pact.spec.ts` (provider `svc-foyer`)** — signer les jetons **en inline** avec `node:crypto` (frontière : ne pas importer `signerJeton` de svc-foyer) :

  ```ts
  import { createHmac } from 'node:crypto';
  const SECRET_DESABO = 'pact-desabo-secret'; // DOIT == l'env épinglé côté provider
  const EXP_LOINTAIN = 4102444800; // 2100-01-01, epoch s
  function signerJetonTest(jti: string, exp: number): string {
    const p = Buffer.from(JSON.stringify({ jti, exp }), 'utf8').toString(
      'base64url',
    );
    const s = createHmac('sha256', SECRET_DESABO)
      .update(p)
      .digest()
      .toString('base64url');
    return `${p}.${s}`;
  }
  ```
  - **A (204)** `given('un jeton de désabonnement valide coupe un canal non critique', …)` · POST `/api/desabonnement` body `{ token: signerJetonTest(JTI_204, EXP_LOINTAIN) }` → **204** (pas de corps).
  - **B (409)** `given('un jeton de désabonnement couperait le dernier canal actif', …)` · body `{ token: TOKEN_409 }` → 409 `{ statusCode:409, message:'ce canal ne peut pas être coupé : au moins un canal doit rester actif', error:'Conflict' }`.
  - **C (400)** `given('un jeton de désabonnement valide …')` (réutilise l'état A) · body `{ token:'jeton.invalide' }` → 400 `{ statusCode:400, message:'lien de désabonnement invalide ou expiré', error:'Bad Request' }`.
  - **D (préférences 400 dernier-canal)** — **réutilise** l'état existant `ETAT_FOYER_AVEC_PREFERENCES` (EMAIL stocké `actif=false`) · PUT `/api/foyers/<FOYER_REFERENCE_ID>/parents/<PARENT_REFERENCE_ID>/preferences` body `{ preferences:[{ typeNotification:'VALIDATION_HEBDO', canal:'IN_APP', actif:false }] }` → 400 `{ statusCode:400, message:'au moins un canal doit rester actif pour VALIDATION_HEBDO', error:'Bad Request' }`.
  - **E (parent PUT collision 409)** — **réutilise** `ETAT_FOYER_AVEC_DEUX_PARENTS` · PUT `/api/foyers/<FOYER_REFERENCE_ID>/parents/<PARENT_REFERENCE_ID>` body `{ email: <EMAIL_PARENT_LEST> }` → 409 `{ statusCode:409, code:'EMAIL_DEJA_UTILISE', message:'adresse e-mail déjà utilisée dans ce foyer' }`.

- **Côté provider :**
  - `notifications.provider.pact.spec.ts` : **1 nouveau stateHandler** `ETAT_INBOX` (params `{parentId,id}`) = `delete from notification where id=$id` puis `insert into notification (id,parent_id,type,sujet,corps,lien,cree_le,lu_le) values ($id,$parentId,'VALIDATION_HEBDO',…,null)`. La notif reste possédée par `PARENT_INBOX_ID` ; l'interaction 404 la requête avec `AUTRE_PARENT_ID`. _(La colonne `cle_idempotence` ajoutée par L3 est nullable : l'insert qui l'omet reste valide, quel que soit l'ordre L3/L4.)_
  - `foyer.provider.pact.spec.ts` : **2 nouveaux stateHandlers** (`ETAT_DESABO_OK`, `ETAT_DESABO_DERNIER`) qui seedent parent + ligne `desabonnement_token` (`utilise_le=null`, `expire_le` 2100-01-01) ; `ETAT_DESABO_DERNIER` seede en plus une préférence `IN_APP actif=false` (couper EMAIL laisse zéro actif → 409, jeton non consommé). **Épingler** `DESABONNEMENT_TOKEN_SECRET: 'pact-desabo-secret'` dans l'env de spawn du provider (bloc env existant). D et E réutilisent des stateHandlers **existants** (aucun nouveau).

- **Régénérer** les deux fichiers pact committés en lançant les specs consumer.

#### Périmètre

- **Dans :** +3 interactions inbox (consumer) ; +5 interactions svc-foyer (consumer, avec le signer inline) ; +1 stateHandler inbox (provider) ; +2 stateHandlers désabo + épinglage du secret (provider foyer) ; régénération des 2 JSON pact.
- **Hors :** tout changement de **code produit** (clients/contrôleurs/services) — lot **tests-only** ; `can-i-deploy.mjs` ; édition à la main des JSON `/pacts` ; nouveaux states pour D/E (réutilisés) ; migrations ; contracter l'émetteur interne `POST /api/desabonnement/jetons` (machine-à-machine, pas une surface BFF).

**Fichiers :** `apps/api-gateway/src/contract/notifications.consumer.pact.spec.ts`, `.../contract/foyer.consumer.pact.spec.ts`, `apps/svc-notifications/src/contract/notifications.provider.pact.spec.ts`, `apps/svc-foyer/src/contract/foyer.provider.pact.spec.ts`, `pacts/api-gateway-svc-notifications.json`, `pacts/api-gateway-svc-foyer.json` (régénérés).

**Libellés exacts à matcher (ne pas paraphraser) :** `'notification inconnue'` ; `'lien de désabonnement invalide ou expiré'` ; `'ce canal ne peut pas être coupé : au moins un canal doit rester actif'` ; `'au moins un canal doit rester actif pour VALIDATION_HEBDO'` ; code `'EMAIL_DEJA_UTILISE'` / message `'adresse e-mail déjà utilisée dans ce foyer'`.

#### Critères d'acceptation

**Parent :** un parent ne peut jamais lire/marquer la notif d'un autre (le 404 cross-parent est verrouillé par contrat) ; le désabo one-click se comporte correctement (204 canal non critique / 409 dernier canal / 400 lien invalide) ; on ne peut pas couper tous les canaux du rappel, ni renommer un parent sur un e-mail déjà actif du foyer.
**Technique (régressions attrapées) :** si `inbox.service.ts` perd le prédicat `parentId` → interaction 3 renvoie 200 → **provider verify svc-notifications ÉCHOUE** ; si le garde `typeServiceInjoignable` du désabo saute (409→204) → B échoue, si le 400 court-circuit change → C échoue ; si le 400 préférences ne part plus → D échoue ; si `traduireUnicite` ne mappe plus la collision d'édition en 409 → E échoue. `can-i-deploy.mjs` imprime toujours COMPATIBLE. `pnpm nx run-many -t typecheck test -p api-gateway` vert, pacts régénérés, lint OK.

#### Comment vérifier

- Régénérer depuis un **arbre git propre** : `pnpm nx test api-gateway` (PactV3 **réécrit** chaque fichier par run → pas de doublons ; partir propre pour voir la dérive dans le diff).
- `pnpm nx run-many -t typecheck test -p api-gateway` ; `pnpm nx lint api-gateway`.
- Builder les bundles provider : `pnpm nx build svc-foyer` **et** `pnpm nx build svc-notifications` (les provider specs spawnent `dist/main.js`).
- Provider verify (comme la CI, DB Postgres up) : `pnpm nx run-many -t typecheck test -p svc-foyer` **et** `… -p svc-notifications` — le Verifier rejoue les nouvelles interactions, toutes doivent passer.
- `node .github/workflows/scripts/can-i-deploy.mjs` → COMPATIBLE. `git diff -- pacts/` : **seules** les interactions voulues ajoutées, aucun reformatage.

#### Pièges connus

- **Dérive pact / doublons :** régénérer depuis un état git propre (`git checkout pacts/` si doute). PactV3 réécrit le fichier entier par run.
- **`/pacts` dans `.prettierignore`** : ne **pas** reformater les JSON générés ; lint-staged ne doit pas y toucher.
- **Déterminisme du jeton :** `SECRET_DESABO` (consumer) doit être **byte-identique** au `DESABONNEMENT_TOKEN_SECRET` épinglé dans l'env de spawn provider, sinon la signature échoue. Le token `exp` **et** le `expire_le` seedé doivent être dans le futur au moment du verify.
- **409-sans-consommation :** le seed `ETAT_DESABO_DERNIER` doit stocker `IN_APP actif=false` et le jeton **non utilisé** (`utilise_le=null`, re-seed par interaction).
- Le 404 cross-parent suit la forme Nest `NotFoundException` : matcher `statusCode/message/error:'Not Found'`, message exact `'notification inconnue'`.
- **Builder les bundles AVANT le verify** sinon on rejoue un bundle périmé (faux-vert). Le signer inline utilise `import { createHmac } from 'node:crypto'` (import de **valeur**). Les params de stateHandler sont `unknown` puis castés, comme les handlers existants.
- Frontières ESLint : le consumer **ne doit pas** importer de svc-foyer/svc-notifications → reproduire le signer HMAC (~4 lignes) inline.

---

### LOT L5 — 🟢 Résilience `GET /moi/profil` + garde-fou de boot du secret désabo

**Modèle : Opus 4.8.** Backend `api-gateway` + `svc-foyer`. Indépendant.

#### Objectif

- **Parent (avant → après) :** aujourd'hui, au moindre hoquet svc-foyer, « Mon profil » tombe en **erreur générique** (voire abort client après ~10 s). Après : si **seule** la lecture des préférences échoue, la page s'affiche quand même (identité + prénom/nom) avec préférences vides.
- **Système :** dégradation gracieuse en miroir de `GET /moi` ; et un secret HMAC de désabonnement qui **ne peut plus** rester au fallback dev en production.

#### Diagnostic

**Part A :** `moi.controller.ts` `profil` (~L110-129) enchaîne **3 lectures svc-foyer séquentielles** via `relayer` (`foyersParEmail` → `parents` → `preferences`), chacune `timeoutMs 2000 / retries 1` (`foyer.client.ts` ~L148-152) ≈ jusqu'à **~12,6 s** vs abort client **10 s** (`apps/web/src/api/client.ts` ~L134). Aucune dégradation, contrairement à `GET /moi` (~L91-100) qui tolère une panne svc-foyer. **Point clé :** `preferences(foyerId, parentId)` dépend de `parent.id` (issu de `parents()`) → **impossible** de paralléliser par `Promise.all`. La seule marge est la **dégradation** de la lecture préférences.
**Part B :** `svc-foyer/config.ts` (~L29-34) : `desabonnement.secret = env['DESABONNEMENT_TOKEN_SECRET'] ?? 'dev-desabonnement-secret-non-prod'`. Exigence **compose-only** (forme `:?` du compose). Un boot hors-compose signe les jetons avec une **constante publique**. `svc-foyer/main.ts` n'appelle **aucun** garde-fou de config avant `NestFactory.create` (contrairement à `api-gateway/main.ts` qui appelle `verifierConfigProduction()`).

#### Décisions déjà prises

- **Part A — Dégradation gracieuse UNIQUEMENT** (pas de `Promise.all`, infaisable). Garder `resoudreParentCourant` (`foyersParEmail` + `parents`) **obligatoire** via `relayer` (401 sans identité, 404 sans ligne, 502 si injoignable — **inchangé**). Remplacer l'appel dur `preferences` (~L117-119) par un **try/catch** qui, en cas d'échec, journalise un `logger.warn` (comme ~L94-99) et retombe sur `preferences: readonly PreferenceVue[] = []`. Appeler `this.foyers.preferences(...)` **directement** dans le `try` (comme `/moi` appelle `foyersParEmail` sans `relayer`) pour rester cohérent avec le modèle de tolérance. Effet : pire cas des lectures **obligatoires** ~8,4 s (< budget client 10 s), et une panne préférences rend « Mon profil » avec préférences vides. **Rejeté :** réduire timeout/retries sur la route (touche `foyer.client.ts` partagé — effet de bord large).
- **Part B — Garde-fou de boot.** Ajouter `verifierConfigProduction(env = process.env)` dans `svc-foyer/config.ts`, **calqué 1:1** sur `api-gateway/config.ts` (~L118-148) : early-return si `env['NODE_ENV'] !== 'production'` ; sinon `const secret = env['DESABONNEMENT_TOKEN_SECRET']?.trim()` ; `throw` si `secret === undefined || secret === '' || secret === SECRET_DESABONNEMENT_DEV`. **Extraire** `export const SECRET_DESABONNEMENT_DEV = 'dev-desabonnement-secret-non-prod'` (source unique, réutilisée par `loadConfig` **et** le garde-fou). Câbler l'appel en **1ʳᵉ instruction** de `bootstrap()` dans `svc-foyer/main.ts` (avant `NestFactory.create`), comme `api-gateway/main.ts`. **Pas d'échappatoire** type `GATEWAY_AUTH_DISABLED` (le secret est toujours requis en prod).

#### Périmètre

- **Dans :** Part A (tolérance de la lecture préférences dans `profil`, obligatoire ailleurs) ; Part B (`SECRET_DESABONNEMENT_DEV` + `verifierConfigProduction` + appel dans `main.ts`) ; tests unitaires.
- **Hors :** parallélisation `parents`+`preferences` (infaisable) ; `OPTIONS` timeout/retries de `foyer.client.ts` (partagé) ; budget client `DELAI_EXPIRATION_MS` ; sélecteur multi-foyers (H7) ; échappatoire secret ; migration ; pacts.

**Fichiers :** `apps/api-gateway/src/bff/moi.controller.ts`, `.../bff/moi.controller.spec.ts`, `apps/svc-foyer/src/config.ts`, `apps/svc-foyer/src/main.ts`, `apps/svc-foyer/src/config.spec.ts` (nouveau).

**Réutiliser :** `MoiController.lire` (~L80-103) = patron de tolérance à copier ; `api-gateway/config.ts` (~L118-148) + `config.spec.ts` (~L1-69) + `main.ts` (~L10-13) = patrons du garde-fou.

#### Critères d'acceptation

**Parent :** svc-foyer OK → « Mon profil » identique (aucune régression) ; **seule** la lecture préférences échoue → page affichée (identité/prénom/nom/foyer) avec liste de préférences vide ; identité sans ligne parent → 404 attendu inchangé.
**Technique :** `GET /v1/moi/profil` → si `preferences()` rejette, réponse **200** avec `preferences: []` + `logger.warn` ; 401 sans identité, 404 sans ligne parent, échec `foyersParEmail`/`parents` toujours propagé (502) ; latence des lectures obligatoires ~8,4 s ; svc-foyer **refuse de démarrer** (throw, exit non-zéro) si `NODE_ENV=production` et secret absent/vide/`=SECRET_DESABONNEMENT_DEV` ; démarre normalement en prod avec un vrai secret et en dev/test sans exiger le secret ; `SECRET_DESABONNEMENT_DEV` = constante unique.

#### Comment vérifier

- `pnpm nx run-many -t typecheck test -p api-gateway` (couvre `moi.controller.spec.ts`) ; `pnpm nx run-many -t typecheck test -p svc-foyer` (couvre `config.spec.ts`).
- `pnpm nx lint api-gateway && pnpm nx lint svc-foyer`.
- Revue : `main.ts` svc-foyer appelle `verifierConfigProduction()` **avant** `NestFactory.create` ; `loadConfig` référence `SECRET_DESABONNEMENT_DEV`, pas le littéral.
- **Tests à ajouter :** `moi.controller.spec.ts` — « profil : préférences en échec → profil rendu avec préférences vides » (fake `preferences: vi.fn().mockRejectedValue(...)`, attendre `vue.preferences === []` + champs conservés) ; garder le test existant préférences-OK. `config.spec.ts` (nouveau, calqué api-gateway) : prod sans/`''`/`'   '`/`=DEV` → throw ; prod avec vrai secret → ok ; `{}`/development/test → ok. **Passer l'env en paramètre**, ne jamais muter `process.env`.

#### Pièges connus

- **Ne pas** tenter de paralléliser `parents`+`preferences` (dépendance de données réelle).
- **Miroir exact :** appeler `preferences()` **directement** dans le `try` (pas via `relayer`), pour cohérence avec `/moi`. `relayer` reste sur les lectures obligatoires. Bien `await` (no-floating-promises).
- **Ne pas** élargir la tolérance à `foyersParEmail`/`parents` dans `profil` (la ligne parent reste obligatoire — sinon on masque un vrai 404).
- Part B : comparer sur secret **trimé** (`?.trim()`) ; **early-return hors production** (sinon casse dev/test) ; appel **avant** `NestFactory.create` ; source unique de la constante ; `config.spec.ts` passe l'env en paramètre.
- `exactOptionalPropertyTypes`/`verbatimModuleSyntax` : `PreferenceVue` déjà en `import type` ; typer le repli `readonly PreferenceVue[]`.

---

### LOT L6 — 🔵 Cloche/inbox « pro » (panneau Modale, états, horodatage à l'heure, « N sur M », « tout marquer lu »)

**Modèle : Opus 4.8** (jugement UX). Front web. Précède L7 (partage `styles.css`) et **précède L8**.

#### Objectif

- **Parent (avant → après) :** aujourd'hui, la cloche ouvre un menu déroulant serré à 375px, **impossible à fermer** au clavier/hors-clic, **sans état** chargement/erreur/vide, avec la **date seule**. Après : un **tiroir plein-largeur ancré en bas** (bottom-sheet) sur mobile / dialog centré sur desktop, fermable par Échap, clic-extérieur ou bouton ; chargement/erreur/vide traités ; **date + heure** ; indice « N sur M » ; bouton « Tout marquer comme lu ».
- **Système :** panneau porté par le composant `Modale` (a11y dialog complète héritée) ; 12 styles inline → vraies classes.

#### Décisions déjà prises

- **Porter le panneau par `apps/web/src/ui/Modale.tsx`** (décision PO). On hérite gratuitement de `role="dialog"` + `aria-modal` + `aria-labelledby`, focus initial + **focus-restore** sur la cloche, focus-trap Tab/Shift+Tab, fermeture **Échap** et **clic-overlay**. Le CSS existant `.modal*`/`.modal-overlay` fait **déjà** bottom-sheet mobile (`align-items:flex-end` + `border-radius 14px 14px 0 0`) et dialog centré ≥768px (`max-width:32rem`) — **ne rien redéfinir**. Résout d'un coup 375px, Échap, clic-extérieur, focus.
- Le **bouton cloche reste le déclencheur** (avec `.pastille`). Au clic il monte `<Modale titre="Notifications" onClose={() => setOuvert(false)}>`. Corps : (a) barre optionnelle « N sur M » + « Tout marquer comme lu » ; (b) contenu selon l'état `useAsync`.
- **États** (via `const { data, loading, error, reload } = useInbox()`) : `loading && data===null` → `<Spinner label="Chargement des notifications…" />` ; `error && data===null` → `<EtatVide>` avec action `{ libelle:'Réessayer', onClick: reload }` ; liste vide → `<EtatVide>` ; sinon la `<ul>` des items.
- **Horodatage à l'heure (H3, UTC) :** ajouter un helper **pur** `formaterDateHeureFr(iso)` dans `apps/web/src/utils/dates.ts` rendant « 23/06/2026 à 06:01 » en dérivant date **et** heure d'un même `new Date(iso)` en **UTC** (`getUTCHours`/`getUTCMinutes`), déterministe en test (aucun TZ épinglé côté vitest web). Réutiliser `formaterDateFr` en interne.
- **« Tout marquer comme lu » (H4) = boucle client**, pas de nouvel endpoint : `const nonLusVisibles = notifications.filter(n => n.luLe === null)` puis `await Promise.allSettled(nonLusVisibles.map(n => api.marquerNotificationLue(n.id)))` puis `reload()`. Best-effort (les échecs ne cassent pas l'entête), bouton désactivé pendant l'exécution, affiché seulement si ≥1 non-lu visible. **Limite assumée :** ne marque que les ≤50 affichés (la pastille conserve le reliquat).
- **Indice « N sur M » :** quand `nonLus > notifications.length`, une ligne `.muted` discrète.
- **Simplification :** supprimer le state `version`/`setVersion` au profit de `reload()` (resync après accusé et après tout-marquer-lu) ; simplifier `useInbox()` (deps `[]`).
- **12 styles inline → classes `.cloche-*`** ajoutées à `styles.css` avec les tokens.
- **Préserver le dessein :** journal en **lecture seule** (JAMAIS d'action « Valider »), compteur discret masqué à 0, accusés best-effort, cartes tapables (`Link`) qui ferment le panneau à la navigation et valent accusé de lecture.

#### Libellés exacts

- Titre dialog : « Notifications ». Chargement : « Chargement des notifications… ». Erreur (EtatVide) titre : « Notifications indisponibles » / description : « Impossible de charger vos notifications pour le moment. » / action : « Réessayer ». Vide : « Aucune notification » / « Vous êtes à jour : rien de nouveau pour le moment. ». Bouton : « Tout marquer comme lu » (pendant : « Enregistrement… »). Indice N/M : « {nonLus} non lues au total — les {notifications.length} plus récentes sont affichées ci-dessous. ». Item non-routable (**inchangé**, requis par les tests) : « Marquer comme lu » / « Enregistrement… ». Horodatage : « 23/06/2026 à 06:01 ».

#### Périmètre

- **Dans :** réécrire le rendu de `ClocheNotifications.tsx` (panneau porté par `Modale`) ; consommer `loading/error/reload` (4 états) ; `formaterDateHeureFr` dans `dates.ts` ; « Tout marquer comme lu » ; indice « N sur M » ; déclencheur `aria-haspopup="dialog"` (au lieu de `"true"`), garder `aria-expanded`/aria-label dynamique, **retirer `aria-controls`** (le dialog n'est monté que si ouvert) ; 12 inline → classes `.cloche-*` ; supprimer `version` ; tests des nouvelles branches.
- **Hors :** endpoint bulk mark-all-read ; migration / contrat OpenAPI ; action « Valider » ; pagination au-delà de 50 ; marquer lus les non-lus **hors** page ; point de montage dans `App.tsx` / comportement de la pastille ; horodatage en heure locale.

**Fichiers :** `apps/web/src/notifications/ClocheNotifications.tsx`, `.../notifications/ClocheNotifications.test.tsx`, `.../notifications/useInbox.ts`, `.../utils/dates.ts`, `.../utils/dates.test.ts`, `apps/web/src/styles.css`.

**Réutiliser :** `Modale`, `Spinner`, `EtatVide`, `useAsync` (loading/error/reload déjà exposés par `useInbox`), `formaterDateFr`, `react-router-dom` `Link`. Nouvelles classes : `.cloche-barre` (entête N/M + tout-marquer), `.cloche-liste`, `.cloche-item`, `.cloche-item--lu` (opacité), `.cloche-item-entete`, `.cloche-item-sujet`, `.cloche-item-date`, `.cloche-item-corps` ; garder `.cloche-carte-lien`.

#### Critères d'acceptation

**Parent :** à 375px, tap sur la cloche → tiroir plein-largeur ancré en bas, manipulable au pouce ; fermeture par « Fermer », Échap, ou clic hors tiroir ; ≥768px → petite fenêtre centrée ; chaque notif affiche **date ET heure** ; « Tout marquer comme lu » vide les non-lus affichés (compteur à jour) ; chargement/erreur+Réessayer/vide rassurant traités ; le panneau reste un **journal** (aucune action « Valider », cartes-lien mènent à l'éditeur) ; compteur invisible à 0.
**Technique :** sémantique dialog complète héritée de `Modale` (focus déplacé/restauré, Tab piégé) ; **aucun décalage de layout**, pas de scroll horizontal du body à 375px ; **axe 0 violation** sur le dialog ouvert dans les 4 états ; déclencheur `aria-haspopup="dialog"` + `aria-expanded` reflétant l'état ; **sur erreur, l'entête reste silencieuse** (cloche sans compteur — l'erreur n'apparaît que dans le dialog ouvert) ; « Tout marquer comme lu » = POST idempotents existants uniquement, best-effort ; **0 style inline résiduel** ; web vert + couverture au-dessus du ratchet.

#### Comment vérifier

- `pnpm nx run-many -t typecheck test -p web` ; `pnpm nx lint web`.
- **Vérif visuelle 375px** (stack docker + Vite dev :4200 — cf. procédure « verif-ui-locale-stack ») : ouvrir la cloche → tiroir bas plein-largeur, pas de scroll horizontal ; redimensionner ≥768px → dialog centré.
- Clavier : ouvrir, **Échap** → fermeture + focus revenu sur le bouton cloche ; Tab piégé.
- axe sur le dialog ouvert dans chacun des 4 états → 0 violation.
- État erreur (couper la gateway / mock 500) → message + « Réessayer » → recharge. « Tout marquer comme lu » avec ≥2 non-lus → compteur retombe.

#### Pièges connus

- **Aucun des 8 tests existants** ne doit être modifié (analyse confirmée) : le bouton garde aria-label dynamique + `aria-expanded` ; le libellé item « Marquer comme lu » est conservé ; la carte `<Link>` + fermeture à la navigation conservées ; le heading « Notifications » attendu ; « Tout marquer comme lu » ne matche pas `/valider/i`. Renommer le titre du dialog, le libellé « Marquer comme lu », ou casser `aria-expanded` casserait respectivement les tests 7, 4/8, 3.
- **Coverage ratchet dur** : les 4 états + tout-marquer + indice N/M ajoutent des branches → **écrire les tests listés** (chargement ; erreur+retry ; vide ; tout-marquer-lu ; horodatage `/à \d{2}:\d{2}/` ou chaîne UTC exacte ; indice N/M ; fermeture Échap ; `dates.test.ts` pour `formaterDateHeureFr` avec cas minuit UTC + padStart).
- **Tests 3 et 4 rendent SANS `MemoryRouter`** : ne mettre **aucun** `<Link>` dans les branches loading/erreur/vide (EtatVide « Réessayer » = `onClick`, pas `href`).
- `useAsync` ne remonte `error` que si `data===null` : garder l'entête (bouton/pastille) **insensible** à `error` (préserve le test 6 « panne : cloche sans compteur ») — n'afficher l'erreur **que** dans le dialog.
- **Fuseau :** ne pas bâtir l'horodatage avec l'heure **locale** (test flaky) — `getUTCHours/getUTCMinutes`.
- React Compiler : pas de `useMemo/useCallback/memo`. `no-floating-promises` : `void` sur les handlers async. `verbatimModuleSyntax` : `Modale/Spinner/EtatVide` en valeurs, `NotificationInApp/InboxVue` en `import type`. Ne pas garder `version` **et** `reload()` en parallèle. Ne pas dupliquer une gestion Échap (Modale le fait). Front pur : aucun `/pacts`/migration.

---

### LOT L7 — 🔵 Mon profil : langage parent + feedback de sauvegarde unifié + polish désabo

**Modèle : Opus 4.8** (langage/reframe). **Extraction CSS délégable à Sonnet 5.** Front web. Après/avec L6 (partage `styles.css`) et **précède L8**.

#### Objectif

- **Parent (avant → après) :** aujourd'hui, la section notifications est un « tableau type×canal » à une ligne, en **jargon** (« canal », « notification de service ») ; le feedback de sauvegarde est ad-hoc et incohérent. Après : une **question en langage parent** (« Le rappel du mardi — Comment souhaitez-vous être prévenu·e ? » avec « Par e-mail » / « Dans l'application »), un feedback **unifié** (« Enregistré à HH:MM ») au même endroit que le reste de l'app, et une ligne discrète si l'e-mail a été désactivé par lien.
- **Système :** feedback porté par le composant partagé `StatutSauvegarde` + annonces `useAnnonce` ; 20 styles inline → classes ; **aucun** changement d'appel API ni de l'invariant ≥1 canal.

#### Décisions déjà prises

1. **`BlocNotifications` devient une question parent** (plus de « tableau », plus de « canal »/« notification de service ») : `h2` « Le rappel du mardi », question « Comment souhaitez-vous être prévenu·e ? », 2 cases « Par e-mail » / « Dans l'application ». **Garder** le catalogue `TYPES` à un seul élément (`RECAP_SERVICE` reste **caché** — invariant métier, il part toujours vers l'établissement). Le verrou ≥1 canal (garde-fou UI + `disabled` + span d'aide) est conservé, **reformulé**.
2. **Feedback unifié :** remplacer les `<p className="credit">` + `<div role="status">` ad-hoc des **deux** blocs par **`StatutSauvegarde`** (`idle`/`en-cours`/`enregistre`/`erreur` + `enregistreA` « HH:MM » persistant) — même montage que `ParentsSection.tsx` (helper `heureCourante()`, `etatAffiche = occupe ? 'en-cours' : etat`). Ajouter **`useAnnonce`** dans `BlocNotifications` (`annoncer('E-mail activé'/…)` après resync + région `<p {...regionLiveProps} className="sr-only" />`). Les erreurs **spécifiques** (409 e-mail, 400 dernier-canal) restent des `<p className="debit" role="alert">` focalisés.
3. **RGPD minimal (H5) :** quand la préférence EMAIL a `desabonneAt != null`, une ligne `.muted` sous « Par e-mail » : « E-mail désactivé le JJ/MM/AAAA. » (`new Date(desabonneAt).toLocaleDateString('fr-FR')`). **`consentementAt` non affiché.**
4. **Extraction CSS (délégable Sonnet) :** ~20 inline → classes. Réutiliser les **génériques existantes** `.page-etroite`, `.champs-duo`, `.case-cochable`, `.sr-only` ; pour le reste (reset fieldset, aide, largeur input, marges de titres), **créer** un petit lot `.profil-*` calqué sur `.etab-fieldset`/`.etab-aide`/`.etab-form input` — **ne pas réutiliser les classes `etab-*`** (nommage « établissements » trompeur).
5. **Vouvoiement (H1)** partout (l'exemple « veux-tu » de l'audit était illustratif — **pas** de tutoiement).
6. **Polish désabo :** corriger le langage de `DesabonnementPage.tsx` (états 'dernier-canal', 'succes', intro 'saisie').

#### Libellés exacts

- `h2` : « Le rappel du mardi ». Question : « Comment souhaitez-vous être prévenu·e ? ». Aide : « Chaque mardi, un rappel vous invite à valider les besoins de la semaine suivante. ». Cases : « Par e-mail » / « Dans l'application ». Verrou dernier moyen : « Gardez au moins un moyen d'être prévenu·e : celui-ci reste actif. ». Erreur 400 : « Impossible de tout couper : gardez au moins un moyen d'être prévenu·e (e-mail ou application). ». Ligne RGPD : « E-mail désactivé le {date}. ». Annonces a11y : « E-mail activé » / « E-mail désactivé » / « Rappel dans l'application activé » / « Rappel dans l'application désactivé ».
- Désabo 'dernier-canal' : « Ce rappel doit vous parvenir au moins d'une façon. Activez l'application avant de couper l'e-mail, depuis vos préférences. ». Désabo succès (2ᵉ phrase) : « Vous pouvez réactiver l'e-mail à tout moment depuis vos préférences. ». Désabo intro 'saisie' : « Vous êtes sur le point de ne plus recevoir par e-mail les rappels du mardi (validation des besoins de la semaine). ».
- **Inchangés :** `h1` « Mon profil », `h2` « Mes informations », bouton « Enregistrer »/« Enregistrement… », erreur 409 « Adresse e-mail déjà utilisée. », désabo succès 1ʳᵉ phrase « C'est fait : vous ne recevrez plus ces rappels par e-mail. ».

#### Périmètre

- **Dans :** reframe `BlocNotifications` (vouvoiement) ; `StatutSauvegarde` pour les **deux** blocs (suppression des `<p credit>`+`<div role=status>` ad-hoc) ; `useAnnonce` dans `BlocNotifications` ; ligne RGPD `desabonneAt` ; extraction des ~20 inline (`.page-etroite`/`.champs-duo`/`.case-cochable` + `.profil-*`) ; langage `DesabonnementPage` ; mise à jour des 7 tests impactés + tests RGPD/annonce.
- **Hors :** exposer `RECAP_SERVICE` (doit rester caché) ; modifier les appels API (`majPreferences`/`modifierParent`/`desabonner` et leurs corps) ; backend/contrats/migrations/pacts ; logique optimiste/rollback/resync ou garde-fou double-clic ; renommer/retirer le bouton « Enregistrer » explicite ; tutoiement ; afficher `consentementAt`.

**Fichiers :** `apps/web/src/profil/MonProfilPage.tsx`, `.../profil/MonProfilPage.test.tsx`, `.../desabonnement/DesabonnementPage.tsx`, `.../desabonnement/DesabonnementPage.test.tsx`, `apps/web/src/styles.css`.

**Réutiliser :** `StatutSauvegarde` (+ type `EtatSauvegarde`) ; `useAnnonce` ; patron `ParentsSection.tsx` (`heureCourante()` + `etatAffiche = occupe ? 'en-cours' : etat`) ; classes `.page-etroite`/`.champs-duo`/`.case-cochable`/`.sr-only` ; patron CSS `.etab-fieldset`/`.etab-aide` à **cloner** en `.profil-*`.

#### Critères d'acceptation

**Parent :** comprend en une lecture (c'est le rappel du mardi, e-mail et/ou application ; **aucun** mot technique) ; en cochant/décochant, un retour visible et stable « Enregistré à 21:43 » **au même endroit** que sur les autres écrans ; tenter de tout décocher → message clair « gardez au moins un moyen » sans jargon ; s'il s'était désabonné par e-mail, une ligne datée le rappelle et il peut re-cocher ; la page désabo ne dit plus « canal ».
**Technique :** **aucun** changement d'appel API (mêmes payloads asserted) ; `RECAP_SERVICE` reste absent, `construireEtat`/`nbCanauxActifs` inchangés ; invariant ≥1 canal toujours appliqué UI (garde-fou + `disabled` + 400 rollback) ; a11y préservée (spread conditionnel `aria-describedby` maintenu, `role=alert` focalisé sur erreurs, **une seule** région `role=status` par bloc + région `sr-only` `useAnnonce`) ; **0 style inline** dans les deux fichiers ; web vert + couverture au-dessus du ratchet.

#### Comment vérifier

- `pnpm nx run-many -t typecheck test -p web` ; `pnpm nx lint web`.
- **Vérif 375px :** « Le rappel du mardi » ne déborde pas, 2 cases avec cible ≥44px (`.case-cochable`), paire prénom/nom empilée <480px (`.champs-duo`).
- Lecteur d'écran : au coche/décoche, la région `sr-only` annonce « E-mail activé/désactivé » et le badge passe « Enregistrement… » → « Enregistré à HH:MM ».
- axe sur `/mon-profil` et `/desabonnement?token=…` : 0 violation ; input e-mail en erreur toujours lié par `aria-describedby`.
- **Tests (mise à jour des 7 + ajouts) :** t1 case 'E-mail'→'Par e-mail' ; t2/t3 `findByText('… enregistré.')` → badge `/Enregistré à/i` (payloads **inchangés**) ; t4 `/Dernier canal actif/i`→`/gardez au moins un moyen/i` (case toujours `disabled`) ; t5 message 400 → `/gardez au moins un moyen/i` (rollback conservé) ; t6/t7 inchangés. **Ajouter :** ligne RGPD (`desabonneAt` renseigné → `/E-mail désactivé le/`) ; annonce a11y (région `sr-only` contient `/désactivé/`). `DesabonnementPage.test.tsx` t4 : `/ne peut pas être coupé/i`→`/au moins d'une façon/i` ; t1 succès matche encore `/vous ne recevrez plus ces rappels/i`.

#### Pièges connus

- **Ne pas** exposer `RECAP_SERVICE` (régression métier : canal sortant vers l'établissement).
- `exactOptionalPropertyTypes` : conserver le spread conditionnel `{...(cond ? { 'aria-describedby': id } : {})}` (jamais `aria-describedby={undefined}`).
- **Éviter deux live regions concurrentes** : en ajoutant `StatutSauvegarde` (role=status) + `useAnnonce` (role=status sr-only), **supprimer** les anciens `<div role=status>`+`<p credit>` ; garder `role=alert` **uniquement** pour les erreurs spécifiques.
- **Coverage ratchet** : ligne RGPD + annonce ajoutent des branches → tests obligatoires.
- `verbatimModuleSyntax` : `import type { EtatSauvegarde }` ; `no-floating-promises` : garder `void basculer(...)` / `void enregistrer()`. React Compiler : pas de `useMemo/useCallback/memo`. `noUncheckedIndexedAccess` : garder `etat[k] ?? false` et le null-guard avant `new Date(desabonneAt)`.
- **Ne pas** réutiliser les classes `etab-*` (créer des `.profil-*`). `heureCourante()` : reprendre exactement le patron `ParentsSection.tsx` (`toLocaleTimeString('fr-FR', 2-digit)`).
- Le message de succès de la bascule était « Préférences enregistrées. » → devient le badge : tout test cherchant cette chaîne casse (mis à jour ci-dessus).
- **Coordination L6 :** L6 et L7 ajoutent tous deux des classes à `styles.css` (préfixes disjoints `.cloche-*` / `.profil-*`) — faible risque de conflit ; si L6 est déjà mergé, rebaser proprement.

---

### LOT L8 — 🧪 Filet e2e + a11y (couvrir /mon-profil, /desabonnement, l'ouverture de la cloche)

**Modèle : Opus 4.8** (design e2e ; l'écriture des 3 tests est mécanique, **délégable à Sonnet 5** une fois le comportement post-L6/L7 figé). Tests-only, `apps/web/e2e`. **À faire EN DERNIER, après L6 et L7.**

#### Objectif

- **Parent (avant → après) :** aujourd'hui, `/mon-profil`, `/desabonnement` et le panneau cloche **ouvert** ne sont **jamais** audités par axe, et aucun e2e ne garde l'ouverture de la cloche. Après : ces trois surfaces sont auditées a11y et une régression d'ouverture de la cloche est attrapée.
- **Système :** filet e2e mocké (rapide, déterministe), sans toucher au code produit ni à l'orchestrateur stack destructif.

#### ⚠️ Dépendance de comportement (post-L6/L7)

Ce lot **asserte le comportement final** produit par L6 et L7. **Ne pas** copier l'état antérieur :

- **Cloche (post-L6)** : le panneau est désormais un **`role="dialog"`** (via `Modale`) fermable par **Échap** — asserter la sémantique **dialog** (`getByRole('dialog')`, `aria-expanded='true'` sur le déclencheur, fermeture Échap, axe vert sur le dialog ouvert). _(Avant L6, c'était une `<section aria-label="Mes notifications">` sans Échap ; cet état n'existe plus après L6 — ne pas l'asserter.)_
- **Profil (post-L7)** : le `h2` de la section préférences est « **Le rappel du mardi** » (plus « Notifications ») et les cases « **Par e-mail** » / « Dans l'application ». Pour la **stabilité**, attendre le rendu sur des ancres qui survivent à L7 : `h1` « Mon profil » + la présence d'**au moins une case à cocher** (`getByRole('checkbox')`), puis auditer — ne pas matcher un libellé de section susceptible d'évoluer.

#### Décisions déjà prises

- **Tout en e2e MOCKÉ** (cible `nx e2e web`, Playwright + `@axe-core/playwright` déjà installés), **pas** en stack e2e (évite `docker down -v`), **pas** de nouveau vitest (logique profil + cloche déjà 100 % couverte). 3 ajouts dans `apps/web/e2e/a11y.e2e.spec.ts`, calqués sur le helper `auditer(page, libelle)` + `expect(r.violations).toEqual([])` :
  1. **`/desabonnement` sans token** → `DesabonnementPage` passe direct à `etat='invalide'` (rend un `role="alert"` + `h1`, **zéro** appel backend) : `goto('/desabonnement')` + `expect(getByRole('alert')).toBeVisible()` + `auditer`.
  2. **`/mon-profil`** : `page.route('**/api/v1/moi/profil', …)` renvoyant une `MonProfilVue` **avant** `goto`, pour auditer le **formulaire** réel ; attendre `h1` « Mon profil » + un `checkbox`, puis `auditer`.
  3. **Cloche** : `page.route('**/api/v1/moi', …)` (email non-null + `foyers=[FOYER_ID]`) **et** `page.route('**/api/v1/moi/notifications', …)` (InboxVue avec ≥1 non-lu et ≥1 avec lien) **avant** `goto('/foyers/:id/dashboard')` ; cliquer la cloche ; attendre le **dialog** visible ; asserter `aria-expanded='true'` ; `auditer` sur l'état **ouvert** ; presser **Échap** → dialog fermé.
- **Pourquoi mocké et pas stack :** le seed (`scripts/seed-demo.mjs`) ne crée aucune ligne parent inbox ; seeder la cloche en stack exigerait identité = e-mail d'un parent seedé + projection in-app du scheduler → lourd et flaky. L'interaction (marquer-lu/compteur/lien) est **déjà** verrouillée en vitest ; le mocké donne le seul manque (axe sur panneau ouvert + non-régression d'ouverture) rapidement.
- **Mocks locaux aux nouveaux tests** (`page.route` enregistré **après** le `beforeEach` `mockerBff` → priorité au dernier enregistré). **Ne pas** mettre `/moi` dans le `mockerBff` partagé (monterait la cloche sur les 6 audits existants et passerait l'accueil en mode borné → casse la redirection racine).

#### Périmètre

- **Dans :** 3 tests axe (`/desabonnement` invalide ; `/mon-profil` avec mock profil ; cloche ouverte avec mock `/moi` + `/moi/notifications`, assertion `role=dialog` + `aria-expanded` + Échap) ; réutiliser `auditer()` + `TAGS_WCAG_AA` + la constante `FOYER_ID` existante.
- **Hors :** toute modif de source produit (L8 = tests-only) ; ajouter role/Échap à la cloche (fait par L6) ; nouveau test stack ; nouveaux vitest ; auditer les états succès/409 de `/desabonnement` (nécessiteraient token + backend).

**Fichiers :** `apps/web/e2e/a11y.e2e.spec.ts`.

**Réutiliser :** helper `auditer(page, libelle, configurer?)` (~L196), `TAGS_WCAG_AA` (~L31), constante `FOYER_ID`. Fixtures de forme : copier `profil()`/`pref()` de `MonProfilPage.test.tsx` et `inbox()`/`notif()` de `ClocheNotifications.test.tsx`. **Formes à mocker :** `MonProfilVue = { parentId, foyerId, email, prenom, nom, principal, preferences:[{ typeNotification:'VALIDATION_HEBDO', canal:'EMAIL'|'IN_APP', actif, consentementAt:null, desabonneAt:null }] }` ; `InboxVue = { notifications:[{ id, type:'VALIDATION_HEBDO', sujet, corps, creeLe, luLe:null, lien? }], nonLus:>=1 }`.

#### Critères d'acceptation

**Parent :** le lien « Se désabonner » sans jeton valide affiche une page accessible (message annoncé), rien de cassé au clavier/lecteur d'écran ; « Mon profil » audité sans violation ; ouvrir la cloche reste accessible et sans régression (dialog annoncé, déclencheur `aria-expanded`).
**Technique :** axe (tags `wcag2a/2aa/21a/21aa`) → 0 violation sur `/desabonnement` (invalide) et `/mon-profil` (formulaire) ; un test **échoue** si l'ouverture de la cloche régresse (après clic : `role=dialog` visible, `aria-expanded='true'`, axe vert, Échap ferme) ; les 6 tests axe existants restent verts (mocks scopés localement) ; `pnpm nx e2e web` passe.

#### Comment vérifier

- `pnpm nx e2e web` (gate principal ; Playwright mocké, `dependsOn build`, webServer = Vite :4200). Cibler : `cd apps/web && pnpm exec playwright test a11y.e2e.spec.ts --reporter=list`.
- `pnpm nx lint web`. _(NB : le dossier `e2e/` n'est dans aucun tsconfig — `nx run-many -t typecheck test -p web` ne couvre PAS ces specs ; la vraie validation de types est l'exécution `nx e2e web`.)_

#### Pièges connus

- **Asserter le comportement POST-L6/L7** (dialog + Échap + `h1`/checkbox stables), pas l'ancien `<section>` ni le `h2` « Notifications ». (C'est la raison de l'ordre L8-en-dernier.)
- **Ordre des routes Playwright** : le dernier `page.route` gagne. `mockerBff` pose le catch-all `**/api/v1/**` ; enregistrer `/moi`, `/moi/profil`, `/moi/notifications` **dans** le nouveau test (donc après) pour qu'ils priment. Poser le mock `/moi` **avant** `page.goto` (MoiProvider tire `/moi` au montage, sinon la cloche ne se monte pas).
- **Ne pas** mettre les mocks `/moi` dans `mockerBff` partagé (casserait les 6 audits + la redirection racine).
- **Libellés parent exacts** à matcher (post-L7) : `h1` « Désabonnement » ; alerte « Ce lien de désabonnement est invalide, expiré ou a déjà été utilisé. » ; `h1` « Mon profil » ; cloche déclencheur aria-label « Notifications » / « Notifications, N non lue(s) ».
- **`e2e-stack`** fait `docker compose down -v` (destructif) : rester en `nx e2e web`. `e2e dependsOn build` (1er run CI plus lent ; local réutilise Vite :4200). CI `retries=1` compte « flaky » : garder les tests déterministes (`expect(...).toBeVisible()` sur le dialog **avant** `analyze()`), pas de timing.

---

## 8. Récapitulatif d'exécution

| Lot | Titre                                               | Couche                  | Modèle                      | Dépend de       | Migration                                      | Pact             |
| --- | --------------------------------------------------- | ----------------------- | --------------------------- | --------------- | ---------------------------------------------- | ---------------- |
| L1  | Ledger livraison par parent (anti-tempête récap)    | svc-notifications       | Opus                        | —               | `00NN_envoi_recap_parent` (additive)           | non              |
| L2  | Garde snapshot mardi                                | svc-notifications       | Opus                        | —               | non                                            | non              |
| L3  | Idempotence inbox + COUNT                           | svc-notifications       | Opus                        | **L1**          | `00NN_notification_cle_idempotence` (additive) | non              |
| L4  | Combler les 4 trous de contrats                     | api-gateway + svc-*     | Opus                        | —               | non                                            | **oui (régén.)** |
| L5  | Résilience profil + fail-boot secret désabo         | api-gateway + svc-foyer | Opus                        | —               | non                                            | non              |
| L6  | Cloche « pro » (Modale, états, heure, N/M, tout-lu) | web                     | Opus                        | —               | non                                            | non              |
| L7  | Mon profil langage + feedback + polish désabo       | web                     | Opus (CSS délégable Sonnet) | (styles.css) L6 | non                                            | non              |
| L8  | Filet e2e + a11y                                    | web (e2e)               | Opus (délégable Sonnet)     | **L6 + L7**     | non                                            | non              |

**Aucun nouveau secret/env/compose prod** (L5 ajoute une **validation** d'un secret déjà requis). **Deux migrations additives** svc-notifications (L1, L3) — numérotation auto par drizzle-kit, régénérer la 2ᵉ. **can-i-deploy inchangé** (H8). Le train de release couvrira 2 migrations additives + 8 PR ; smoke fonctionnel live par le PO en fin de déploiement.

## 9. Ce qui reste explicitement en dette (documenté, hors chantier)

- **Multi-foyer** (H7) : cloche/préférences/profil scopés au 1er foyer (familles recomposées) — fonctionnalité, pas finition.
- **L2 réservation** (H6) : sur panne planification toute la journée du mardi, un récap peut partir sans carte in-app.
- **Métriques/DLQ** : pas de métrique sur `envoi_recap_hebdo.statut='ECHEC'` ni DLQ pour événements orphelins (`max_deliver=10`) ; tables `processed_event`/`desabonnement_token` non purgées. Opérationnel.
