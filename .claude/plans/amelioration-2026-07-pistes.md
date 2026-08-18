# Carte des pistes d'amélioration — juillet 2026

> **Statut au 2026-07-29** : carte de pistes (backlog PO) toujours **ACTIVE** — ce n'est pas un plan d'exécution, ne pas l'archiver. 12 pistes sur 23 sont couvertes depuis : chantier « Confiance & quotidien » 7/7 lots (#231→#237) **déployés prod `0.14.0` le 2026-07-29** ; chantier A « consolidation » (#258→#265 mergés, effet prod au prochain train) ; SFD 30 (#247, couvre C7). C3 partiellement couverte (#264) ; restent ouvertes : A2, A5, A6, B3, B4, B5, C4, C6, C8, D1. Détail dans le bloc « Révision » ci-dessous.

> **Livrable 1 de la mission « carte + plan »** — recherche divergente sur trois sources, à trier par le PO.
> Prod actuelle : `0.14.0` (2026-07-29, 15e train). Aucun code touché à l'écriture de la carte ; ce fichier est le seul écrit avec le futur plan.

## Révision 2026-07-29 — pistes couvertes depuis l'écriture de la carte

Chantier « Confiance & quotidien » (`.claude/plans/confiance-et-quotidien.md`, sélection PO du 2026-07-18, 7 lots mergés main, **déployés prod `0.14.0` le 2026-07-29**) :

- **B2** → lot 1, PR #232 (`94a89e4`) : `apps/web/src/ui/LigneIndisponible.tsx` remplace les disparitions silencieuses du dashboard.
- **B1** → lot 2, PR #231 (`5917255`) : endpoint lecture svc-notifications + BFF + `apps/web/src/notifications/SuiviEnvois.tsx`.
- **C1** → lot 3, PR #234 (`81d1608`) : id généré par la gateway + `onConflictDoNothing` (contrat + établissement).
- **C2** → lot 4, PR #235 (`c82e070`) : garde de monotonie `occurred_at` (migrations tarification 0004 + notifications 0018).
- **A1** → lot 5, PR #236 (`4f14b28`) : `apps/web/src/dashboard/ModaleAbsenceRapide.tsx`, read-modify-write du mois.
- **A3 + A4** → lot 6, PR #233 (`c3188d5`) : « Centre de loisirs », « Total du mois », aide du mode simulation, etc.
- **E1 + E2 + D2** → lot 7, PR #237 (`0bc7a8d`) : FullCalendar en `lazy` (chunk principal 387,91 Ko < 400), 4 PNG PWA (`apps/web/public/icons/`), scroll-padding focus.

Chantier A du plan consolidation (`.claude/plans/consolidation-ui-et-qualite.md`, 7 lots #258→#265 mergés main 2026-07-29 — **effet prod au prochain train de release**) :

- **C5** → lots A6, PR #263 (`e06bed7` : healthchecks compose sur les 5 svc-*) + A7, PR #265 (`9aee291` : readiness reflétant l'état des migrations + alerte Prometheus `MigrationsEnRetardPersistant`).
- **C3 — partiellement** → lot A5, PR #264 (`07fa175`) : fail-open `ScopeFoyerGuard` TRANCHÉ (conserver, runbook §5) + correctif des faux positifs routes `/moi/*` ; **restent** la bascule `INTERSERVICE_AUTHZ_ENFORCE=1` (geste user après ~1 sem de logs propres post-déploiement) et la promotion `contrat.enfant_id NOT NULL` (toujours ouverte).

SFD 30 « versionnement dates d'effet » (7/7 lots, déployée `0.14.0`) :

- **C7** → lot 2, PR #247 (`d87939d`) : chemin « brancher » choisi — `CoutService` lit la projection `grille_tarifaire` (repli REST sinon 503, zéro constante tarifaire dans le code). ⚠️ Correctif PK surrogate #257 (`9818302`) mergé mais **pas encore déployé** — nécessite un rejeu de projection en prod (≠ simple restart).

**Restent ouvertes** : A2 (planning mobile page-fleuve), A5 (onboarding), A6 (mode sombre — toujours aucun `prefers-color-scheme`), B3 (offline-écriture), B4 (push), B5 (export), C4 (hygiène événements), C6 (validation ingress), C8 (breaker par opération), D1 (contraste).

## Méthode (les trois sources)

1. **Code** : audits front (`apps/web/src`), backend (6 services + libs), docs/plans (28 docs, 6 ADR, 14 plans). Les dettes **déjà cadrées** (NOT NULL `enfant_id`, enforce inter-services, `grille_tarifaire`, DLQ notifications, multi-foyer) sont référencées, pas redécouvertes.
2. **App en marche** : stack Docker local + seed (`scripts/seed-demo.mjs --verify`, montants oracle reproduits), parcourue à 375×812 comme un parent : dashboard, planning + éditeur de validation hebdo, coûts, contrats, établissements, ma famille, création de famille, mon profil. **Test de panne réel** : `svc-tarification` arrêté → observation de la dégradation vécue.
3. **Externe** (sourcé dans chaque fiche concernée) : WCAG 2.2 / RGAA 5 (annoncé fin 2026), CNIL/RGPD données de mineurs, patterns d'apps comparables (Meeko, Kidizz, portails famille, Cozi/FamilyWall), pratiques e-mail/push 2026.

## Cadrage validé (étape 1)

- **Ambition** : outil pour ton foyer — polir l'usage réel ; l'acquisition passe au second plan.
- **Thème** : balayage 360°.
- **Contraintes** : rien d'interdit (migrations cassantes et dépendances possibles si justifiées).
- **Zones gelées** : aucune.

## Correction d'un faux positif d'audit

L'audit backend a d'abord conclu « isolation foyer jamais appliquée en prod ». C'est **faux** : `FOYER_AUTHZ_ENFORCE=1` est actif en prod depuis 2026-06-28 (posé dans `.env.server.enc`, capturé PR #84) — l'`AppartenanceGuard` de la gateway refuse réellement. Ce qui reste en observe-only, c'est la **défense en profondeur au niveau des services** (assertion HMAC + `ScopeFoyerGuard`, chantier Fondations lots 3-4), dont l'enforce est une action déjà planifiée (« après ~1 semaine de logs propres »). `GATEWAY_AUTH_DISABLED=1` est une décision tracée (gateway non joignable hors reverse-proxy, CF Access au bord) — pas une faille.

---

# Les pistes

Type : `existant` (améliorer l'existant) · `capacité` (nouvelle capacité) · `dette` (dette technique / archi).
Effort : S (≤1 PR simple) · M (1-3 PR) · L (chantier multi-lots). Risque : bas / moyen / haut.

## Axe A — Expérience & clarté (parent, mobile, une main)

### A1. Absence en 2 taps depuis « Aujourd'hui »

**✅ Couverte** — « Confiance & quotidien » lot 5, PR #236, déployé prod `0.14.0`.
**Type** : capacité · **Effort** : M · **Risque** : bas
**Problème** : déclarer une absence — LE geste imprévu du quotidien (enfant malade le matin) — exige aujourd'hui : Planning → onglet enfant → onglet mode → trouver le jour dans la grille → formulaire dense (4 radios + « Signalée combien de jours à l'avance ? » + « Certificat médical »). Observé en live à 375px : c'est le parcours le plus long de l'app pour le cas le plus pressé. Les apps crèche qui marchent vendent précisément « absence déclarée en quelques secondes » (Meeko, portails famille — cf. recherche externe).
**Proposition** : sur le dashboard, une action « Signaler une absence » (aujourd'hui/demain, par enfant) → confirmation en 1 écran, préremplie (WCAG 3.3.7 Redundant Entry : réutiliser les heures du contrat), qui écrit la même donnée que le formulaire complet.
**Bénéfice parent** : le geste de panique du matin passe de ~8 taps + scroll à 2-3 taps ; c'est aussi la vitrine de ce que l'app sait faire.
**Dépendances** : aucune (réutilise `classerAbsence`/PUT planning existants).

### A2. Restructurer la page Planning mobile (page-fleuve)

**Type** : existant · **Effort** : M/L · **Risque** : moyen
**Problème** : observé en live — à 375px, la page Planning empile : encart validation + sélecteur de mois + case simulation + onglets enfants + onglets modes + champ « Temps de garde en plus (minutes) » + légende (5 items) + phrase d'aide + grille FullCalendar 6 semaines + formulaire « Saisie en lot » + **liste clavier dupliquant tous les jours gardés** + panneau « Coût du mois » détaillé + 2 boutons d'export. C'est plusieurs milliers de pixels de scroll pour valider une semaine. La liste clavier duplique la grille (double surface à maintenir, doc `apps/web/src/planning/CalendrierCreche.tsx:852-1083`).
**Proposition** (à trancher au plan) : reléguer « Saisie en lot », « Temps de garde en plus » et le panneau coût derrière des disclosures repliées par défaut sur mobile ; ou scinder « valider ma semaine » (flux court) de « éditer mon mois » (flux expert). La grille navigable au clavier (au lieu de la liste jumelle) est l'option de fond.
**Bénéfice parent** : l'écran le plus utilisé redevient lisible en 3 secondes ; moins de code à maintenir si la duplication tombe.
**Dépendances** : répercuter tout libellé déplacé dans les specs e2e (`*.stack.e2e.spec.ts`) — piège connu du repo.

### A3. Finitions de langage et de lisibilité (lot balai)

**✅ Couverte** — « Confiance & quotidien » lot 6, PR #233, déployé prod `0.14.0`.
**Type** : existant · **Effort** : S · **Risque** : bas · **Délégable à Sonnet 5** (une fois les libellés tranchés)
**Problème** — cueillette live + code :

- « ALSH » brut dans les onglets de mode (`apps/web/src/utils/libelles.ts:13`) alors que le dashboard dit « Centre de loisirs (ALSH) » ;
- panneau coût du mois : « Mensualité **-412,20 €** » — signe négatif jamais expliqué, et les mêmes lignes sont répétées deux fois (bloc par contrat puis « Récapitulatif ») — observé en live, lisibilité faible ;
- « Chargement des brouillons… » (`RelectureEnvoi.tsx:422`) — mot interne ;
- « ⚠️ Sans e-mail, **cette crèche** ne recevra pas… » affiché sous « École ABCM » (le libellé ne s'accorde pas au type de lieu) ;
- « Famille 2 enfants — **tranche de revenus 3** » (page Contrats) — jargon barème ;
- double émoji « 🕒 ⏰ » dans l'avertissement de délai de l'éditeur hebdo ;
- vestige : champ `types` d'établissement toléré par le BFF mais plus édité (`EtablissementsPage.tsx:146`).
  **Bénéfice parent** : cohérence de ton ; l'app parle « parent » partout, pas seulement sur les écrans retouchés récemment.

### A4. Expliquer le « Mode simulation » là où il s'active

**✅ Couverte** — « Confiance & quotidien » lot 6, PR #233, déployé prod `0.14.0`.
**Type** : existant · **Effort** : S · **Risque** : bas
**Problème** : une case « Mode simulation » nue sur Planning et Coûts (observé live). Une seule phrase d'aide existe, uniquement sur Coûts (`CoutsAnnuelsPage.tsx:341`). Un parent ne sait ni ce que ça change, ni si ses saisies « comptent ».
**Proposition** : une ligne d'explication au moment de l'activation (+ bandeau persistant « Vous êtes en simulation — rien n'est envoyé ») et un état visuel distinct.
**Bénéfice parent** : lève un doute anxiogène (« est-ce que j'ai modifié le vrai planning ? »).

### A5. Onboarding guidé jusqu'au premier planning

**Type** : existant · **Effort** : M · **Risque** : bas
**Problème** : « Créer ma famille » (bon formulaire, observé live) débouche sur un foyer vide ; il faut ensuite trouver seul : Crèches & écoles → créer le lieu, Contrats → créer le contrat, Planning → saisir. Le chantier onboarding (#196) a orienté le dashboard vide, mais le fil complet reste éclaté en 4 pages.
**Proposition** : un fil « il vous reste 2 étapes » persistant (checklist) après création, jusqu'au premier planning saisi.
**Bénéfice** : surtout utile si un tiers (grand-parent, co-parent) rejoint un jour ; faible urgence en mono-foyer déjà installé — assumé comme piste de fond.

### A6. Mode sombre

**Type** : existant · **Effort** : S/M · **Risque** : bas
**Problème** : aucune variable dark dans `styles.css` alors que `theme-color` et le manifest PWA existent. Usage réel du soir (vérifier demain, valider le mardi soir) ; un écran blanc à 22h éblouit.
**Proposition** : `prefers-color-scheme: dark` sur les tokens existants (l'app est déjà tokenisée — bon terrain).
**Bénéfice parent** : confort réel pour un usage majoritairement vespéral ; c'est aussi un filet a11y (photophobie).

## Axe B — Confiance & fiabilité perçue

### B1. Statut d'envoi à la crèche, de bout en bout

**✅ Couverte** — « Confiance & quotidien » lot 2, PR #231, déployé prod `0.14.0`.
**Type** : existant · **Effort** : M · **Risque** : bas
**Problème** : le moment le plus engageant de l'app — « le récap est-il parti à la crèche ? » — n'a pas de trace consultable côté parent. La donnée existe pourtant en base (`envoi_recap_hebdo` avec statuts, ledger `envoi_recap_parent`, état `ABANDONNE` anti-perte). Le pattern « Enregistré à HH:MM » (`StatutSauvegarde`) existe déjà pour la saisie. Recherche externe : la confiance vient de 3 clartés — état de mes données, état du système, « que se passe-t-il ensuite » (et pour une action engageante : confirmation serveur explicite, jamais d'optimistic UI).
**Proposition** : après validation « avec modifications », afficher la chaîne réelle : « Envoyé à Crèche Les Hirondelles le mar. 21/07 à 9:02 » / « Échec — nouvelle tentative prévue » / « Abandonné — contactez la crèche », alimentée par `envoi_recap_hebdo` exposé via le BFF ; + un mini-historique des envois de la semaine dans l'éditeur hebdo.
**Bénéfice parent** : supprime LE doute anxiogène (« est-ce que ma validation est partie ? ») ; rentabilise un backend déjà solide en le rendant visible.
**Dépendances** : nouvel endpoint BFF → contrat Pact + `can-i-deploy`.

### B2. En finir avec les échecs silencieux du dashboard

**✅ Couverte** — « Confiance & quotidien » lot 1, PR #232, déployé prod `0.14.0`.
**Type** : existant · **Effort** : S · **Risque** : bas
**Problème** : **observé en live** — `svc-tarification` arrêté, le bandeau « Coût de juillet 851,16 € » disparaît du dashboard sans aucune trace (design assumé « ne jamais bloquer la journée », `DashboardJourPage.tsx:194-211` : `null` en chargement **et** en erreur ; idem `SectionDemain`, `ProchaineGarde`, accusé de lecture cloche avalé `ClocheNotifications.tsx:42`). La page Coûts, elle, affiche proprement « Service indisponible, réessayez dans un instant » + Réessayer (observé). Un parent qui ne voit plus son coût du mois ne sait pas s'il a disparu ou s'il n'a jamais existé.
**Proposition** : garder l'anti-layout-shift, mais remplacer le `null` d'erreur par un état discret « Coût du mois indisponible · recharger » (une ligne, même hauteur). Ne pas toucher au `null` de chargement.
**Bénéfice parent** : l'app ne « ment » plus par omission ; cohérence avec le reste des états d'erreur, déjà exemplaires.

### B3. File d'attente hors-ligne pour les saisies (PWA offline-écriture)

**Type** : capacité · **Effort** : M/L · **Risque** : moyen
**Problème** : la PWA lit déjà hors-ligne (`NetworkFirst` sur les GET, bannière hors-ligne honnête) mais toute écriture hors réseau est refusée : « Vous êtes hors-ligne. Reconnectez-vous pour enregistrer vos changements. » Cas réel : couloir de crèche en zone blanche, le parent saisit l'absence… et doit y repenser plus tard. Contrainte externe : Background Sync API absente de Safari → file applicative maison obligatoire (IndexedDB + rejeu au `online`/focus), pas l'API native (MDN).
**Proposition** : file locale des PUT de saisie (déjà idempotents via `requeteIdempotente` + garde de séquence `saisieServeurObsolete`), rejouée au retour réseau, avec statut visible « En attente de réseau (1 modification) ».
**Bénéfice parent** : « je l'ai saisi, c'est réglé » devient vrai partout ; prolonge naturellement B1/B2.
**Dépendances** : s'appuie sur la garde anti-clobber existante (PR #172) ; à tester finement (conflits multi-onglets).

### B4. Rappel du mardi en push (PWA installée)

**Type** : capacité · **Effort** : L · **Risque** : moyen
**Problème** : le rappel hebdo n'existe qu'en e-mail + cloche in-app. Externe : web push supporté sur iOS ≥16.4 **si** l'app est installée à l'écran d'accueil (`display: standalone` — déjà en place) ; abonnements iOS parfois silencieusement morts → le push doit **compléter** l'e-mail, jamais le remplacer. Le modèle prévoyait déjà `parent.id` comme futur propriétaire d'abonnement (plan parents-foyer).
**Proposition** : abonnement push opt-in depuis Mon profil (canal « application » de la matrice type×canal existante), envoi par svc-notifications au même moment que l'e-mail.
**Bénéfice parent** : le rappel arrive là où le parent vit (téléphone), le mardi soir.
**Dépendances** : icônes PWA correctes (PNG 192/512 — il n'y a qu'un SVG, dégrade l'installation iOS), clés VAPID (nouveau secret), table d'abonnements (migration additive), préférences déjà modélisées. Pari : à ne lancer qu'après installation réelle de la PWA par les 2 parents.

### B5. Export des données du foyer (portabilité)

**Type** : capacité · **Effort** : M · **Risque** : bas
**Problème** : aucune sortie de secours des données — le reproche n°1 fait à Cozi (« données captives, pas d'export », Trustpilot 2,1★). RGPD : usage mono-foyer = exemption domestique art. 2(2)(c), donc **aucune obligation** — mais l'export JSON/CSV est la version minimale de la portabilité si l'app s'ouvre un jour, et une assurance-vie si le serveur meurt (les sauvegardes sops/systemd existent côté ops, mais rien côté parent).
**Proposition** : « Télécharger mes données » dans Mon profil : JSON complet (foyer, enfants, contrats, plannings, historique d'envois) + CSV des plannings. Les exports CSV/PDF du coût existent déjà — étendre le pattern.
**Bénéfice** : sérénité ; posture RGPD propre documentée dans l'app (page « Vos données »).

## Axe C — Robustesse backend & architecture

### C1. Écritures rejouées sans idempotence : le doublon de contrat

**✅ Couverte** — « Confiance & quotidien » lot 3, PR #234, déployé prod `0.14.0`.
**Type** : dette · **Effort** : M · **Risque** : bas
**Problème** : `executerResilient` retente **tous** les verbes (libs/resilience/src/lib/resilience.ts:125), y compris POST. `creerContrat` (gateway → planification, timeout 2 s, `retries: 1`) avec id généré **côté serveur** et **aucune contrainte d'unicité métier** sur `contrat` : une réponse lente > 2 s → abort → retry → **deux contrats identiques**, deux flux `ContratCree`, visibles par le parent. Variante moins grave : `creerEtablissement` retombe sur `UNIQUE(foyer_id, nom)` → 409 « déjà modifié » alors que la création a réussi (faux échec observé dans le mapping `relais.ts`).
**Proposition** : id de contrat généré côté client (UUID dans le corps, upsert idempotent) **ou** en-tête `Idempotency-Key` persisté ; et ne retenter les verbes non idempotents que sur erreur réseau avant émission.
**Bénéfice parent** : plus de doublon fantôme à supprimer, plus de faux « Conflit » après un clic sur 4G. C'est le backend qui « finit par se voir ».

### C2. Projections sans garde de monotonie (désordre d'événements)

**✅ Couverte** — « Confiance & quotidien » lot 4, PR #235 (migrations tarif 0004 + notif 0018), déployé prod `0.14.0`.
**Type** : dette · **Effort** : S/M · **Risque** : bas
**Problème** : les upserts de projection (`svc-tarification/src/consumers/projection.service.ts:163,233` — `FoyerMisAJour`, `GrillePubliee` ; idem côté notif) sont inconditionnels : `occurredAt` est stocké mais jamais comparé. Un événement ancien re-livré après un récent (NAK + backoff JetStream) **écrase l'état récent** → tarification calculée sur des revenus périmés, silencieusement. `processed_event` ne protège que contre le rejeu du même id.
**Proposition** : clause `WHERE excluded.occurred_at > …` (ou comparaison en SQL dans le `set`) sur toutes les projections d'état ; test unitaire de désordre par consommateur.
**Bénéfice** : un invariant simple qui ferme une classe entière de corruptions invisibles.

### C3. Terminer le chantier Fondations (enforce + fail-open + NOT NULL)

**🟡 Partiellement couverte** — consolidation lot A5, PR #264 (fail-open `ScopeFoyerGuard` tranché « conserver » + fix `/moi/*`) ; restent bascule `INTERSERVICE_AUTHZ_ENFORCE=1` (geste user) et NOT NULL `enfant_id`.
**Type** : dette · **Effort** : S (décisions + ops) · **Risque** : moyen (le seul risque : verrouiller un vrai flux)
**Problème** : trois restes déjà cadrés, à ne pas laisser moisir : (1) bascule `INTERSERVICE_AUTHZ_ENFORCE=1` après la semaine de logs observe (démarrée au train 0.13.0 du 2026-07-18) ; (2) décision PO sur le fail-open `ScopeFoyerGuard` (référence de scope absente → passe — en enforce, une route mal annotée devient un trou silencieux, `scope-foyer.guard.ts:105-140`) ; (3) promotion `contrat.enfant_id NOT NULL` jamais faite (back-fill prod déjà exécuté 0 NULL/8) — tant qu'elle traîne, un contrat orphelin échappe au rafraîchissement du prénom (`projection.service.ts:127`) et le récap peut afficher un ancien prénom.
**Proposition** : un lot « clôture » : migration NOT NULL + FK là où pertinent, bascule enforce planifiée, et fail-open transformé en fail-closed avec liste d'exceptions explicite.
**Bénéfice** : la défense en profondeur devient réelle au lieu de nominale ; les invariants « mous » disparaissent.

### C4. Hygiène du flux d'événements : `filter_subjects` + rétention

**✅ Couverte, sauf le rejeu** — `filter_subjects` par consommateur durable au lot 3 de
« le coût ne ment plus » (`AM-53`, dérivé de `ProjectionPort.typesGeres`, porte
`pnpm abonnements` + relevé `dead_letter` dans `e2e-stack`) ; purge TTL au lot 2b des
standards (`PurgeModule` : `outbox` 30 j, `dead_letter` 90 j) ; volumétrie par
`consumer_rejets_total` et, côté outbox, `outbox_attente_age_secondes` (`AM-61`).
L'alerte `ConsumerRejetsDetectes` **n'exclut plus** `TYPE_INCONNU`. **Reste ouvert** : le
script de réinjection ciblée depuis `dead_letter` (reprise toujours manuelle) — et noter
que la purge des rebuts les rend alors définitivement irréparables au bout de 90 j.

**Type** : dette · **Effort** : S/M · **Risque** : bas
**Problème** : les consommateurs JetStream ne filtrent pas les sujets (`libs/nest-commons/src/lib/messaging/jetstream-consumer.ts:141`) : svc-notifications reçoit tout le stream FOYER et met en `dead_letter` chaque `EnfantAjouté`/`FoyerMisAJour` normal (`IGNORE_TYPE_INCONNU`) — bruit connu (baseline « voulu » du dernier deploy), mais la table **grossit sans borne**, noie les vrais poison messages, et l'alerte doit exclure `TYPE_INCONNU` pour rester utilisable. Aucune purge de `processed_event`/`dead_letter`, aucun rejeu outillé depuis `dead_letter` (reprise manuelle).
**Proposition** : `filter_subjects` par consommateur ; job de purge TTL (`processed_event` > 90 j, `dead_letter` traitées) ; métrique de volumétrie ; script de réinjection ciblée.
**Bénéfice** : le signal « dead letter » redevient une alarme et non un bruit de fond ; exploitable à 22h.

### C5. Filets prod : readiness honnête + healthchecks compose

**✅ Couverte** — consolidation lots A6 (PR #263, healthchecks compose 5 svc-*) + A7 (PR #265, readiness = migrations appliquées + alerte Prometheus) ; mergés main, effet prod au prochain train.
**Type** : dette · **Effort** : S · **Risque** : bas
**Problème** : si les migrations échouent au boot, le service démarre quand même (retry en fond, `migration.service.ts:35`) et répond `ready` → l'orchestrateur route du trafic vers un schéma incomplet, en servant des 500 — invisible des healthchecks. Et AQ-15 (doc 27) reste ouvert : pas de healthcheck compose sur les 5 apps. S'ajoute un angle mort connexe : le scheduler du mardi n'a qu'une garde de réentrance intra-process — inoffensif à 1 réplica, double e-mail possible si on scale un jour (à verrouiller par advisory lock le jour venu, documenté suffit aujourd'hui).
**Proposition** : readiness = DB + NATS + migrations appliquées ; healthchecks compose alignés ; note d'architecture « mono-réplica requis » sur le scheduler.
**Bénéfice** : une panne à 22h se voit dans `docker compose ps` au lieu de se déguiser en 500 aléatoires.

### C6. Valider le corps de planning à l'ingress gateway

**Type** : dette · **Effort** : S/M · **Risque** : bas
**Problème** : `ecrirePlanningSchema = z.object({}).passthrough()` (`apps/api-gateway/src/bff/bff.dto.ts:103`) : le corps le plus sensible de l'app (la saisie du parent) traverse la gateway sans validation, dépendant entièrement de svc-planification. Pas de pipe global à l'ingress.
**Proposition** : schéma Zod réel à la frontière BFF (réutiliser les types de `contracts-planification`), erreurs 400 homogènes.
**Bénéfice** : messages d'erreur plus précis côté parent, surface d'attaque réduite, symétrie avec le reste des DTO déjà stricts.

### C7. Grille tarifaire : brancher ou débrancher (trancher la dette)

**✅ Couverte** — SFD 30 lot 2, PR #247 (« brancher » : `CoutService` lit la projection, repli REST), déployé `0.14.0` ; ⚠️ correctif PK #257 mergé PAS déployé (rejeu projection prod requis).
**Type** : dette · **Effort** : S (débrancher) ou M (brancher) · **Risque** : bas
**Problème** : dette majeure déjà documentée (plan qualité-couts §46-48) : `svc-tarification` projette `GrillePubliee.v1` dans une table `grille_tarifaire`… que `CoutService` ne lit jamais (valorisation sur grilles statiques du domaine). Publier une grille ne change aucun montant : l'architecture ment.
**Proposition** : décision à prendre dans le plan — soit lire la table projetée (chemin « vrai référentiel »), soit supprimer projection + table + événement (chemin « assumer le statique »). Le statu quo est le seul mauvais choix.
**Bénéfice** : cohérence intention/implémentation ; moins de code mort trompeur pour le développeur de dans 6 mois.

### C8. Circuit breaker par opération (pas par service)

**Type** : dette · **Effort** : S/M · **Risque** : bas
**Problème** : un breaker unique par client (`planification.client.ts:146`) : un seul endpoint lent (ex. `prestations`) ouvre le circuit et fait échouer **lecture et écriture** pendant 10 s — observé indirectement en live : la panne tarification a rendu tout « Coûts » indisponible, dashboard compris.
**Proposition** : breaker par (service, opération) ou au minimum lecture/écriture séparées.
**Bénéfice** : une lenteur localisée ne prive plus le parent d'écrans sains.

## Axe D — Accessibilité & inclusion

### D1. Audit contraste + tailles de texte du planning

**Type** : existant · **Effort** : S · **Risque** : bas · **Délégable à Sonnet 5** (après décision des valeurs)
**Problème** : `--gris #4b5563` porte un commentaire « doit tenir AA aussi sur `--gris-clair` » (`styles.css:6-8`) — à re-vérifier, `.muted` est massivement utilisé pour des infos importantes (états, dates). Styles inline du planning en `0.8-0.82rem` (~13px) — petits pour du contenu utile. Le socle est bon (focus visible 3px, `min-height:44px` généralisé, tabs ARIA complets, annonces de route — phase a11y sérieuse déjà faite) : il s'agit de finir, pas de refaire.
**Référence externe** : WCAG 2.2 AA (2.5.8 : cibles ≥24px — OK ici ; 1.4.3 contraste) ; RGAA 5 intégrant WCAG 2.2 annoncé fin 2026 — être prêt avant.

### D2. Focus non masqué par les barres fixes (WCAG 2.4.11)

**✅ Couverte** — « Confiance & quotidien » lot 7, PR #237 (scroll-padding-bottom ajusté), déployé prod `0.14.0`.
**Type** : existant · **Effort** : S · **Risque** : bas
**Problème** : la barre d'onglets **fixe en bas** sur mobile (`.nav-onglets`) est exactement le cas d'école du nouveau critère 2.4.11 (Focus Not Obscured) : en tabulation, un élément focusé en bas de page peut se retrouver sous la barre. À vérifier (scroll-padding) et corriger (`scroll-margin-bottom` / `scroll-padding-bottom` globaux).
**Bénéfice** : conformité 2.2 anticipée, navigation clavier sans zone morte.

## Axe E — Performance

### E1. Code-splitting : sortir FullCalendar du bundle initial

**✅ Couverte** — « Confiance & quotidien » lot 7, PR #237 (FullCalendar en `lazy`, chunk principal 387,91 Ko < 400), déployé prod `0.14.0`.
**Type** : existant · **Effort** : S/M · **Risque** : bas
**Problème** : **mesuré en live** : un seul JS de 647 Ko (non compressé ; Caddy gzippe en prod, mais ~180 Ko gzip restent lourds pour la 4G). Zéro `React.lazy` (AQ-18 « acceptable à 5 écrans » — mais) : les **5 paquets FullCalendar** sont chargés même pour ouvrir le dashboard qui n'en a pas besoin. Le premier écran du matin paie le calendrier qu'il n'affiche pas.
**Proposition** : `React.lazy` sur les 2 composants calendrier (pas besoin de router-level splitting), fallback = squelette existant.
**Bénéfice parent** : premier contenu utile plus rapide sur 4G ; clôt AQ-18 proprement.

### E2. Icônes PWA de repli (PNG 192/512)

**✅ Couverte** — « Confiance & quotidien » lot 7, PR #237 (4 PNG dans `apps/web/public/icons/`), déployé prod `0.14.0`.
**Type** : existant · **Effort** : S · **Risque** : bas · **Délégable à Sonnet 5**
**Problème** : une seule icône SVG dans le manifest — installation/splash dégradées sur iOS et anciens Android. Prérequis de B4 (push), utile seul.

---

# Priorisation

## Vue impact × effort

|                                | **Effort S**                                                        | **Effort M**                                                                   | **Effort L**                                            |
| ------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **Impact fort (parent)**       | B2 échecs silencieux · E1 code-splitting · A4 simulation            | **A1 absence 2 taps** · **B1 statut d'envoi** · C1 idempotence · B5 export     | B3 offline-écriture · B4 push · A2 planning restructuré |
| **Impact moyen**               | A3 lot balai · D1 contraste · D2 focus · C5 filets prod · E2 icônes | C4 hygiène événements · C6 validation ingress · A6 mode sombre · A5 onboarding | —                                                       |
| **Impact différé (assurance)** | C3 clôture fondations (décisions)                                   | C2 monotonie · C7 grille · C8 breaker                                          | —                                                       |

**Quick wins** (S, impact immédiat) : B2, E1, A4, A3, D2.
**Paris structurants** : A2 (refonte de l'écran central), B3+B4 (PWA de plein exercice), et la grande absente ci-dessous.

## Le pari écarté-mais-noté : facturation réelle + crédit d'impôt

Un plan complet existe déjà (`.claude/plans/factures-reelles.md`) : rapprocher les factures réelles du prévisionnel + estimer le crédit d'impôt frais de garde. C'est la seule « grande » capacité déjà spécifiée et jamais bâtie (backlog v1, spec 01). Je ne la re-fiche pas — elle est prête à être choisie telle quelle si le thème « argent » te motive plus que « confiance ». Effort L, risque moyen.

## Mes recommandations (dans l'ordre)

1. **B1 + B2 — « la confiance rendue visible »** (M). Le backend d'envoi est déjà robuste (slots, ledger, ABANDONNE) mais invisible ; et le dashboard sait se taire sur ses pannes (prouvé en live). Rendre l'état d'envoi consultable et bannir les disparitions silencieuses attaque directement la question qui définit l'app : « est-ce que ma validation est partie ? ». Meilleur ratio impact/effort de la carte.
2. **C1 + C2 — « les écritures qui ne mentent jamais »** (M). Doublon de contrat au retry et écrasement par événement désordonné sont les deux seules failles trouvées qui **corrompent des données** sans bruit. Petites PR, valeur d'assurance énorme, et C2 est un pattern à poser une fois pour toutes.
3. **A1 — absence en 2 taps** (M). Le plus gros gain d'usage quotidien pour ton foyer, aligné sur le standard du marché, sans migration.
4. **Lot poli : A3 + A4 + E1 + D2 + E2** (S×5, largement délégable). Une PR-train de finitions qui se voit immédiatement.
5. **C3 — clôture Fondations** (S, surtout des décisions). À caler dès que la semaine de logs observe est propre — c'est du « déjà payé » qu'il ne faut pas laisser périmer.

## Pistes écartées (et pourquoi)

- **Multi-foyer riche / sélecteur de familles** : contraire au cadrage « outil pour mon foyer » ; le mono-foyer est une décision de spec (doc 01).
- **Messagerie / photos / transmissions type Meeko** : la crèche n'utilise pas l'app — tout canal bidirectionnel est mort-né ; le mail sortant reste le bon média.
- **Rate-limit distribué, multi-réplica, verrou de migration concurrent** : sur-ingénierie à l'échelle d'un foyer et d'une instance ; documenté dans C5 comme contrainte, pas construit.
- **Recherche/filtres/tri des listes** : 4 contrats, 3 établissements — aucune liste n'atteint la taille où ça compte.
- **AsyncAPI par contexte, rétention JetStream documentée (AQ-14)** : dette documentaire réelle mais sans effet parent ni risque court terme ; à glisser dans un lot C4 si choisi, pas en piste autonome.
- **Refonte du formulaire « Saisie en lot »** en assistant pas-à-pas : traité indirectement par A1 (le cas fréquent sort du formulaire) et A2 (le formulaire se replie) — une 3e attaque serait redondante.
- **Registre RGPD/AIPD formels** : exemption domestique art. 2(2)(c) — la bureaucratie n'apporte rien ; B5 (export) + une page « Vos données » couvrent l'esprit.

## Hypothèses assumées (à corriger si faux)

- H1 : la prod reste **mono-réplica** par service — les risques multi-réplica (double e-mail, course de migration) sont documentés, pas corrigés.
- H2 : la cloche absente et « Mon profil → Accès non autorisé » observés en local sont **environnementaux** (pas d'identité CF locale), pas des bugs prod.
- H3 : le registre d'anomalies est partiellement périmé (AN-12 « édition de contrat absente » — or Modifier/Supprimer existent, observés en live) ; je n'en fais pas une piste, juste une note d'hygiène.
- H4 : l'e-mail reste le canal de vérité des notifications ; le push (B4) ne serait qu'un complément.
- H5 : le stack Docker local monté pour l'observation reste up ; je ne l'ai pas démonté (dis-moi si tu veux un `docker compose down`).
