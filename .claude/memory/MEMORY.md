# Index de la mémoire projet

> **Règle de cet index — une entrée = 2 lignes maximum** : le sujet, l'état courant, le
> lien vers la fiche. Le journal détaillé (sessions, décisions, chiffres, pièges datés)
> vit dans la **fiche**, jamais ici : cet index est lu à chaque début de session, chaque
> ligne superflue y est payée à chaque session. Quand un chantier se clôt, replier son
> historique dans sa fiche et descendre l'entrée en « Archives ». Les **pistes et
> leçons** de lot ne s'écrivent plus ici : elles vont au registre (doc 34, `/consigner`).

- [Registre d'améliorations (doc 34)](../../docs/34-registre-ameliorations.md) — **où atterrissent désormais les pistes et les leçons** trouvées en cours de lot (`AM-xx`/`LE-xx`/motifs `MO-x`), avec l'inventaire des portes et leur périmètre déclaré ; porte `pnpm registre` (step bloquant du job `ci`), commandes `/consigner` et `/revue-processus`.
- **Empêchements d'outillage (`EM-xx`, doc 34 §6, ouvert le 2026-08-12)** — une friction d'**atelier** qui a changé le livrable ; filtre en §1.5 (livrable changé + se reproduira + remède concevable), `EM` vs `AM` se tranche sur le remède (atelier ou produit). La liste « Encore réels » de `CONTRIBUTING.md` y est adossée piège par piège, gardée par `pnpm empechements` : **elle ne peut plus s'allonger sans mettre un remède en file**. Se consigne à l'**ouverture de la PR**, jamais au merge.

## Chantiers actifs

- [Calendriers & vacances scolaires (SFD 31)](chantier-calendriers-vacances.md) — chantier **LANCÉ le 2026-08-19** (5 lots) ; **lot 1 livré, non mergé** : le domaine calendrier versionné + `joursFeries` — l'**ancre de connaissance est tranchée** (instant de facturation du mois, pas de création du planning).
  ⚠️ Borne de connaissance **exclusive** vs `au` métier **inclusif** ; unicités **partielles** imposées au lot 2 ; migration du lot 2 = **`0010`**, pas `0009` (relevé du plan périmé).
- [Le coût ne ment plus](chantier-cout-ne-ment-plus.md) — **chantier COMPLET : lots 1 (`c1086f7`), 2 (`5516e00`) et 3 (`9b94764`) MERGÉS le 2026-08-17, AUCUN DÉPLOYÉ** (train visé ~23/08, avec le lot 9 des standards). Le coût d’un mois non couvert refuse (422) ; le récap ne part plus pour rien et le consentement est écrit ; les 7 durables JetStream ne reçoivent plus que ce qu’ils traitent, et l’outbox date son blocage.
  ⚠️ Le relevé `dead_letter` se juge **APRÈS** le train (le filtre n’est posé qu’au redémarrage) ; retirer un blocage autorise un **réordonnancement** qu’un effacement défait (`LE-77`) ; un correctif posé **à la création** est invisible à une CI qui part d’un `down -v` (`LE-76`, `EM-17`) ; restent `AM-88`, `AM-90`, `AM-98`, `AM-99`.
- [Vision plateforme du foyer (2026-08)](../plans/vision-plateforme-foyer-2026-08.md) — projection PO 2026-08-11 : vacances/impôts/voiture/courses/documents mappés sur SFD 31-33 + factures-réelles, pistes `AM-63`→`AM-65`, horizon domotique long terme (aucun chantier lancé).
- [Revue standards industriels 2026-08](revue-standards-2026-08.md) — plan `.claude/plans/plan-standards-industriels.md` ; **lots 0 → 7 mergés** (doc 37, effacement, bornes, portabilité, RFC 9457, validation d'environnement, piste d'audit acteur, sémantique HTTP) et **lot 8 mergé** (durcissement CIS des conteneurs, quarantaine npm) ; **`AM-82`/`AM-83` soldées et train `0.17.0` DÉPLOYÉ le 2026-08-15** (lots 6-8 enfin en prod ; 28/29 en `read_only`, plugin Grafana épinglé) — ⚠️ le déploiement a d'abord cassé la prod : un secret Compose `environment:` est **copié** dans le conteneur, donc incompatible avec une racine immuable, et le rollback rejouant le même compose n'est pas un filet (`LE-58`) ; portes `retentions` / `portabilite` / `problemes` / `environnement` / `acteur` / `conteneurs` / `quarantaine` ; prochain = **lot 9 WCAG 2.2 (`AM-49`)** — `AM-47` (SPF/DKIM/DMARC) reste ⏸ sur décision PO.

- [Travail à distance (vacances 08/2026)](travail-a-distance-vacances-2026-08.md) — runbook Tailscale+RDP, 2 routines cloud actives ; ⚠️ la mémoire du dépôt n'est qu'un **miroir** volontairement incomplet, à ne pas « resynchroniser » depuis une session distante.
- [Plan consolidation UI + qualité](plan-consolidation-ui-qualite.md) — **journal complet des sessions dans la fiche.** État 2026-08-07 : A ✅ 7/7 ; mergés NON DÉPLOYÉS = B3/B7, C5/C7, D1-D4/D6/D8 → prochain train de release ; restent B4/B5/B8, C6/C8/C9, D5/D7, chantier E ; gestes PO : merge #284 (verte), re-run `main` rouge du 06/08 (incident GitHub, pas une régression), rclone R2(a), bascule INTERSERVICE R3.
- [SFD 30→33 extension famille](plan-sfd-30-33-extension-famille.md) — SFD 30 exécutée → [[chantier-versionnement-dates-effet]] ; **SFD 31 VALIDÉE v1.0 (2026-08-16)** : calendrier versionné à date d'effet (D6 renversée), 4→5 lots, à démarrer après « Le coût ne ment plus » + FullCalendar 7.
  Ordre consolidation→31→32→33→factures ; reste validation PO des SFD 30/32/33 et de leurs hypothèses.
- [Plan fondations backend](plan-fondations-backend.md) — 6 lots ✅ prod `0.13.0` ; HMAC + scoping LIVE en OBSERVE-ONLY ; **semaine d’observation LUE le 2026-08-23 : propre, mais fenêtre presque vide (0 mutation) — reste la bascule, geste PO = R3, avec son préalable en `AM-79`** ; détail dans la fiche.
- [Veille alertes : outillage](veille-alertes-outillage.md) — lire la conclusion du workflow `veille-alertes.yml` (les alertes sont illisibles depuis une session distante) ; **actions PO : activer Dependabot alerts (Settings → Code security), dismisser CodeQL #12/#1** ; détail dans la fiche.

## Références & pièges toujours actifs

- [Faits prod](prod-deployment-facts.md) — `creche.testlens.dev` ▶ `0.15.0` (2026-08-01, 16e train) ; `deploy.mjs` = seule voie ; AUTH isolation foyer active ; pièges ops dans la fiche ; **reste : `trusted_proxies` côté Caddy** (rate-limit public encore par tunnel, `AM-32`).
- [Accès serveur prod](prod-server-access.md) — `ssh edouard@192.168.1.129` ; passer par `ssh.exe` Windows, pas Git Bash.
- [pnpm via corepack](pnpm-corepack-version.md) — toujours `corepack pnpm@10.34.2`, jamais le pnpm global 8.x.
- [Clone propre -public](repo-clean-clone-location.md) — bosser dans `-public`, jamais pousser depuis l'original ; main protégée, PR + check `ci`.
- [Conventions strictes](code-conventions-strict.md) — ESLint 9 flat config type-aware (ratchet warn→error), React layer au root, verbatimModuleSyntax web-only, branded types.
- [Piège CI non déclenchée par un push distant](piege-ci-non-declenchee-push-distant.md) — depuis une session distante, un `git push` sur une PR ne crée **aucun** run (échec silencieux : rien de rouge, mais le check requis n'existe pas) ; fermer/rouvrir la PR le déclenche.
- [Piège `prettier --check` local (CRLF)](piege-prettier-check-crlf.md) — échoue sur TOUS les .md/.json en local (autocrlf) ; juger sur `git diff`, jamais sur `--check`.
- [Piège SCA rouge sans diff](piege-sca-rouge-sans-diff.md) — `main` rouge job `security` sans commit deps = base CVE Trivy qui bouge ; comparer au run précédent avant de fouiller le diff.
- [Piège CodeQL `init`/`analyze` désynchronisés](piege-codeql-action-init-analyze-desync.md) — « configuration error » sur PR Dependabot ≠ alerte de sécurité ; corrigé par le groupe `codeql-action`.
- [Piège pact-drift flaky (course pact-core)](piege-pact-drift-flaky-course-pact-core.md) — « expected but not received » aléatoire = course pact-core sous charge ; en local, rejouer isolément avant de crier à la régression.
- [Course build/typecheck : libs hors sujet](piege-course-build-typecheck-libs.md) — les 14 libs ont une arête d'ordre, ne PAS les « harmoniser » sur les apps (#274).
- [Piège numéros de PR pré-publication](piege-numeros-pr-pre-publication.md) — PR < 2026-06-18 = ancien dépôt privé ; ne jamais les résoudre sur GitHub, vérifier dans le code.
- [Angles morts de l'audit axe](a11y-axe-angles-morts.md) — axe vert ≠ contraste OK : focus, bordures, `:disabled`, `opacity` d'ancêtre lui échappent.
- [Vérif UI locale (stack+Vite)](verif-ui-locale-stack.md) — docker stack + seed puis stop web + Vite dev :4200 ; pièges dans la fiche.
- [webpack-cli ^7.1.0](nx-webpack-cli-pin.md) — 6 services en `webpack-cli build` ; `--node-env` → `--config-node-env` depuis le bump 5→7.
- [Poller staging digest agrégé](staging-poller-watches-gateway-only.md) — corrigé (#54) ; secours `remote-deploy.ps1 -Environment staging`.

## Archives — chantiers livrés (détail et pièges dans chaque fiche)

- [Chantier versionnement dates d'effet (SFD 30)](chantier-versionnement-dates-effet.md) — 7/7 ✅ prod `0.14.0` ; correctif PK surrogate #257 déployé via `0.15.0`, rejeu projection joué 2026-08-01 (cf. fiche consolidation, R1) ; reste smoke PO.
- [Chantier confiance & quotidien](plan-confiance-et-quotidien.md) — 7 lots ✅ prod `0.14.0` ; reste vérif live 375 px ; gotchas d'orchestration multi-agents réutilisables dans la fiche.
- [Plan qualité Coquille + rappels + mail au service](plan-qualite-coquille-navigation.md) — 9 lots ✅ prod `0.12.0` ; exécution → [[chantier-coquille-execution]].
- [Exécution chantier Coquille](chantier-coquille-execution.md) — ✅ complet + ops L7 ; reste smoke live PO.
- [Plan qualité Profil & communication](plan-qualite-profil-communication.md) — 8/8 ✅ prod `0.12.0` ; ⚠️ L1 anti-tempête récap = risque confiance n°1 ACTIF PROD.
- [Chantier qualité établissements](plan-qualite-etablissements.md) — 4 lots ✅ mergés 2026-07-15.
- [Chantier qualité foyer+onboarding](feature-qualite-foyer-onboarding.md) — 5/5 ✅ prod `0.11.0` ; reste smoke live PO.
- [Chantier qualité Coûts](feature-qualite-couts.md) — 6/6 ✅ prod `0.11.0` ; reste **action PO : cocher « Première inscription » sur les contrats ABCM 2026**.
- [Chantier valider ma semaine](feature-valider-ma-semaine.md) — 6/6 ✅ prod `0.10.0` ; reste smoke PO.
- [Chantier contrats & besoins](feature-contrats-besoins.md) — ✅ prod `0.9.0` + back-fill enfant_id ; reste NOT NULL enfant_id + smoke ALSH PO.
- [Chantier UX planning pro](feature-ux-planning-pro.md) — 5/5 ✅ déployé via `0.9.0`.
- [Chantier UX dashboard jour](feature-ux-dashboard-jour.md) — 4/4 ✅ déployé via `0.9.0`.
- [Client API retry+timeout](feature-client-api-retry-timeout.md) — ✅ déployé via `0.9.0`.
- [Feature profil + préférences notif](feature-profil-preferences-notif.md) — ✅ prod `0.8.0` ; ⚠️ récap mardi = 1 mail/parent + `List-Unsubscribe` LIVE.
- [Feature cycle de vie du foyer](feature-foyer-cycle-de-vie.md) — ✅ prod `0.7.0` ; guards `@FoyerScope`/`@CreationFoyerUnique` réels.
- [Feature dashboard jour](feature-dashboard-jour.md) — ✅ prod `0.7.0`.
- [Feature établissements entité libre](feature-etablissements-entite-libre.md) — ✅ prod `0.6.0`, back-fill fait, table legacy droppée.
- [Feature parents du foyer](feature-parents-foyer.md) — ✅ complète ; ⚠️ AUTH isolation foyer ACTIVE en prod depuis 2026-06-28.
- [Feature notifications planning](feature-notifications-planning.md) — ✅ envoi réel ACTIF en prod ; ⚠️ risque mail crèche réelle `jaudrey@cscpapin.asso.fr` (ne pas cliquer Envoyer).
- [Feature édition hebdo besoins](feature-edition-hebdo-besoins.md) — ✅ complète (#65→#68).
- [Feature planning état ajusté](feature-planning-etat-ajuste.md) — ✅ complète ; `classerAbsence()` module pur web.
- [Feature contrat enfantId](feature-contrat-enfant-id.md) — ✅ mergé + back-fill prod ; reste migration NOT NULL différée.
- [Outbox SemaineValidee](feature-outbox-semaine-validee.md) — ✅ mergé (#168).
- [Migration react-router v7](dep-react-router-v7-migration.md) — ✅ mergée (#149).
- [Migration pact v17](dep-pact-v17-migration.md) — ✅ mergée (#150) drop-in.
- [Gouvernance doc 2026-07](gouvernance-doc-2026-07.md) — ✅ mergé : AUD 16/16, AQ-14/15 partiels, AQ-17/18 ouverts.
- [Audit 2026-07 + plan 6 lots](audit-2026-07-plan-amelioration.md) — lots 1a/1b/2a/2b ✅ ; restent 0/3 ; faux positifs connus à ne pas re-signaler.
