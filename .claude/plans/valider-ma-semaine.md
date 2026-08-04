# Plan d'exécution — Parcours « Valider ma semaine » : palier produit professionnel

> **Exécutant : Opus 4.8.** Ce plan est auto-portant : toutes les décisions produit et
> d'architecture sont tranchées ici. N'ouvre aucun arbitrage — si un détail manque,
> choisis l'option la plus proche de l'esprit décrit, note-la dans la PR, n'invente pas
> de fonctionnalité.

## Contexte et objectif

Le parcours n°1 du parent : mardi matin, il reçoit le mail « valider la semaine N+1 » ;
mardi soir, sur téléphone, il relit la semaine, ajuste les besoins, valide, et prévient
l'établissement si besoin. La chaîne traverse web → api-gateway → svc-planification →
NATS → svc-notifications → SMTP (envoi réel actif en prod).

L'audit (2026-07-06, validé par le PO) a établi que la chaîne backend est globalement
saine (transactions bi-mois, outbox, idempotence `processed_event`, allowlist par
destinataire) mais que le parcours a **trois défauts majeurs** et une **évolution
demandée** :

1. **Le lien du mail du mardi est cassé** : il pointe vers `/planning?semaine=…`,
   route inexistante (tout vit sous `/foyers/:foyerId/planning`) → page introuvable.
   Le paramètre `?semaine` n'est de toute façon lu nulle part.
2. **Demande PO : saisir les heures réelles.** Aujourd'hui la modale crèche demande de
   déclarer une _fenêtre d'absence_ ; impossible de dire « déposé à 8h au lieu de 9h »
   (une arrivée en avance est irreprésentable dans le modèle). Cible : le parent saisit
   l'heure d'arrivée et de départ réelles, l'app déduit l'état.
3. **Un échec SMTP du mardi perd le mail définitivement** : la ligne `notification_hebdo`
   est créée avant l'envoi ; au tick suivant, « déjà notifié » → no-op → le rappel ne
   partira jamais, sans trace exploitable.
4. Jargon technique visible (« semaine 2026-W27 », « 2026-07-01 — modifiée ») et cloche
   in-app non actionnable.

## Décisions produit validées par le PO (2026-07-06)

- **Périmètre** : les 6 lots ci-dessous, bout-en-bout (front + backend).
- **Facturation des extensions** : les minutes au-delà de la plage du contrat sont
  facturées en complément à la minute (règle PSU déjà dans le domaine), et **la modale
  l'annonce au parent avant confirmation**.
- **Réductions** : une réduction d'heures est une absence partielle — la modale pose les
  questions préavis/certificat, le domaine applique la même règle d'éligibilité à
  déduction que les absences (préavis suffisant ou certificat).

## Hypothèses assumées (défauts pris faute de question restante — corrigibles avant lancement)

- **A1** — Les « heures réelles » ne concernent que le mode `CRECHE_PSU` (les modes
  ABCM sont à cases à cocher, sans heures) .
- **A2** — Un ajustement d'heures ne se saisit que sur un **jour gardé** (présent dans
  la `semaineType`). Sur un jour non gardé, le parent utilise « Jour ajouté » (existant).
- **A3** — Une seule saisie par jour et par contrat : un jour porte soit un ajustement,
  soit une absence journée entière, soit un jour ajouté — jamais deux à la fois. Le
  domaine rejette les combinaisons sur une même date.
- **A4** — Le scheduler de svc-notifications tourne en **instance unique** (déploiement
  Compose actuel) : la reprise d'envoi du lot 3 n'a pas besoin de verrou multi-réplica
  au-delà du compare-and-set existant.
- **A5** — Le lien in-app est stocké en **chemin relatif** (`/foyers/…`) : le web le rend
  tel quel, pas d'URL absolue en base.
- **A6** — Pas de navigation inter-semaines dans l'éditeur (décision produit existante
  conservée : la semaine notifiée seulement).
- **A7** — Aucune nouvelle dépendance npm. Observabilité du lot 3 = table + logs
  structurés (+ requête postgres-exporter si le pattern existe déjà), pas de prom-client.
- **A8** — Les libellés de dates dans les mails incluent l'année (« semaine du 6 au
  12 juillet 2026 ») pour lever toute ambiguïté hors contexte.
- **A9** — Le NOT NULL différé sur `contrat.enfant_id` est **hors périmètre** (session
  dédiée déjà prévue).

## Conventions et pièges transverses (valables pour TOUS les lots)

- **pnpm via corepack, toujours** : `corepack pnpm@10.34.2 …` (jamais le pnpm global 8.x).
- **Nx pour toute tâche** : `corepack pnpm@10.34.2 nx run-many -t lint test -p <projets>` (le
  type-check est une arête de la cible `test`).
- **Repo** : travailler dans le clone `creche-planner-public`, `main` protégée → branche
  - PR + check `ci`. Commitlint : sujet ≤ 100 caractères.
- **ESLint 9 flat config type-aware** (ratchet warn→error) ; `verbatimModuleSyntax`
  web-only (`import type`) ; `ReadonlyArray<T>` interdit → `readonly T[]` ;
  `prefer-const` et `noUncheckedIndexedAccess` actifs ; branded types dans le domaine.
- **Zod** : `z.uuid()` (la forme `z.string().uuid()` est dépréciée → lint no-deprecated) ;
  `z.array(...).readonly()` pour les tableaux readonly.
- **Pacts** : `/pacts` est dans `.prettierignore` — ne jamais les formatter. En cas de
  modification d'interaction, **régénérer les pacts à blanc** (supprimer puis regénérer)
  pour éviter les doublons de merge. `can-i-deploy` doit rester vert : ne faire que des
  ajouts de champs **optionnels** dans les réponses/requêtes.
- **Environnement de travail** : `pnpm preflight` en début de session — cf.
  [CONTRIBUTING.md § Pièges](../../CONTRIBUTING.md), source unique sur la boucle de dev.
- **e2e stack** : specs dans `apps/web/e2e/*.stack.e2e.spec.ts` (config
  `apps/web/playwright.stack.config.ts`). L'orchestrateur e2e-stack est **destructif**
  (`docker compose down -v`) — ne pas le lancer sur une stack de dev en cours d'usage.
  Piège #171 : avec le rejeu idempotent du client web, un `page.waitForResponse` filtré
  seulement par méthode attrape le retry — filtrer aussi par **statut** (204/200).
  Réutiliser les helpers de `apps/web/e2e/support/` (dont `stack.ts`).
- **Vérif UI locale** : stack docker + seed, puis stopper le conteneur web et lancer Vite
  dev sur :4200 (voir mémoire projet « Vérif UI locale »).
- **Libellés** : tout changement de texte visible du parent doit être répercuté dans les
  tests composants ET les specs `apps/web/e2e/*.stack.e2e.spec.ts` qui l'assertent.

## Ordre et dépendances des lots

| Ordre | Lot                                    | Dépend de          | PR   |
| ----- | -------------------------------------- | ------------------ | ---- |
| 1     | Lot 1 — Réparer l'entrée du parcours   | —                  | 1 PR |
| 2     | Lot 2a — Domaine & API « ajustements » | —                  | 1 PR |
| 3     | Lot 2b — UX saisie heures réelles      | 2a mergé           | 1 PR |
| 4     | Lot 3 — Fiabiliser le mail du mardi    | — (parallélisable) | 1 PR |
| 5     | Lot 4 — Langage parent                 | 1 et 2b mergés     | 1 PR |
| 6     | Lot 5 — Filet e2e du parcours          | 1, 2a, 2b mergés   | 1 PR |

---

## Lot 1 — Réparer l'entrée du parcours (mail + cloche → 1 tap)

**Modèle d'exécution : Opus 4.8** (routing web + migration + Pact demandent du jugement).

### Objectif

Avant : le parent tape le lien du mail → « Page introuvable » ; la cloche liste des
notifications non tapables. Après : mail et notification in-app mènent en 1 tap à
l'éditeur de la semaine concernée, déjà ouvert.

### Périmètre exact

- `apps/svc-notifications/src/scheduler/scheduler.hebdo.ts` (ligne ~267 : `lienApp`)
- `apps/svc-notifications/src/email/templates/recapMardi.ts` + `recapMardi.spec.ts`
  (fixture `LIEN`)
- `apps/svc-notifications/src/inbox/inbox.message.ts`, `inbox.service.ts`,
  `inbox.controller.ts`
- `apps/svc-notifications/src/database/schema.ts` + **nouvelle migration
  `0013_notification_lien.sql`** (vérifier que 0013 est bien le prochain numéro libre)
- api-gateway : le contrôleur BFF qui proxifie `GET /api/v1/moi/notifications` et
  `POST /api/v1/moi/notifications/:id/lu` (le localiser : `grep -r "moi/notifications" apps/api-gateway/src`)
- `apps/web/src/planning/PlanningPage.tsx`, `apps/web/src/notifications/EncartValidation.tsx`,
  `apps/web/src/notifications/ClocheNotifications.tsx`, `apps/web/src/types/bff.ts`
- Pacts : `apps/api-gateway/src/contract/*` (consumer) et
  `apps/svc-notifications/src/contract/notifications.provider.pact.spec.ts` (provider)

**Hors périmètre** : tout changement de libellé non nécessaire (lot 4), le contenu du
mail au-delà du lien, la logique de validation.

### Décisions déjà prises

1. **Lien du mail** : `${appUrl}/foyers/${foyerId}/planning?semaine=${semaineIso}`.
   Le `foyerId` est disponible dans la boucle d'envoi par foyer du scheduler.
2. **PlanningPage consomme `?semaine`** : lire `searchParams.get('semaine')`, valider par
   la regex `^\d{4}-W\d{2}$` (rejet silencieux sinon), et passer la valeur à
   `EncartValidation` via une nouvelle prop optionnelle `semaineInitiale?: string`.
3. **EncartValidation** : quand `semaineInitiale` est fournie ET apparaît dans la liste
   des semaines à valider chargée, initialiser `semaineEditee` à cette semaine (éditeur
   ouvert d'office) et faire défiler l'encart à l'écran (`scrollIntoView`, une seule
   fois). Si la semaine n'est pas (ou plus) dans la liste : ignorer sans message d'erreur
   (le parent a peut-être déjà validé — l'encart affichera l'état normal).
4. **Colonne `lien`** : `ALTER TABLE notification ADD COLUMN lien varchar(300);`
   (nullable, additif, pas de backfill — les anciennes notifications restent sans lien).
5. **Message in-app** : `messageValidationHebdo` reçoit désormais le `foyerId` et produit
   `lien = '/foyers/${foyerId}/planning?semaine=${semaineIso}'`. Le scheduler le passe
   (il itère déjà par foyer).
6. **API** : la réponse `InboxVue` expose `lien: string | null` sur chaque notification
   (champ **ajouté, optionnel côté consommateur** — compat ascendante). BFF : simple
   passthrough.
7. **Web (cloche)** : une notification avec `lien` devient entièrement tapable
   (`<Link to={lien}>` sur la carte) ; le tap déclenche aussi le marquage lu
   (fire-and-forget, ne pas bloquer la navigation si l'appel échoue). Les notifications
   sans lien gardent le comportement actuel (bouton « Marquer comme lu »).
8. Le panneau de la cloche se ferme à la navigation.

### Conventions à respecter

Transverses ci-dessus. Schéma Drizzle : suivre le style des colonnes existantes de
`schema.ts`. Types web dans `bff.ts` : suivre les interfaces existantes (docstrings FR).

### Critères d'acceptation

- Un mail généré (test unitaire `recapMardi.spec.ts`) contient un lien de la forme
  `…/foyers/<uuid>/planning?semaine=YYYY-Www`.
- Ouvrir `/foyers/:id/planning?semaine=<semaine à valider>` affiche l'éditeur de cette
  semaine ouvert, sans action supplémentaire.
- `?semaine` invalide ou déjà validée : la page se comporte comme sans paramètre.
- Une notification in-app de rappel hebdo est tapable et mène à la même URL ; elle passe
  en « lue » après le tap.
- Migration 0013 appliquée et réversible (un `DROP COLUMN` suffit — le noter dans la PR).
- Pacts régénérés sans doublon, provider verification verte, `can-i-deploy` inchangé.

### Comment vérifier

```
corepack pnpm@10.34.2 nx run-many -t lint typecheck test -p web api-gateway svc-notifications
corepack pnpm@10.34.2 nx run-many -t pact -p api-gateway svc-notifications   # vérifier le nom exact des targets Pact avant (nx show project api-gateway)
```

Vérif visuelle : stack locale + Vite (cf. mémoire « Vérif UI locale ») ; naviguer vers
`/foyers/<id>/planning?semaine=<semaine notifiée>` (déclencher le scheduler avec
`NOTIF_SCHEDULER_FORCER=1` sur la stack de test uniquement) et constater l'éditeur ouvert,
en 375 px de large.

### Pièges connus

- `NOTIF_SCHEDULER_FORCER` est **test-only** : jamais dans un compose de prod.
- Le rapport d'audit note que le paramètre `semaine` coexiste avec `mois`, `simule`,
  `enfant`, `mode` dans PlanningPage — ne pas écraser les autres paramètres en le lisant.
- Pact : ajout de champ = régénération à blanc (voir transverses).

---

## Lot 2a — Domaine & API : la catégorie datée « ajustements »

**Modèle d'exécution : Opus 4.8** (cœur du domaine métier).

### Objectif

Le modèle sait enfin représenter « ce jour-là, l'enfant était présent de 08:00 à 16:30 »
sur un jour contractualisé : réductions déductibles si éligibles, extensions facturées en
complément, donnée datée restituable jour par jour et transmise à l'établissement.

### Périmètre exact

- `libs/shared/semaine/src/lib/fenetre.ts` : `CATEGORIES_DATEES` (+ `libs/shared/semaine/src/index.ts` si besoin d'export)
- `apps/svc-planification/src/planification/planification.dto.ts` : schémas Zod
- `apps/svc-planification/src/planification/fusion-semaine.ts` : type `BesoinsSemaine` (Pick)
- `libs/planification/domain/src/lib/contrat-creche.ts` (+ `.spec.ts`, `.mbt.spec.ts`)
- `libs/planification/domain/src/lib/generation-prestations.ts` (+ `.spec.ts`) : pont JSON
- `apps/api-gateway/src/bff/semaine-besoins.ts` (+ `.spec.ts`) : vue consolidée
- `apps/svc-notifications/src/email/templates/brouillonService.ts` (+ `.spec.ts`) : rendu
  lisible des jours ajustés dans le récap établissement
- Pacts : `apps/api-gateway/src/contract/planification.consumer.pact.spec.ts`,
  provider specs de svc-planification et svc-notifications

**Hors périmètre** : toute l'UI web (lot 2b), la table SQL (la saisie est en jsonb :
**aucune migration nécessaire**), svc-tarification (le read-model parse en Zod
`passthrough`, et la forme des prestations générées ne change pas).

### Décisions déjà prises

1. **Nom et forme de la catégorie** — `ajustements`, entrée par date :
   ```ts
   // planification.dto.ts — mêmes bornes que les plages existantes
   const ajustementSchema = z.object({
     date: /* même schéma date ISO YYYY-MM-DD que absences */,
     debutHeures: …, debutMinutes: …, finHeures: …, finMinutes: …, // plage de présence RÉELLE
     preavisJours: z.number().int().min(0).default(0),
     certificatMaladie: z.boolean().default(false),
   });
   ```
   La plage stockée est la **présence réelle** du jour (pas un delta) : restituable telle
   quelle, robuste aux évolutions de la semaine type.
2. `CATEGORIES_DATEES` += `'ajustements'` — cela propage automatiquement la fusion
   (`fusionnerSemaineDansMois`) et le diff de validation (`extraireSemaine`, utilisé par
   svc-notifications). Mettre aussi à jour le `Pick` de `BesoinsSemaine` dans
   `fusion-semaine.ts` et les DTO `EcrirePlanningDto`/`EcrireSemaineDto`
   (`ajustements?: …`).
3. **Règles du domaine** (`contrat-creche.ts`, génération des prestations) :
   - Un ajustement sur un jour **sans plage dans la semaine type** → erreur domaine
     explicite (« ajustement sur un jour non gardé : utiliser un jour ajouté »).
   - Deux entrées datées sur la **même date** (ajustement + ajustement, ajustement +
     absence, ajustement + jour supplémentaire) → erreur domaine explicite (A3).
   - **Extension** = minutes de présence réelle en dehors de la plage contractuelle
     (avant l'arrivée contractuelle et/ou après le départ contractuel) → ajoutées au
     **complément** (même traitement que les `joursSupplementaires`).
   - **Réduction** = minutes de la plage contractuelle non couvertes par la présence
     réelle → **heures déduites** si l'entrée est éligible, en réutilisant **la même
     fonction d'éligibilité** que les absences (préavis/certificat — la localiser dans
     `contrat-creche.ts`, ne pas la dupliquer) ; sinon aucune déduction (les heures
     réservées restent dues).
   - Plage réelle strictement égale à la plage contractuelle → entrée sans effet (no-op
     toléré, pas une erreur).
   - L'invariant **INV-05** (déduites ≤ réservées) reste garanti — étendre les tests MBT.
   - Cas dégénérés (fin ≤ début) : rejetés par le schéma Zod (comme les plages existantes).
4. **BFF** : `semaine-besoins.ts` inclut `ajustements` dans chaque `SaisieJourBesoins`
   de la vue consolidée (défaut `[]`, comme les autres catégories).
5. **Diff/snapshot de validation** : rien à coder côté svc-notifications (piloté par
   `CATEGORIES_DATEES`), MAIS vérifier par un test que les snapshots historiques sans
   clé `ajustements` diffent proprement (catégorie absente ≡ vide).
6. **Récap établissement** (`brouillonService.ts`) : le rendu par jour doit produire pour
   un ajustement une ligne compréhensible par le personnel de la crèche :
   `« <date> : présence 08:00–16:30 »` (la plage contractuelle n'est pas disponible dans
   le delta : ne pas essayer de l'afficher). S'adapter à la structure existante du
   template (jours ajoutés/retirés) sans la refondre.

### Conventions à respecter

Transverses. Domaine pur : aucune I/O, aucune horloge ; suivre le style
`Duree`/branded types existant. Les messages d'erreur domaine sont en français, comme
les existants (cf. INV-05).

### Critères d'acceptation

- `PUT /api/contrats/:id/plannings/semaine/:semaineIso` accepte `ajustements` ; la
  fusion préserve les autres jours/catégories ; l'écriture bi-mois reste atomique
  (aucun changement du flux transactionnel).
- Génération de prestations : un ajustement 08:00–16:30 sur un jour contractuel
  09:00–16:30 produit +60 min de complément ; un ajustement 10:00–15:00 sur 09:00–17:00
  avec préavis suffisant produit 180 min de déduction ; le même sans préavis ni
  certificat produit 0 déduction ; extension + réduction simultanées se cumulent
  correctement. Chaque cas = un test unitaire domaine.
- Erreurs domaine pour : jour non gardé, double saisie même date. Tests dédiés.
- `GET …/besoins` (BFF) expose `ajustements` ; le diff de validation les inclut dans
  `deltaModifs` ; le brouillon établissement affiche la présence réelle.
- Pacts régénérés à blanc, provider verifications vertes, `can-i-deploy` inchangé
  (champs optionnels uniquement).

### Comment vérifier

```
corepack pnpm@10.34.2 nx run-many -t lint typecheck test -p planification-domain shared-semaine svc-planification api-gateway svc-notifications
corepack pnpm@10.34.2 nx run-many -t pact -p api-gateway svc-planification svc-notifications  # vérifier les noms de targets
```

Preuve bout-en-bout (stack locale) : écrire une semaine avec un ajustement via l'API,
relire `GET /api/prestations?...` et constater le complément/la déduction attendus, puis
`GET …/besoins` et constater la catégorie restituée.

### Pièges connus

- `CATEGORIES_DATEES` est un tuple `as const` typé — l'ajout change le type
  `CategorieDatee` : recompiler `shared-semaine` avant les projets consommateurs
  (`nx run-many -t build -p shared-semaine contracts-kernel`).
- La forme canonique de la fusion omet les catégories vides (jamais `[]`) — ne pas
  casser cette propriété (tests d'oracle `fusion-semaine.spec.ts`).
- Ne PAS toucher à la forme des prestations générées (contrat implicite avec
  svc-tarification via `GET /api/prestations`).

---

## Lot 2b — UX : saisir les heures réelles, l'app déduit l'état

**Modèle d'exécution : Opus 4.8** (expérience parent, cas limites).

### Objectif

Avant : « Absence » / « Jour ajouté » + fenêtre d'absence à calculer de tête ; le dépôt
en avance est impossible. Après : sur un jour gardé, le parent saisit l'arrivée et le
départ réels (préremplis avec les horaires du contrat), l'app annonce l'état déduit et
son effet (facturation, déduction) avant confirmation.

### Périmètre exact

- `apps/web/src/notifications/EditeurContratSemaine.tsx` (+ `.test.tsx`) : modale crèche
  - résumé jour
- `apps/web/src/notifications/besoinsSemaine.ts` (+ `.test.ts`) : état d'édition
- `apps/web/src/types/bff.ts` : `AjustementJour`, `SaisieJourBesoins.ajustements`
- `apps/web/src/planning/etatJourGarde.ts` (+ test) : nouvelle fonction pure
  `classerAjustement`
- `apps/web/src/planning/heures.ts` : réutiliser (rien à y changer a priori)
- `apps/web/src/dashboard/DashboardJourPage.tsx` (+ test) : refléter l'ajustement du jour
- `apps/web/src/planning/CalendrierCreche.tsx` uniquement si le calendrier mensuel
  affiche les saisies datées (vérifier) : afficher les ajustements comme le fait le résumé

**Hors périmètre** : les modes CANTINE/PERISCOLAIRE/ALSH (A1), la navigation
inter-semaines (A6), tout backend (fait en 2a).

### Décisions déjà prises

1. **Modale, jour gardé (CRECHE_PSU)** — remplace le radio « Absence »/« Jour ajouté » :
   - Champs « Heure d'arrivée » / « Heure de départ » (`<input type="time">`, existant),
     **préremplis avec la plage du contrat du jour** (`semaineType[jour]`, première
     plage) ; s'il existe déjà une saisie (ajustement ou absence), préremplir avec elle.
   - Case à cocher « Absent toute la journée » : masque les champs d'heures ; écrit une
     **absence** couvrant exactement la plage du contrat (mécanique existante), avec les
     questions préavis/certificat existantes.
   - **Ligne d'état déduite**, mise à jour en direct sous les champs (`aria-live="polite"`),
     textes exacts (durées au format « 1 h », « 1 h 30 », « 45 min ») :
     - extension seule : `« {durée} de plus que les horaires habituels ({HH:MM}–{HH:MM}) — facturé en complément. »`
     - réduction seule : `« {durée} de moins que les horaires habituels ({HH:MM}–{HH:MM}). »`
       - affichage des champs « Signalée combien de jours à l'avance ? » et
         « Certificat médical » (libellés existants).
     - mixte : `« Horaires ajustés ({HH:MM}–{HH:MM} habituellement) : {durée} en plus (facturés en complément), {durée} en moins. »` + champs préavis/certificat.
     - identique au contrat : `« Horaires habituels — rien à enregistrer. »` ;
       « Confirmer » supprime alors la saisie existante du jour s'il y en avait une.
   - Écriture : une entrée `ajustements` `{date, plage réelle, preavisJours, certificatMaladie}`
     (préavis/certificat à 0/false si extension pure).
2. **Modale, jour non gardé** : plus de radio non plus — c'est implicitement un
   « Jour ajouté » (heures par défaut 09:00/16:30 existantes, mécanique inchangée).
3. **Compat descendante** : les absences partielles historiques restent lisibles —
   `classerAbsence` est conservé pour l'affichage des données existantes ; on ne migre
   aucune donnée.
4. **`classerAjustement(plageReelle, plageContrat)`** (nouvelle fonction pure dans
   `etatJourGarde.ts`, mêmes conventions que `classerAbsence`) → libellés :
   - arrivée réelle < contractuelle : « Arrivée avancée »
   - arrivée réelle > contractuelle : « Arrivée retardée »
   - départ réel < contractuel : « Départ avancé »
   - départ réel > contractuel : « Départ retardé »
   - deux effets simultanés : « Horaires ajustés »
   - `presence` = plage réelle formatée `HH:MM–HH:MM` (tiret demi-cadratin, comme l'existant).
5. **Résumé jour** (colonne 2 de la rangée) : `« Arrivée avancée 08:00–16:30 »` (libellé
   - plage réelle). Le badge « Enregistré à HH:MM » et le debounce 800 ms existants ne
     changent pas.
6. **Dashboard « ma journée »** : si un ajustement existe pour aujourd'hui, afficher le
   libellé `classerAjustement` + plage réelle au même endroit que l'état « Départ avancé »
   actuel (localiser la dérivation d'état du jour dans `DashboardJourPage.tsx` et
   l'étendre — même source de données BFF).

### Conventions à respecter

Transverses. Réutiliser `Modale`, `StatutSauvegarde`, `useAnnonce`, les classes
`.jour-*`, les tokens CSS existants (`--ambre` pour les états ajustés, cf. feature
« planning état ajusté »). Cibles tactiles ≥ 2.75 rem ; boutons empilés < 480 px
(patterns CSS déjà en place dans `styles.css`).

### Critères d'acceptation

- Sur un jour gardé 09:00–16:30 : saisir 08:00–16:30 affiche « 1 h de plus que les
  horaires habituels (09:00–16:30) — facturé en complément. », Confirmer enregistre, le
  résumé du jour affiche « Arrivée avancée 08:00–16:30 », le badge passe à « Enregistré
  à HH:MM ».
- Saisir 10:00–15:00 affiche la réduction + les champs préavis/certificat ; les valeurs
  saisies partent dans l'entrée `ajustements`.
- « Absent toute la journée » produit une absence pleine plage avec préavis/certificat
  (comportement d'aujourd'hui).
- Heures identiques au contrat : « rien à enregistrer », et Confirmer nettoie la saisie
  du jour.
- Jour non gardé : parcours « Jour ajouté » inchangé.
- Lecteur d'écran : l'état déduit est annoncé (aria-live), les inputs gardent leurs labels.
- Tests composants mis à jour + nouveaux cas ; `classerAjustement` testé unitairement
  (5 libellés + presence).
- Aucun scroll horizontal à 375 px ; la modale reste utilisable au pouce.

### Comment vérifier

```
corepack pnpm@10.34.2 nx run-many -t build -p contracts-kernel shared-semaine
corepack pnpm@10.34.2 nx run-many -t lint typecheck test -p web
```

Vérif visuelle sur stack locale + Vite (mémoire « Vérif UI locale ») : dérouler les cas
d'acceptation ci-dessus à 375 px ; vérifier l'effet coût sur l'écran Coûts (le complément
doit apparaître dans le mois — preuve bout-en-bout avec le lot 2a).

### Pièges connus

- `getByDisplayValue` n'existe pas dans Playwright (mémoire projet) — pour les e2e
  ultérieurs, prévoir des sélecteurs par rôle/label.
- Les specs e2e existantes assertent des libellés du planning : si un libellé visible
  change, mettre à jour `apps/web/e2e/*.stack.e2e.spec.ts` dans la même PR.
- `noUncheckedIndexedAccess` : `semaineType[jour]` est `PlageHoraire[] | undefined` —
  garder les gardes explicites.

---

## Lot 3 — Le mail du mardi part toujours (statut persisté + reprise)

**Modèle d'exécution : Opus 4.8** (découplage création/envoi, idempotence).

### Objectif

Avant : un échec SMTP au tick de création = rappel perdu à jamais, invisible. Après :
l'envoi du récap du mardi a un statut persisté par foyer/semaine, est retenté aux ticks
suivants jusqu'au début de la semaine cible, et un incident se diagnostique par requête
SQL/logs sans deviner.

### Périmètre exact

- `apps/svc-notifications/src/scheduler/scheduler.hebdo.ts` (+ `.spec.ts`)
- `apps/svc-notifications/src/database/schema.ts` + **migration
  `0014_envoi_recap_hebdo.sql`** (ou le prochain numéro libre après le lot 1)
- `docker/prometheus.yml` / config postgres-exporter : UNIQUEMENT si un pattern de
  requêtes custom sur les tables notifications existe déjà (le vérifier) — sinon ne rien
  ajouter (A7)

**Hors périmètre** : le contenu du mail (lots 1/4), l'envoi au service/établissement
(déjà statué et rejouable via `envoi_etablissement`), la création des notifications
in-app (dégradation propre existante conservée), tout verrou multi-réplica (A4).

### Décisions déjà prises

1. **Nouvelle table `envoi_recap_hebdo`** :
   ```sql
   CREATE TABLE envoi_recap_hebdo (
     foyer_id    uuid NOT NULL,
     semaine_iso varchar(8) NOT NULL,
     statut      varchar(16) NOT NULL,          -- 'A_ENVOYER' | 'ENVOYE' | 'DRY_RUN' | 'ECHEC'
     destinataires jsonb NOT NULL DEFAULT '[]', -- emails retenus au dernier essai
     message_id  varchar(998),
     erreur      text,
     envoye_le   timestamptz,
     cree_le     timestamptz NOT NULL DEFAULT now(),
     maj_le      timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (foyer_id, semaine_iso)
   );
   ```
2. **Découplage en deux phases dans le scheduler** (même service, même tick) :
   - _Phase création_ (inchangée sur le fond) : insertion des `notification_hebdo`
     (UNIQUE existant) + **upsert `onConflictDoNothing` d'une ligne `A_ENVOYER`** dans
     `envoi_recap_hebdo` pour chaque foyer concerné. L'insertion de la ligne d'envoi se
     fait dans la même transaction que les notifications du foyer si le code actuel est
     transactionnel par foyer ; sinon, immédiatement après (le no-op du conflit rend le
     rejeu sûr).
   - _Phase envoi_ : à **chaque tick dans la fenêtre** (du mardi 8h jusqu'au dimanche
     précédant la semaine cible), relire les lignes `statut IN ('A_ENVOYER','ECHEC')`
     de la semaine cible, reconstruire le récap depuis les données courantes
     (extraire l'actuel `envoyerRecapFoyer` en une fonction qui prend `(foyerId,
semaineIso)` et relit ce qu'il faut), tenter l'envoi, puis mettre à jour la ligne :
     `ENVOYE`/`DRY_RUN` (+ `message_id`, `envoye_le`, `destinataires`) ou `ECHEC`
     (+ `erreur`). Mise à jour par compare-and-set (`WHERE statut <> 'ENVOYE'`).
   - Un échec d'envoi d'un foyer ne doit **pas** interrompre les autres (try/catch par
     foyer, log WARN, statut ECHEC).
3. **Sémantique des statuts** : `DRY_RUN` = tentative aboutie en mode dry-run (ne sera
   pas retentée) ; `ECHEC` = exception mailer, retentée au tick suivant tant que la
   fenêtre est ouverte. Après la fenêtre : les `ECHEC` restent en base comme trace.
4. **Logs structurés** : une ligne INFO par tentative (`foyer`, `semaine`, `statut`,
   `nbDestinataires`, `dryRun`), une ligne WARN par échec avec le message d'erreur.
5. La création in-app et le jeton de désabonnement gardent leur logique actuelle
   (dégradation propre) — ils suivent la phase envoi (au premier envoi réussi seulement,
   pour ne pas dupliquer les in-app à chaque retry : déplacer l'appel
   `creerNotificationsInApp` derrière le succès du premier envoi, ou le protéger par le
   statut précédent `A_ENVOYER`).

### Conventions à respecter

Transverses. Suivre le style de la table `envoi_etablissement` existante (statuts,
naming) — la cohérence prime sur l'inventivité.

### Critères d'acceptation

- Mock mailer en échec au 1er tick puis en succès au 2e : la ligne passe
  `A_ENVOYER → ECHEC → ENVOYE`, le mail part exactement une fois, les in-app ne sont
  créées qu'une fois. Test `scheduler.hebdo.spec.ts`.
- Dry-run : statut `DRY_RUN`, pas de retry.
- Ligne `ENVOYE` : aucun renvoi aux ticks suivants (idempotence).
- Tick hors fenêtre : aucune tentative.
- Un foyer en échec n'empêche pas l'envoi des autres foyers du même tick.
- Migration additive appliquée ; rollback = `DROP TABLE` (le noter dans la PR).

### Comment vérifier

```
corepack pnpm@10.34.2 nx run-many -t lint typecheck test -p svc-notifications
```

Sur stack locale : `NOTIF_SCHEDULER_FORCER=1`, couper le conteneur SMTP de test (ou
pointer un port fermé), constater `ECHEC` en base, rétablir, constater `ENVOYE` au tick
suivant. Requête de diagnostic à documenter dans la PR :
`SELECT semaine_iso, statut, count(*) FROM envoi_recap_hebdo GROUP BY 1,2;`

### Pièges connus

- Ne pas casser l'idempotence existante de la _création_ (`notification_hebdo` UNIQUE +
  `onConflictDoNothing`) : la phase création doit rester rejouable à vide.
- Le mail reconstruit en phase envoi doit refléter les données **courantes** (un contrat
  supprimé entre-temps ne doit pas faire planter la reconstruction : foyer sans enfant
  concerné → marquer `ENVOYE` sans mail, log INFO, cas de test).
- `NOTIF_SCHEDULER_FORCER` test-only.
- Fuseau Europe/Paris pour la fenêtre (logique existante — la réutiliser, ne pas
  réimplémenter).

---

## Lot 4 — Langage parent : zéro jargon dans le parcours

**Modèle d'exécution : délégable à Sonnet 5** (décisions entièrement prises ci-dessous,
application mécanique). À exécuter APRÈS merge des lots 1 et 2b (mêmes fichiers).

### Objectif

Avant : « semaine 2026-W27 » dans le mail, « 2026-07-01 — modifiée » dans la relecture.
Après : « semaine du 6 au 12 juillet 2026 », « mardi 1 juillet — modifiée » — les mots
qu'un parent emploie.

### Périmètre exact

- `libs/shared/semaine/src/lib/` : **nouvelle fonction pure** `libelleSemaineFr`
  (+ test, + export dans `index.ts`)
- `apps/svc-notifications/src/email/templates/recapMardi.ts` (+ `.spec.ts`)
- `apps/svc-notifications/src/email/templates/brouillonService.ts` (+ `.spec.ts`) : sujet
- `apps/svc-notifications/src/inbox/inbox.message.ts` (+ tests)
- `apps/web/src/notifications/RelectureEnvoi.tsx` (+ `.test.tsx`)
- `apps/web/src/utils/dates.ts` : helper date longue si absent
- Les specs e2e/`*.test.tsx` qui assertent les anciens libellés

**Hors périmètre** : tout libellé hors du parcours « valider ma semaine » ; les URLs et
identifiants techniques (`semaineIso` reste `YYYY-Www` dans les liens et les API).

### Décisions déjà prises (libellés exacts)

1. `libelleSemaineFr(semaineIso)` → `« semaine du 6 au 12 juillet 2026 »`
   (jours via `joursDeLaSemaine` existant ; mois via `Intl.DateTimeFormat('fr-FR')` ;
   si les deux bornes sont sur le même mois : `« du 6 au 12 juillet 2026 »`, sinon
   `« du 29 juin au 5 juillet 2026 »` ; année de la borne de fin, toujours affichée — A8).
2. Sujet du mail du mardi : `« Valider le planning — semaine du 6 au 12 juillet 2026 »`.
   Corps : remplacer chaque occurrence de `YYYY-Www` par le libellé ; le texte du lien
   devient `« Valider le planning de la semaine du 6 au 12 juillet 2026 »`.
3. Sujet du récap établissement : `« Plannings modifiés — semaine du 6 au 12 juillet 2026 »`.
4. In-app : sujet `« Planning de la semaine du 6 au 12 juillet 2026 à valider »`, corps
   sur le même modèle que l'existant avec le libellé humain.
5. Relecture web : chaque jour du delta au format
   `Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })`
   → `« mardi 1 juillet — modifiée »` / `« mardi 1 juillet — journée retirée »`.
   Ajouter pour les jours ajustés (lot 2a/2b) : `« mardi 1 juillet — horaires ajustés »`.
6. Ne PAS toucher aux valeurs `semaineIso` transmises aux API, aux liens, ni aux clés.

### Conventions à respecter

Transverses. `libelleSemaineFr` : pure, sans horloge (l'année vient de la semaine, pas de
`new Date()`), style JSDoc FR des libs partagées.

### Critères d'acceptation

- Plus aucune chaîne `\d{4}-W\d{2}` visible dans : sujet/corps des deux mails, sujets/corps
  in-app, textes de la relecture d'envoi (vérifiable par grep sur les templates + tests).
- `libelleSemaineFr` testée : semaine intra-mois, semaine à cheval sur deux mois, semaine
  à cheval sur deux années (2026-W01).
- Tous les tests composants et e2e assertant les anciens libellés sont mis à jour et verts.

### Comment vérifier

```
corepack pnpm@10.34.2 nx run-many -t build -p shared-semaine
corepack pnpm@10.34.2 nx run-many -t lint typecheck test -p shared-semaine svc-notifications web
```

### Pièges connus

- `Intl` avec `timeZone` par défaut du serveur : formater à partir des dates ISO
  `YYYY-MM-DD` (pas d'heure) pour éviter tout décalage de fuseau.
- Les specs `apps/web/e2e/*.stack.e2e.spec.ts` assertent des libellés — les mettre à jour
  dans la même PR (piège récurrent du repo).
- L'idempotence de `envoi_etablissement` n'est PAS liée au sujet du mail — changer le
  sujet est sans risque, ne pas y toucher côté clé.

---

## Lot 5 — Filet e2e : le parcours n°1 sous surveillance

**Modèle d'exécution : Opus 4.8** (conception de tests, orchestration stack).
À exécuter après merge des lots 1, 2a, 2b (et idéalement 4 pour figer les libellés).

### Objectif

Le parcours complet — lien profond → éditeur ouvert → saisie d'heures réelles → état
déduit → validation → relecture → envoi (dry-run) — est couvert par une spec e2e stack
qui casse si un maillon régresse.

### Périmètre exact

- **Nouveau** `apps/web/e2e/validation-semaine.stack.e2e.spec.ts`
- `apps/web/e2e/support/` : helpers partagés (réutiliser `stack.ts` ; n'ajouter un helper
  que s'il sert au moins deux specs)

**Hors périmètre** : tests de charge, e2e des mails SMTP réels (dry-run seulement),
refonte des specs existantes.

### Décisions déjà prises

1. Une seule spec, scénario nominal complet (pas de matrice de cas — les cas limites sont
   couverts en unitaire par les lots 2a/2b) :
   - Seed stack + `NOTIF_SCHEDULER_FORCER=1` → notification hebdo créée.
   - Naviguer directement vers `/foyers/<id>/planning?semaine=<semaine notifiée>` →
     asserter l'éditeur ouvert sur la bonne semaine.
   - Ouvrir la modale d'un jour gardé, saisir une arrivée en avance (ex. 08:00 pour un
     contrat à 09:00), asserter la ligne d'état déduite (« … de plus que les horaires
     habituels … facturé en complément »), Confirmer.
   - Attendre le badge « Enregistré à » (filtrer `waitForResponse` par méthode **et**
     statut 204 — piège #171).
   - Valider → asserter « validée (avec modifications) » → relecture affichée →
     envoi (bandeau « Mode test » attendu sur la stack) → asserter « Test réussi… ».
   - Reload de la page → asserter que la saisie et le statut validé persistent
     (protection contre la régression de réhydratation, cf. garde `saisieServeurObsolete`).
2. Sélecteurs par rôle/label (`getByRole`, `getByLabel`) — pas de `getByDisplayValue`
   (absent de Playwright).

### Conventions à respecter

Transverses (e2e stack). Style des specs existantes
(`planning-saisie-complete.stack.e2e.spec.ts` est le modèle le plus proche).

### Critères d'acceptation

- La spec passe en local sur stack fraîche ET dans le job CI e2e-stack.
- Elle échoue si : la route du lien profond casse, l'éditeur ne s'auto-ouvre plus, la
  catégorie `ajustements` disparaît du BFF, la validation ou l'envoi dry-run casse.
- Durée raisonnable (< 2 min) et stable sous charge (pas de `waitForTimeout` nus ;
  attentes sur réponses/état visibles).

### Comment vérifier

```
corepack pnpm@10.34.2 nx show project web   # repérer le target e2e stack exact (ex. web:e2e-stack)
corepack pnpm@10.34.2 nx run web:<target-e2e-stack>
```

### Pièges connus

- L'orchestrateur e2e-stack est **destructif** (`down -v`) : ne pas le lancer sur une
  stack de dev en cours d'usage.
- `NOTIF_SCHEDULER_FORCER` test-only ; la stack e2e l'injecte via
  `docker-compose.override.yml` (pattern existant pour l'identité CF — s'en inspirer).
- Specs « saisie puis reload » fiabilisées en #171/#172 : réutiliser leurs helpers
  d'attente, ne pas réinventer.
- Flakiness connue du parcours Cantine en local : ne pas étendre la spec aux modes ABCM.
