# Chantier « Confiance & quotidien » — plan d'exécution

> **Livrable 2** de la mission carte + plan (carte : `.claude/plans/amelioration-2026-07-pistes.md`).
> Sélection PO (2026-07-18) : **B1+B2** (confiance visible) + **C1+C2** (intégrité des écritures) + **A1** (absence en 2 taps) + **lot poli** (A3+A4+E1+D2+E2).
> Cadrage validé : outil pour le foyer du PO, balayage 360°, **rien d'interdit** (migrations/dépendances possibles si justifiées), aucune zone gelée.
> Ce plan est auto-portant : l'exécutant n'a ni la conversation, ni la mémoire de session. Tout ce qui est nécessaire est ici.

## Résumé

7 lots, ~1 PR chacun. Objectif d'ensemble : que le parent **voie** que le système tient ses promesses (statut d'envoi consultable, plus d'échecs silencieux), que les écritures **ne mentent jamais** (idempotence de création, projections monotones), que le geste le plus pressé (absence du matin) tienne en **2 taps**, et une passe de finitions (langage, simulation expliquée, bundle allégé, PWA installable proprement, focus non masqué).

Décisions structurantes déjà prises (détail dans les lots) :

- **B1** : nouvel endpoint svc-notifications + BFF `GET …/envois` exposant `envoi_recap_hebdo` + `envoi_recap_parent` + `envoi_etablissement` pour (foyer, semaine) ; affiché dans un bloc « Suivi des envois » de l'encart de validation.
- **C1** : clé d'idempotence = **UUID généré par la gateway** (pas par le web), dédup par PK `contrat.id` via `onConflictDoNothing` + relecture ; **aucune migration**. Même patron pour la création d'établissement.
- **C2** : garde de monotonie `occurred_at` sur les upserts de projection ; colonnes déjà présentes côté tarification (`foyer`, `grille_tarifaire`, `prestation_mois`), **migrations additives** pour `contrat` (tarification) et les read-models de notifications. Le handler `EnfantModifie` de planification est **exclu** (risque négligeable, voir lot 4).
- **A1** : bouton « Signaler une absence » par rangée de garde **crèche** (aujourd'hui + demain), modale de confirmation sans champ (absence journée, préavis 0, sans certificat), écriture par **read-modify-write** du mois pour ne rien effacer (le PUT mois est un remplacement complet).

### Hypothèses assumées (à corriger avant exécution si fausses)

- H1 : prod **mono-réplica** par service (aucune protection multi-réplica ajoutée).
- H2 : le navigateur ne rejoue pas les POST (vérifié : `creerContrat` web passe par `requete`, sans rejeu) → l'idempotence posée à la gateway suffit ; on n'ajoute **pas** de champ `id` au type web.
- H3 : pour A1, les contrats ABCM (cantine/péri/ALSH) gardent le seul lien « Modifier » (leur modèle de saisie — `exceptions`/`joursAlsh` — est différent ; hors périmètre v1).
- H4 : les e-mails des parents peuvent être affichés en clair dans le suivi des envois (données du foyer, routes scopées foyer).
- H5 : aucune nouvelle dépendance npm dans tout le chantier.

---

## Conventions communes à TOUS les lots (lire avant chaque lot)

- **Lieu de travail** : clone `creche-planner-public` (jamais l'original). `main` protégée → branche + PR + check `ci`. Environnement de travail : `pnpm preflight` (worktree, liens `workspace:*`, shims, ports Pact) — cf. [CONTRIBUTING.md § Pièges](../../CONTRIBUTING.md), source unique.
- **Commandes** : toujours via nx préfixé — `pnpm nx …`. La vérification front est `pnpm nx test web` (le type-check et les builds de libs sont des arêtes de la cible).
- **Lint** : ESLint 9 flat config type-aware (ratchet warn→error ; ne pas introduire de warning). `verbatimModuleSyntax` **web uniquement** → `import type` pour tout import de type dans `apps/web`. `prefer-const`, `noUncheckedIndexedAccess` actifs. Commitlint : sujet ≤ 100 caractères.
- **Pact** : les pactes vivent à plat dans `/pacts` (consumer unique `api-gateway`). Après toute modif de contrat : régénérer **à blanc** (`rm -f pacts/*.json` puis `pnpm nx test api-gateway`) — ne jamais laisser un merge de pactes créer des doublons. `/pacts` est dans `.prettierignore` : ne pas le formatter. La CI a un job `pact-drift` (régénère et exige zéro diff) et `pact-can-i-deploy` (`.github/workflows/scripts/can-i-deploy.mjs`, surrogate offline).
- **Migrations** : Drizzle forward-only, jouées au boot (`libs/nest-commons/src/lib/database/migration.service.ts`). Génération : `pnpm drizzle-kit generate` depuis le service (config `drizzle.config.ts`, sortie `src/database/migrations/NNNN_slug.sql` + `meta/_journal.json`). **Additives uniquement dans ce chantier.**
- **Vérification UI locale avec vraies données** (utilisée par les lots 1, 2, 5, 6, 7) :
  1. `docker compose up -d --build --wait web api-gateway svc-referentiel svc-foyer svc-planification svc-tarification svc-notifications`
  2. `node scripts/seed-demo.mjs --verify` (foyer de démo : ids dans `scripts/.seed-demo-state.json`, enfants Zoé/Mia, 4 contrats).
  3. Pour faire apparaître l'encart « Valider la semaine suivante » : insérer une notification à valider —
     `docker compose exec -T postgres-notifications psql -U notifications -d notifications -c "INSERT INTO notification_hebdo (id, contrat_id, foyer_id, semaine_iso, type, statut, snapshot) VALUES (gen_random_uuid(), '<contratId>', '<foyerId>', '<YYYY-Www>', 'VALIDATION_HEBDO', 'A_VALIDER', '{}') ON CONFLICT DO NOTHING;"`
  4. Observer à **375×812**. En local sans identité CF, la cloche et « Mon profil » sont absents/refusés : **normal** (environnemental).
  - Pour du hot-reload : `docker compose stop web && docker compose rm -f web` puis `pnpm nx serve web` (proxy `/api` → gateway :3000).
- **e2e stack** : `validation-semaine.stack.e2e.spec.ts` et consorts tournent en CI (`e2e-stack`) ; l'orchestrateur est **destructif** (`down -v`). Tout libellé visible modifié doit être répercuté dans les specs `apps/web/e2e/*.stack.e2e.spec.ts`.

---

## Lot 1 — B2 : fin des échecs silencieux du dashboard

**Modèle d'exécution : Opus 4.8.** Aucune dépendance.

### Objectif

Avant : quand `svc-tarification` (ou notifications/planification) est en panne, le bandeau « Coût de juillet », la section « Demain », « Prochaine garde » et la carte « Semaine à valider » **disparaissent sans trace** (vérifié en live : service arrêté → le bandeau s'évapore). Après : le chargement reste silencieux (anti-layout-shift conservé), mais **une erreur affiche une ligne discrète** avec un bouton « Recharger ».

### Périmètre exact

- `apps/web/src/dashboard/DashboardJourPage.tsx` — composants `BandeauCoutMois` (l.189-212), `SectionDemain` (l.225-280), `ProchaineGarde` (l.319-371), `CarteAValider` (l.142-180).
- Nouveau composant partagé `apps/web/src/ui/LigneIndisponible.tsx`.
- `apps/web/src/dashboard/DashboardJourPage.test.tsx` (adapter les tests d'absence, l.468-497).
- **Hors périmètre** : l'état d'erreur de la journée principale (déjà géré, l.441-486), la cloche (`catch {}` de l'accusé de lecture reste tel quel — perte bénigne), tout autre écran.

### Décisions prises

- Nouveau composant `LigneIndisponible({ texte, onRecharger }: { texte: string; onRecharger: () => void })`, calqué sur le motif de `apps/web/src/planning/BarreStatutCalendrier.tsx` (l.51-66) : `<span className="muted">{texte}</span>` + `<button type="button" className="btn secondaire" onClick={onRecharger}>Recharger</button>` dans un conteneur flex, le tout dans un wrapper `role="status"` (discret — PAS `role="alert"` : on ne veut pas interrompre le lecteur d'écran pour une carte secondaire).
- `useAsync` retourne déjà `{ data, loading, error, reload }` (`apps/web/src/hooks/useAsync.ts:46-50`, `error: string | null`) : **aucun refactor du hook**. Règle par composant : `loading` → `null` (comportement actuel conservé) ; `error !== null && data === null` → `LigneIndisponible` ; sinon comportement actuel.
- Libellés exacts :
  - `BandeauCoutMois` : texte `Coût du mois indisponible pour le moment.` — rendu **dans** la structure existante `<div className="carte bandeau-cout">` (remplace le contenu, garde la carte → hauteur stable).
  - `CarteAValider` (le plus important : une validation ratée coûte cher) : texte `Impossible de vérifier s'il reste une semaine à valider.` dans une `<section className="carte">`.
  - `SectionDemain` : texte `Impossible de charger le planning de demain.` — la section « Demain » (titre + sous-titre date) reste affichée, la ligne remplace le contenu.
  - `ProchaineGarde` : erreur du fetch secondaire → texte `Prochaine garde indisponible pour le moment.` (ligne simple, même position que « Prochaine garde : … »).
- `onRecharger` = le `reload` du `useAsync`/`useNotifications` correspondant.
- Attention aux distinctions existantes : `SectionDemain` et `ProchaineGarde` utilisent `Promise.resolve(null)` quand le fetch secondaire est inutile (`memeSemaine` / `!chercherSuivante`) — dans ces cas `error` reste `null` et rien ne change. Ne pas confondre « data === null car pas de fetch » et « error ».

### Conventions à respecter

`import type` (verbatimModuleSyntax). Réutiliser les classes existantes (`muted`, `btn secondaire`, `carte`) — zéro nouvelle règle CSS sauf si l'alignement flex l'exige (alors une classe `.ligne-indisponible` dans `styles.css`, gap `var(--esp-2)`).

### Critères d'acceptation

- Panne simulée de tarification → le dashboard affiche « Coût du mois indisponible pour le moment. · Recharger » à l'emplacement du bandeau, sans saut de layout ; un clic sur Recharger après rétablissement raffiche le montant.
- Idem pour les 3 autres composants avec leurs libellés.
- Pendant le chargement initial, rien ne s'affiche (comportement actuel préservé — vérifié par les tests « promesse pendante »).
- `pnpm nx run-many -t typecheck test lint -p web` vert.

### Comment vérifier

1. Tests : adapter `DashboardJourPage.test.tsx` — les tests actuels l.468-497 assertent l'**absence** de « Détail »/« Vérifier et valider » sur `mockRejectedValue` : les faire évoluer pour asserter la **présence** des nouveaux libellés + bouton `{ name: /Recharger/i }` ; ajouter un test « reload raffiche » (mock rejette puis résout, cliquer Recharger, attendre le montant). Patterns de mock existants : `vi.mocked(api.lireCoutMois).mockRejectedValue(new Error('…'))`, promesse pendante `mockReturnValue(new Promise(() => undefined))`, `viderCacheAsync()` en beforeEach.
2. Live : stack locale (recette commune), `docker compose stop svc-tarification`, recharger le dashboard à 375px → la ligne apparaît ; `docker compose start svc-tarification`, taper Recharger → le montant revient.

### Pièges connus

- `useAsync` a un cache module-level par clé : dans les tests, toujours `viderCacheAsync()` (déjà fait en `beforeEach`).
- Ne pas transformer ces lignes en `role="alert"` : l'a11y du dashboard distingue déjà alertes (journée principale) et statuts.

---

## Lot 2 — B1 : statut d'envoi du récap, de bout en bout

**Modèle d'exécution : Opus 4.8.** Aucune dépendance de lot (indépendant du lot 1).

### Objectif

Avant : le parent valide sa semaine, envoie le récap à la crèche… et n'a plus aucune trace consultable (le résultat d'envoi ne vit que dans l'état React de `RelectureEnvoi`, perdu au reload). La donnée existe pourtant : `envoi_etablissement`, `envoi_recap_hebdo`, `envoi_recap_parent`. Après : un bloc « Suivi des envois » dans l'encart de validation montre, pour la semaine concernée, l'état **persistant** : rappel hebdo aux parents + envois aux établissements.

### Périmètre exact

- `apps/svc-notifications/src/envoi/` : nouveau service de lecture + route dans `envoi.controller.ts`.
- `apps/api-gateway/src/clients/notifications.client.ts` (+ son spec), `apps/api-gateway/src/bff/validations.controller.ts`.
- `apps/api-gateway/src/contract/notifications.consumer.pact.spec.ts` + `apps/svc-notifications/src/contract/notifications.provider.pact.spec.ts` (+ seeds).
- Web : `apps/web/src/types/bff.ts`, `apps/web/src/api/client.ts`, nouveau composant `apps/web/src/notifications/SuiviEnvois.tsx`, intégration dans `EncartValidation.tsx`.
- **Hors périmètre** : aucun changement du scheduler ni des tables (lecture seule) ; pas d'affichage sur le dashboard (l'encart planning suffit) ; pas d'historique multi-semaines (une semaine à la fois).

### Décisions prises

**Contrat d'API** (nommage aligné sur les routes existantes) :

- svc-notifications : `GET /api/validations/semaine/:foyerId/:semaineIso/envois`, gardé par `@ScopeFoyerInterServices({ param: 'foyerId' })`, `foyerId` en `ParseUUIDPipe`, `semaineIso` en `SemaineIsoPipe` (réutiliser les pipes existants du contrôleur voisin).
- BFF : `GET /api/v1/notifications/semaine/:foyerId/:semaineIso/envois`, `@FoyerScope('param:foyerId')`, dans `validations.controller.ts` (mêmes conventions que `brouillon()`).
- Réponse (JSON, camelCase — schéma Zod côté client gateway comme les autres) :

```ts
{
  foyerId: string; semaineIso: string;
  rappel: {            // envoi_recap_hebdo — null si aucun slot (semaine jamais programmée)
    statut: 'A_ENVOYER'|'ENVOYE'|'DRY_RUN'|'ECHEC'|'ABANDONNE';
    envoyeLe: string | null;           // ISO
    erreur: string | null;
    parents: Array<{ email: string; statut: 'ENVOYE'|'DRY_RUN'|'ECHEC'; envoyeLe: string | null; essais: number }>;
  } | null;
  etablissements: Array<{              // envoi_etablissement de la semaine
    etablissementId: string;
    statut: 'EN_COURS'|'ENVOYE'|'ECHEC'|'DRY_RUN';
    envoyeLe: string | null;           // = updatedAt/envoye_le selon colonne existante
    erreur: string | null;
    destinataire: string | null;
  }>;
}
```

Implémentation : 3 selects simples (par `(foyer_id, semaine_iso)`) dans un nouveau `SuiviEnvoisService` (ou méthode dans le service d'envoi existant — au choix de l'exécutant, mais **lecture seule**, aucune écriture).
**Pact** : nouvelle interaction consommateur « une lecture du suivi des envois d'une semaine » + un état provider `ETAT_SUIVI_ENVOIS` seedant : 1 slot `envoi_recap_hebdo` ENVOYE avec 1 ligne `envoi_recap_parent` ENVOYE, et 1 ligne `envoi_etablissement` ENVOYE. Ajouter aussi le cas « aucune donnée » (rappel null, etablissements vides) — soit une 2e interaction, soit matchers laxistes ; **décision : 2 interactions** (le cas vide est le cas nominal en début de semaine). Régénération à blanc des pactes (convention commune) ; `can-i-deploy` inchangé (même paire consumer/provider).
**Web — composant `SuiviEnvois({ foyerId, semaineIso })`** :

- Fetch via nouvelle fonction `api.lireSuiviEnvois(foyerId, semaineIso, { signal })` (GET via `requeteIdempotente`), type `SuiviEnvois` ajouté à `types/bff.ts`.
- Rendu : liste compacte, une ligne par fait, `role="status"` pour le bloc. Libellés exacts :
  - rappel `A_ENVOYER` → `Rappel hebdo : envoi prévu mardi.`
  - rappel `ENVOYE` → `Rappel envoyé le {date} ({n} parent(s)).`
  - rappel `DRY_RUN` → `Rappel en mode test : aucun e-mail réellement envoyé.`
  - rappel `ECHEC` → `Échec de l'envoi du rappel — nouvelle tentative automatique prévue.`
  - rappel `ABANDONNE` → `Rappel non envoyé (fenêtre close). Pensez à vérifier votre semaine dans le planning.`
  - rappel `null` → ne rien afficher pour le rappel.
  - par établissement `ENVOYE` → `Récapitulatif envoyé à {destinataire ?? 'l'établissement'} le {date}.` ; `ECHEC` → `Échec de l'envoi du récapitulatif : {erreur ?? 'erreur inconnue'}.` ; `DRY_RUN` → `Récapitulatif en mode test (aucun e-mail envoyé).` ; `EN_COURS` → `Envoi du récapitulatif en cours…`
  - Dates via le format FR déjà utilisé (`libelleSemaineFr`/formatters existants dans `utils/`) — pas de nouveau formatteur si un équivalent existe.
- Intégration : dans `EncartValidation.tsx`, rendre `<SuiviEnvois>` (1) sous l'`EditeurSemaine` quand `semaineEditee !== null` (pour la semaine éditée) et (2) sous `RelectureEnvoi` quand `aEnvoyer !== null`, avec re-fetch après un envoi réussi (prop `version` incrémentée par le callback de succès, comme le pattern `setVersion` existant l.157). Erreur de fetch du suivi : ligne `muted` `Suivi des envois indisponible.` (pas de bouton — bloc secondaire).

### Conventions à respecter

Client gateway : même enveloppe que les voisins (`executerResilient`, `OPTIONS = { timeoutMs: 2000, retries: 1, delaiEntreEssaisMs: 200 }`, schéma Zod de parse). Provider pact : suivre la structure de `stateHandlers` existante (seeds SQL, port 3995, `requestFilter` assertion machine). BFF : réutiliser `valider()` seulement s'il y a un corps (ici non — GET pur).

### Critères d'acceptation

- Parcours complet en stack locale : valider une semaine avec modifs → envoyer le récap (dry-run local) → **recharger la page** → le bloc « Suivi des envois » montre « Récapitulatif en mode test… » (persistant, plus seulement l'état React).
- L'interaction pact nouvelle passe en consommateur ET en provider (`pnpm nx test api-gateway`, `pnpm nx test svc-notifications` avec Postgres) ; `pact-drift` ne détecte aucun résidu ; `can-i-deploy` vert.
- Un foyer B ne peut pas lire le suivi du foyer A (le scope foyer existant s'applique — vérifié par le guard, pas de test dédié requis).
- `pnpm nx run-many -t typecheck test lint -p web api-gateway svc-notifications` vert.

### Comment vérifier

1. Unit : service de lecture (3 selects, mapping statuts) avec la base factice à état si disponible côté notifications, sinon fakes simples.
2. Pact : les 2 interactions + seeds provider.
3. Live 375px : recette commune + insertion `notification_hebdo` ; valider, envoyer, reload, observer le bloc. Vérifier aussi le cas vide (semaine sans envoi → seul le rappel `A_ENVOYER`/rien).

### Pièges connus

- Le mailer local est en dry-run (pas de creds SMTP) : les statuts observés seront `DRY_RUN` — c'est le comportement attendu, ne pas « corriger ».
- `envoi_etablissement` a un unique `(foyer_id, semaine_iso, etablissement_id)` et ses propres statuts (`EN_COURS` inclus) — ne pas confondre avec les statuts du rappel.
- Ne pas oublier `SemaineIsoPipe` (le format `YYYY-Www` n'est pas un UUID).

---

## Lot 3 — C1 : idempotence de la création (contrat + établissement)

**Modèle d'exécution : Opus 4.8.** Aucune dépendance de lot.

### Objectif

Avant : `POST /api/contrats` est retenté par la gateway (`executerResilient`, `retries: 1`, timeout 2 s) avec un `id` généré **côté serveur** (`randomUUID()` dans `planification.service.ts:121`) et **aucune contrainte d'unicité** sur `contrat` → une réponse lente produit **deux contrats identiques** et deux `ContratCree`. La création d'établissement au retry retombe sur `UNIQUE(foyer_id, nom)` → **409 mensonger** (la 1ʳᵉ création a réussi). Après : le rejeu du même POST est un no-op qui renvoie la ressource déjà créée.

### Périmètre exact

- `apps/api-gateway/src/clients/planification.client.ts` (`creerContrat` l.148-169, `creerEtablissement` l.377-401) + spec.
- `apps/svc-planification/src/planification/planification.dto.ts` (schéma DTO interne), `planification.service.ts` (`creerContrat` l.108-181, `resoudreEtablissement` l.549-594), `apps/svc-planification/src/etablissement/etablissement.service.ts` (`creer` l.88-122) + specs.
- `apps/api-gateway/src/contract/` : spec pact consommateur planification (le corps du POST porte désormais `id`).
- **Hors périmètre** : aucun changement web (le navigateur ne rejoue pas les POST — H2), aucun changement de `libs/resilience` (le comportement de retry reste ; c'est l'opération qui devient idempotente), aucune migration.

### Décisions prises

- **La gateway génère l'id** : dans `creerContrat`, `const id = randomUUID();` **avant** l'appel à `executerResilient`, injecté dans le corps (`{ id, ...saisie }`). Les 2 tentatives internes partagent donc le même id. Idem `creerEtablissement`.
- svc-planification :
  - DTO : champ optionnel `id: z.string().uuid().optional()` dans le schéma de création (contrat ET établissement). S'il est absent (client legacy), `randomUUID()` comme aujourd'hui.
  - `creerContrat` : remplacer l'`insert` sec par `insert(contrat).values({...}).onConflictDoNothing({ target: contrat.id }).returning({ id: contrat.id })`. Si `returning` vide (rejeu) : **ne pas insérer d'événement outbox** (pas de second `ContratCree`), relire le contrat existant et le renvoyer (réponse identique au premier appel — 201 conservé : le code HTTP peut rester 201 sur rejeu, l'égalité du corps suffit ; **décision : 201 dans les deux cas**, plus simple pour la gateway et le pact).
  - `resoudreEtablissement` (création à la volée via contrat) : entourer l'insert d'un rattrapage `23505` (réutiliser `estViolationUnicite` de `etablissement.service.ts:49-55`) → si collision de nom, **récupérer l'établissement existant du foyer par nom** et poursuivre la transaction avec son id (plus de crash du contrat au retry).
  - `etablissement.service.creer` : même patron `onConflictDoNothing({ target: etablissement.id })` sur l'id fourni → rejeu même id = renvoyer l'existant sans nouvel événement. Un **vrai** doublon de nom (id différent) continue de lever `23505` → 409 (comportement UX conservé).
- Pact : mettre à jour les interactions de création (`pacts/api-gateway-svc-planification.json`, interactions « une création de contrat ALSH… » et « une création de contrat cantine ABCM ») : le corps de requête porte `id` matché par regex UUID (comme le `$.id` de la réponse l'est déjà). Régénération à blanc.
- L'outbox reste dans la même transaction que l'insert (invariant existant, ne pas casser).

### Conventions à respecter

Zod strict sur les UUID (attention : `z.string().uuid()` du repo est en mode strict v4 — piège documenté du chantier enfantId ; utiliser la même forme que les schémas existants du fichier). Pas de `TODO` laissé en code.

### Critères d'acceptation

- Test service planification : appeler `creerContrat` deux fois avec le **même id** → 1 seule ligne `contrat`, 1 seul événement outbox, les deux appels renvoient le même `ContratVue`.
- Test service établissement : idem (même id → même ressource, un seul `EtablissementCree`) ; id différent + même nom → `ConflictException` (409) conservée.
- Test `resoudreEtablissement` : `nouvelEtablissement` avec nom déjà pris → le contrat se crée, lié à l'établissement existant.
- Test client gateway : vérifier que le corps envoyé contient un `id` UUID et que les deux tentatives d'un retry portent **le même** id (spy sur fetch, simuler un premier échec réseau).
- Pact régénéré sans doublon, provider vert, `can-i-deploy` vert.
- `pnpm nx run-many -t typecheck test lint -p api-gateway svc-planification` vert.

### Comment vérifier

Unit + pact ci-dessus. Preuve bout-en-bout facultative en stack locale : créer un contrat via l'UI, vérifier en base (`docker compose exec -T postgres-planification psql -U planification -d planification -c "SELECT count(*) FROM contrat WHERE …"`) qu'aucun doublon n'apparaît même en simulant une latence (non bloquant si non fait — les tests service prouvent l'invariant).

### Pièges connus

- Les specs du service utilisent un **fake DB à espions** (`planification.service.spec.ts:402+`) : étendre le fake pour supporter `onConflictDoNothing().returning()` (le fake du même repo côté consumers, `projection.integration.spec.ts`, sait déjà le faire — s'en inspirer).
- Ne pas ajouter `id` au schéma BFF public (`creerContratSchema` de `bff.dto.ts`) : l'id est injecté **après** validation, côté client gateway. Le web ne doit pas pouvoir choisir un id.
- `modifierContrat`/`ecrirePlanning` sont des PUT déjà idempotents : n'y touche pas.

---

## Lot 4 — C2 : garde de monotonie sur les projections

**Modèle d'exécution : Opus 4.8.** Aucune dépendance de lot (peut suivre le lot 3 pour éviter les conflits sur `svc-planification` — ordre conseillé mais non bloquant : les fichiers touchés sont différents).

### Objectif

Avant : les upserts de projection écrasent inconditionnellement — un événement **ancien** re-livré après un récent (NAK + backoff JetStream) remet l'état à hier (revenus périmés → tarifs faux, e-mail d'établissement périmé → récap mal adressé), silencieusement. Après : toute projection d'état n'applique un événement que s'il est **plus récent** que l'état stocké (`occurred_at` de l'enveloppe, `libs/contracts/kernel/src/lib/events/integration-event.ts:16-42`).

### Périmètre exact

- `apps/svc-tarification/src/consumers/projection.service.ts` : `appliquerFoyerMisAJour` (l.163-200), `appliquerGrillePubliee` (l.233-271), `appliquerPlanningModifie` (l.397-480), `appliquerContratCree` (l.279-313), `appliquerContratModifie` (l.322-367) + `schema.ts` + 1 migration.
- `apps/svc-notifications/src/consumers/projection.service.ts` : `appliquerContratCree/Modifie` (l.186-263), `appliquerParentEtat` (l.292-324), `appliquerPreferencesNotif` (l.358-393), `appliquerEtablissementEtat` (l.404-440) + `schema.ts` + 1 migration.
- Tests : `projection.integration.spec.ts` des deux services (base factice à état).
- **Hors périmètre — décisions d'exclusion** :
  - `appliquerEnfantAjoute` (tarification, table `enfant`) : insert-only de fait, pas de champ écrasable significatif — exclu.
  - `appliquerContratSupprime` / `appliquerParentRetire` / `appliquerEtablissementSupprime` : les deletes ne régressent pas (une résurrection par événement tardif est théoriquement possible mais l'ordre suppression-après-modification est garanti par l'outbox du producteur ; hors périmètre, noté ici pour l'histoire).
  - `appliquerEnfantModifie` (svc-planification, l.114-158) : **exclu** — la table `contrat` est la source de vérité (pas un read-model), le champ `enfant` est une dénormalisation qui s'auto-répare au prochain renommage, et lui ajouter un `occurred_at` polluerait le schéma métier. Risque accepté.

### Décisions prises

- **Patron unique** : sur chaque `onConflictDoUpdate`, ajouter `setWhere: sql`${t.occurredAt} is null or ${t.occurredAt} <= excluded.occurred_at`` (égalité incluse : un même instant ne doit pas bloquer un correctif re-émis). Les colonnes `event_id`/`occurred_at` sont **toujours** écrites dans `values` et `set` (elles le sont déjà côté tarification `foyer`/`grille_tarifaire`/`prestation_mois` — il ne manque que la clause).
- **Migrations additives** (via `pnpm drizzle-kit generate`, numéro suivant de chaque service) :
  - tarification : `event_id uuid` + `occurred_at timestamptz` (nullables) sur `contrat`.
  - notifications : idem sur `contrat`, `etablissement`, `foyer_parent`, `preference_notification`.
  - Lignes existantes : `occurred_at NULL` → la clause `is null or …` les laisse se faire mettre à jour au premier événement (auto-amorçage, pas de back-fill).
- **Cas `appliquerPreferencesNotif`** (delete + insert, pas un upsert) : avant le delete, `SELECT max(occurred_at)` des lignes du parent ; si l'événement est strictement plus ancien, ne rien faire (return après `marquerTraite` — l'événement est consommé, pas appliqué). Même logique de pré-check pour tout handler non-upsert du périmètre.
- `appliquerPlanningModifie` (tarification) appelle `planificationClient.prestations()` : ne pas toucher à cet appel ; seule la clause `setWhere` s'ajoute à l'upsert `prestation_mois`.

### Conventions à respecter

`marquerTraite` est dupliqué par service (pas dans nest-commons) — **ne pas le factoriser dans ce lot** (dérive de périmètre). SQL Drizzle : réutiliser les helpers `sql` déjà importés dans ces fichiers.

### Critères d'acceptation

- Pour chaque handler du périmètre, un test « désordre » dans `projection.integration.spec.ts` : événement A (`occurredAt` T2, id X) appliqué, puis événement B (`occurredAt` T1 < T2, **id différent** Y) → l'état reste celui de T2 ; et un test « rattrapage » : B (T1) puis A (T2) → état T2. Le patron existant est là : voir « un NOUVEL événement (id différent) met à jour la projection » (tarification l.270) et les fixtures à `occurredAt` variés.
- Le fake `fakeBaseEnMemoire()` doit honorer `setWhere` — l'étendre si besoin (il évalue déjà les `queryChunks` Drizzle pour `eq`).
- Migrations générées + jouées au boot en stack locale sans erreur (`docker compose up` → logs de migration OK).
- `pnpm nx run-many -t typecheck test lint -p svc-tarification svc-notifications` vert. Aucun contrat Pact touché (projections internes).

### Comment vérifier

Tests d'intégration ci-dessus (c'est la preuve). En stack locale : `docker compose up -d --build svc-tarification svc-notifications` → vérifier dans psql que les nouvelles colonnes existent (`\d contrat` dans chaque base).

### Pièges connus

- `excluded.occurred_at` : en Drizzle, la syntaxe exacte dans `setWhere` passe par `sql` brut — vérifier le SQL généré dans un test (le fake n'attrape pas une faute de syntaxe Postgres ; le boot en stack locale, si).
- Ne pas oublier `set: { …, eventId, occurredAt }` sur les upserts qui ne les écrivaient pas encore (contrat/etablissement/parents notifications) — sinon la garde compare toujours à NULL.

---

## Lot 5 — A1 : « Signaler une absence » en 2 taps

**Modèle d'exécution : Opus 4.8.** **Dépend du lot 1 mergé** (les deux modifient `DashboardJourPage.tsx`).

### Objectif

Avant : signaler l'absence du matin = Planning → onglet enfant → onglet mode → jour dans la grille → formulaire dense (~8 taps + scroll). Après : depuis « Aujourd'hui », bouton « Signaler une absence » sur la rangée de garde → modale de confirmation → c'est enregistré (2 taps + confirmation), sans rien perdre du reste du mois.

### Périmètre exact

- `apps/web/src/dashboard/DashboardJourPage.tsx` (rangées `RangeeJour` l.74-130 — sections Aujourd'hui **et** Demain), nouveau `apps/web/src/dashboard/ModaleAbsenceRapide.tsx`.
- Réutilisation pure (pas de modification) : `apps/web/src/planning/saisieAbsence.ts` (`plageGardeDuJour` l.55, `fenetreAbsence` l.80), `apps/web/src/ui/Modale.tsx`, `api.lirePlanning`/`api.ecrirePlanning` (`client.ts:531-543`, `490-509`).
- Nouveau test e2e : `apps/web/e2e/absence-rapide.stack.e2e.spec.ts` + tests unit dans `DashboardJourPage.test.tsx`.
- **Hors périmètre** : contrats ABCM (cantine/péri/ALSH — H3 : leur rangée garde le seul lien « Modifier ») ; absences partielles/multi-jours (le lien « Préciser » renvoie au planning) ; toute modification de `CalendrierCreche`.

### Décisions prises

- **Éligibilité du bouton** : rangée avec `ligne.etat === 'garde'` ET `ligne.mode === 'CRECHE_PSU'` ET `plageGardeDuJour(semaineType, iso)` non-null. Le `semaineType` vient de `data.contrats[]` (`ContratBesoinsSemaine.semaineType`) — il faut le **propager** jusqu'à `RangeeJour` (ajouter le contrat ou la plage à `LigneJour` via `lignesDuJour`, ou passer `data.contrats` en prop et retrouver par `contratId` — au choix de l'exécutant, sans casser la pureté de `jourFoyer.ts` : si `LigneJour` s'enrichit, mettre à jour ses tests).
- **UI** : bouton `className="btn secondaire"` libellé `Signaler une absence`, `aria-label` = `Signaler une absence de {enfant} le {date}` (désambiguïsation comme le lien Modifier existant l.122). Position : à côté du lien « Modifier » dans la rangée (les boutons s'empilent naturellement <480px — pattern `.encart-actions` réutilisable si besoin).
- **Modale** (`ModaleAbsenceRapide`) via `ui/Modale.tsx` (`refFocusInitial` sur le bouton Confirmer) :
  - Titre : `Signaler une absence`.
  - Corps : `{enfant} sera noté(e) absent(e) toute la journée du {jour} {date}.` + ligne `muted` : `Horaires prévus : {arrivée}–{départ}.`
  - Boutons : `Confirmer l'absence` (primaire) / `Annuler` (secondaire). Lien discret sous les boutons : `Préciser (horaires, certificat, plusieurs jours)…` → navigue vers le deep-link planning existant (même construction que le lien Modifier : `/foyers/{foyerId}/planning?enfant=…&mode=…&mois=…`) et ferme la modale.
- **Écriture — read-modify-write obligatoire** (le PUT mois est un **remplacement complet**, preuve : `CalendrierCreche.envoyer` réémet tout, l.442-512) :
  1. `lirePlanning(contratId, mois, false)` → `saisie` existante (`LirePlanningReponse.saisie`, potentiellement `null`).
  2. Construire la nouvelle absence : `{ date, ...fenetreAbsence('journee', saisieVide, plageGardeDuJour(semaineType, date)), preavisJours: 0, certificatMaladie: false }`.
  3. Fusion (règle « un jour = une saisie », comme `CalendrierCreche` l.455-470) : retirer de `saisie.ajustements` et `saisie.joursSupplementaires` toute entrée à la même `date` ; remplacer toute absence existante à la même date ; conserver **tout le reste** (`complementMinutes`, autres jours, `pai` si présent).
  4. `ecrirePlanning(contratId, mois, false, corpsFusionné)` — jamais `simule=true`.
  5. Succès → fermer la modale, message `role="status"` sur le dashboard : `Absence enregistrée pour {enfant} ({date}). Retrouvez-la dans le planning.` + `reload()` de la semaine (le dashboard raffiche la rangée en « Absent »).
  6. Échec → rester dans la modale, message `role="alert"` : `messageErreur(err)` (utilitaire existant `utils/erreurs.ts`) + bouton `Réessayer`.
  - Double-clic : désactiver Confirmer pendant l'appel (`Enregistrement…`).
- **Pas de brouillon sessionStorage** ici (flux atomique court) et **pas de debounce** (écriture immédiate, contrairement au calendrier).

### Conventions à respecter

`import type` ; fonctions pures de dérivation testables séparément (suivre le style `jourFoyer.ts`) ; sélecteurs de tests sémantiques (`aria-label`, rôles — **pas** de `data-testid`, le dashboard n'en a aucun).

### Critères d'acceptation

- Sur une garde crèche d'aujourd'hui ou demain : 1 tap « Signaler une absence », 1 tap « Confirmer l'absence » → la rangée passe à « Absent », le planning du mois montre l'absence, et **les ajustements/jours ajoutés des autres jours du mois sont intacts**.
- Le bouton n'apparaît pas : sur une rangée ABCM, sur un jour sans garde, sur une rangée déjà « Absent ».
- Hors-ligne : l'échec affiche le message hors-ligne existant (via `messageErreur`) — pas de perte silencieuse.
- `pnpm nx run-many -t typecheck test lint -p web` vert ; e2e stack vert.

### Comment vérifier

1. Unit (`DashboardJourPage.test.tsx`) : mocker `api.lirePlanning` (saisie existante avec 1 ajustement sur un AUTRE jour + 1 jour supplémentaire) et `api.ecrirePlanning` → asserter que le corps du PUT **contient toujours** l'ajustement et le jour supplémentaire, plus la nouvelle absence ; asserter la disparition du bouton sur rangée ABCM/absente ; asserter le message de succès et le `reload`.
2. e2e stack (`absence-rapide.stack.e2e.spec.ts`, modelé sur `planning-saisie-complete.stack.e2e.spec.ts` et le helper `apps/web/e2e/support/stack.ts`) : dashboard → signaler l'absence du jour de garde → confirmer → attendre le PUT 204/200 (filtrer par méthode ET statut — piège connu : le rejeu peut dupliquer les réponses) → reload → l'absence persiste dans le calendrier.
3. Live 375px : recette commune, vérifier le geste au pouce (boutons ≥44px — hérité des styles globaux).

### Pièges connus

- **Ne pas** écrire seulement `{ absences: [...] }` : le PUT efface ce qui n'est pas réémis (c'est LE piège du lot).
- `fenetreAbsence('journee', …)` exige la plage de garde du jour — si `semaineType` est absent du contrat (contrat dégradé), le bouton ne doit pas s'afficher (déjà couvert par l'éligibilité).
- e2e : la semaine du dashboard dépend du jour d'exécution — utiliser les helpers de date du support stack (jour de garde seedé : lun/mer/ven pour Zoé).
- `useAsync` cache : après écriture, `reload()` explicite (le cache ne s'invalide pas seul).

---

## Lot 6 — A3 + A4 : langage & mode simulation

**Modèle d'exécution : délégable à Sonnet 5** (tout est tranché ci-dessous ; aucune décision restante). Aucune dépendance de lot.

### Objectif

Cohérence du vocabulaire parent sur les écrans non retouchés récemment, et un mode simulation qui s'explique.

### Périmètre exact (fichier par fichier, changement par changement)

1. `apps/web/src/utils/libelles.ts:13` — `ALSH: 'ALSH'` → `ALSH: 'Centre de loisirs'`. Effet global via `libelleMode` (onglets du planning, dashboard, coûts). **Répercuter** dans tout test/e2e qui asserte le libellé : `grep -r "ALSH" apps/web/src apps/web/e2e` et ajuster les assertions de **libellé** (ne pas toucher au code de mode `'ALSH'` ni aux types).
2. `apps/web/src/couts/PanneauCoutMois.tsx` — `LigneCout` (l.42-54) gagne une prop `avecSigne: boolean` (défaut `true`) ; `SectionPrestation` (l.56-74) rend ses lignes avec `avecSigne={false}` (le signe reste dans le `RecapGlobal`). Titre du `RecapGlobal` (l.76-86) : `Récapitulatif` → `Total du mois`.
3. `apps/web/src/notifications/RelectureEnvoi.tsx:422` — `Chargement des brouillons…` → `Préparation des récapitulatifs…`.
4. `apps/web/src/etablissements/EtablissementsPage.tsx:418` — `Sans e-mail, cette crèche ne recevra pas les récapitulatifs.` → `Sans e-mail, ce lieu d'accueil ne recevra pas les récapitulatifs.` (+ le test `EtablissementsPage.test.tsx:102`).
5. `apps/web/src/foyer/ContratsPage.tsx:178` — `tranche de revenus {data.foyer.tranche}` → `tranche CAF {data.foyer.tranche}`.
6. `apps/web/src/planning/delaiPreavis.ts:89` — retirer le préfixe `'⏰ '` du texte (l'icône est déjà portée par `EditeurSemaine.tsx:129` : `🕒`). Vérifier par grep (`delai.texte`, `delaiPreavis`) qu'aucun autre usage ne dépendait de l'émoji ; ajuster les tests de `delaiPreavis` qui matchent la chaîne.
7. A4 — `apps/web/src/planning/PlanningPage.tsx` (checkbox l.217-235) : sous le label, quand `simule` est actif, ajouter `<p className="muted aide-simulation">Le mode simulation vous laisse essayer des changements sans toucher au planning réel ni aux récapitulatifs envoyés.</p>`. La classe `aide-simulation` existe (utilisée dans CoutsAnnuelsPage) — vérifier qu'elle est bien dans `styles.css`, sinon la créer (`margin: var(--esp-1) 0 0`).
8. A4 — `apps/web/src/couts/CoutsAnnuelsPage.tsx:340-344` — remplacer le texte d'aide par : `Le mode simulation vous laisse essayer des changements sans toucher au planning réel. Comparez ici le coût simulé au coût réel.`

- **Hors périmètre** : le champ `types` d'établissement (le code est déjà propre — commentaire `EtablissementsPage.tsx:146-147`, rien à faire) ; tout changement de comportement ; le badge « Simulation » (déjà présent).

### Conventions à respecter

`import type` ; ne PAS toucher aux valeurs de l'enum `Mode` (seulement les libellés) ; commit par thème acceptable mais 1 PR.

### Critères d'acceptation

- Onglets du planning : « Cantine · Crèche · Périscolaire · Centre de loisirs » ; aucun « ALSH » nu visible à l'écran (le glossaire `Abbr` peut conserver l'entrée ALSH).
- Panneau coût du mois : les lignes par prestation n'ont plus de signe ; le bloc final s'intitule « Total du mois » et garde les signes.
- Les textes 3-6 remplacés mot pour mot ; l'aide simulation visible sur Planning ET Coûts quand la case est cochée.
- `pnpm nx run-many -t typecheck test lint -p web` vert ; e2e stack vert (libellés répercutés).

### Comment vérifier

Tests unitaires ajustés + passage live 375px (recette commune) sur Planning (onglets + simulation), Coûts (panneau + aide), Établissements (avertissement), Contrats (tranche).

### Pièges connus

- Les specs e2e asserte(nt) des libellés (`planning-abcm.stack.e2e.spec.ts` notamment) — c'est la moitié du travail du point 1.
- « Centre de loisirs » est plus long qu'« ALSH » : vérifier à 375px que la rangée d'onglets ne déborde pas (elle a `overflow-x:auto` — un débordement scrollable est acceptable, un écrasement du texte non).

---

## Lot 7 — E1 + E2 + D2 : bundle, icônes PWA, focus

**Modèle d'exécution : délégable à Sonnet 5** (étapes entièrement prescrites ; si les tests Suspense partent en vrille non triviale, remonter à Opus 4.8). **Dépend du lot 6 mergé** (les deux touchent `PlanningPage.tsx` — éviter le conflit).

### Objectif

Avant : un seul JS de 647 Ko (mesuré) chargé même sur le dashboard, avec FullCalendar dedans ; une seule icône PWA SVG (installation iOS dégradée) ; `scroll-padding-bottom` (3.5rem) plus petit que la barre d'onglets + le padding du main (4.25rem) → un élément focusé peut passer sous la barre fixe (WCAG 2.4.11). Après : FullCalendar hors du bundle initial, icônes PNG 192/512/180, focus jamais masqué.

### Périmètre exact

- `apps/web/src/planning/PlanningPage.tsx` (imports des calendriers), `apps/web/vite.config.mts` (manifest icons), `apps/web/public/icons/`, `apps/web/index.html` (apple-touch-icon), `apps/web/src/styles.css` (l.296-298).
- **Hors périmètre** : `manualChunks` manuels (le lazy suffit), lazy des routes (AQ-18 assumé), toute autre page.

### Décisions prises

- **E1** : dans `PlanningPage.tsx`, remplacer les imports statiques de `CalendrierCreche` et `CalendrierAbcm` par :
  ```ts
  const CalendrierCreche = lazy(() =>
    import('./CalendrierCreche').then((m) => ({ default: m.CalendrierCreche })),
  );
  const CalendrierAbcm = lazy(() =>
    import('./CalendrierAbcm').then((m) => ({ default: m.CalendrierAbcm })),
  );
  ```
  et envelopper leurs usages (l.421, 429) dans `<Suspense fallback={<ChargementPage message="Chargement du calendrier…" />}>` (composant existant `ui/ChargementPage.tsx`). Les imports **de type** `@fullcalendar/*` restants dans `CalendrierCreche.tsx` sont `import type` → sans effet bundle. Ne pas toucher `CalendrierMois.tsx`.
- **E2** : générer depuis `apps/web/public/icons/icon.svg` : `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` (marge de sécurité 10 % autour du motif), `icon-180.png` (rasterisation via un outil local une seule fois — ImageMagick/`npx svgexport`/éditeur ; **les PNG sont commités, aucune dépendance ajoutée**). Manifest (`vite.config.mts` l.80-87) : garder le SVG et ajouter les 3 entrées (192 `any`, 512 `any`, 512 `maskable`). `index.html` : `<link rel="apple-touch-icon" href="/icons/icon-180.png">`.
- **D2** : `styles.css` l.296-298 — `html { scroll-padding-bottom: calc(3.5rem + env(safe-area-inset-bottom)); }` → `calc(4.5rem + env(safe-area-inset-bottom))` (≥ le padding du main 4.25rem, marge comprise).

### Critères d'acceptation

- `pnpm nx build web` : le chunk principal passe **sous 400 Ko** (raw) et un chunk séparé contient FullCalendar (lister `dist/apps/web/assets/`). Le service worker précache toujours tous les chunks (globPatterns par défaut de VitePWA — vérifier `sw.js` généré).
- Navigation dashboard → planning : le fallback « Chargement du calendrier… » apparaît au premier accès puis plus jamais (chunk en cache).
- Manifest servi avec 4 icônes ; audit Lighthouse PWA (ou inspection manuelle du manifest) sans avertissement d'icône.
- À 375px, tabuler jusqu'aux derniers éléments focusables d'une page longue : l'élément focusé reste visible au-dessus de la barre d'onglets.
- `pnpm nx run-many -t typecheck test lint -p web` vert ; e2e stack vert (les e2e planning attendent le calendrier — Playwright attend déjà les éléments, le lazy ne doit rien casser ; si un timeout apparaît, augmenter l'attente du helper, pas des `sleep`).

### Pièges connus

- Tests unitaires de `PlanningPage` : avec `lazy`, le rendu devient asynchrone → utiliser `await screen.findBy…` (la plupart le font déjà) ; si un test utilise `getBy…` immédiatement après `render`, il faudra le passer en `findBy`.
- `vi.useFakeTimers` + Suspense peuvent interagir mal : si un test gèle les timers, résoudre le lazy d'abord (un `await screen.findByRole('tablist', …)` suffit).
- Ne pas oublier `import { lazy, Suspense } from 'react';` (et `ChargementPage`) — verbatimModuleSyntax : `lazy`/`Suspense` sont des valeurs, import normal.

---

## Ordre d'exécution et dépendances

| Ordre | Lot                         | Dépend de               | Modèle                                         |
| ----- | --------------------------- | ----------------------- | ---------------------------------------------- |
| 1     | Lot 1 — B2 dashboard        | —                       | Opus 4.8                                       |
| 2     | Lot 2 — B1 suivi des envois | —                       | Opus 4.8                                       |
| 3     | Lot 3 — C1 idempotence      | —                       | Opus 4.8                                       |
| 4     | Lot 4 — C2 monotonie        | (conseillé après lot 3) | Opus 4.8                                       |
| 5     | Lot 5 — A1 absence 2 taps   | **Lot 1 mergé**         | Opus 4.8                                       |
| 6     | Lot 6 — A3+A4 langage       | —                       | **Sonnet 5**                                   |
| 7     | Lot 7 — E1+E2+D2            | **Lot 6 mergé**         | **Sonnet 5** (escalade Opus si tests Suspense) |

Parallélisable : {1, 2, 3, 6} peuvent partir ensemble (fichiers disjoints, sauf pactes : les lots 2 et 3 régénèrent `/pacts` — **les merger l'un après l'autre**, re-régénérer après le premier merge).

## Après le chantier (hors lots, pour mémoire)

- Déploiement via release train habituel (`deploy.mjs`) ; les migrations du lot 4 sont additives, aucun nouveau secret/env/compose.
- Restes déjà cadrés ailleurs (ne pas dupliquer ici) : bascule `INTERSERVICE_AUTHZ_ENFORCE`, décision fail-open `ScopeFoyerGuard`, NOT NULL `enfant_id`, smoke live PO.
