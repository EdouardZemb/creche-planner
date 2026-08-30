# Index de la documentation

> Par où commencer selon votre besoin, puis la liste complète par thème.
> Chaque doc porte un **numéro stable** utilisé dans les renvois croisés
> (« doc 24 », « AQ-16 »…) — ne jamais renuméroter un document existant.

## ⚠️ Note sur la numérotation

La numérotation est **globale** mais les fichiers vivent dans **deux dossiers** :
les docs d'exploitation sont rangées dans [`exploitation/`](exploitation/). C'est
pourquoi `docs/` semble sauter du 23 au 25 : le **doc 24** est
[`exploitation/24-plan-deploiement-serveur-ct-qdo.md`](exploitation/24-plan-deploiement-serveur-ct-qdo.md)
(de même pour les docs 28 et 29). Les fichiers ne sont **pas** déplacés ni
renumérotés — trop de liens existants en dépendent.

## Par où commencer

| Besoin                        | Lire                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Comprendre le produit         | [doc 01](01-spec-fonctionnelle.md) puis [doc 02](02-modele-de-cout.md)                                              |
| Contribuer du code            | [CONTRIBUTING.md](../CONTRIBUTING.md), [CONVENTIONS.md](../CONVENTIONS.md), [doc 03](03-standards-developpement.md) |
| Reprendre le projet           | [doc 06](06-etat-davancement.md) (état d'avancement & guide de reprise)                                             |
| Déployer / exploiter          | [doc 24](exploitation/24-plan-deploiement-serveur-ct-qdo.md) + [runbook](exploitation/runbook-deploiement.md)       |
| Comprendre un choix technique | [ADR](adr/) (0001 → 0009)                                                                                           |
| Écrire ou revoir un document  | [doc 35](35-politique-documentation.md) (politique de documentation)                                                |

## Spécification fonctionnelle & produit

| Doc                                                               | Contenu                                                                          |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [01 — Spécification fonctionnelle](01-spec-fonctionnelle.md)      | Périmètre, acteurs, user stories, règles métier, critères d'acceptation          |
| [02 — Modèle de coût](02-modele-de-cout.md)                       | Formules PSU/CNAF et ABCM, glossaire, invariants, cas de test chiffrés CT-01..20 |
| [07 — Spec UX, navigation & interface](07-spec-ux-navigation.md)  | Écrans, parcours, navigation, états d'erreur                                     |
| [16 — Ajustement de planning par jour](16-ajustement-planning.md) | Ajout/retrait d'un jour, heures, portée réel/simulé                              |
| [19 — Registre de risque produit](19-registre-risque-produit.md)  | Risques produit identifiés et mitigations                                        |

### SFD 30 — livrée (déployée en prod le 2026-07-29)

| Doc                                                                          | Contenu                                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [30 — SFD Versionnement à date d'effet](30-sfd-versionnement-dates-effet.md) | Avenants, grilles/barèmes versionnés, passé immuable — socle des docs 31/32/33 |

### SFD à l'étude (brouillons, séquence 31 → 33)

| Doc                                                                                   | Contenu                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [31 — SFD Calendriers & vacances scolaires](31-sfd-calendriers-vacances-scolaires.md) | Calendrier d'ouverture par établissement, import zone scolaire + retouches — **validée v1.0**                                                                                                                               |
| [32 — SFD Travail, congés & revenus](32-sfd-travail-conges-revenus.md)                | Contrats de travail (FR/CH, frontalier), absences typées, soldes CP/heures, revenus                                                                                                                                         |
| [33 — SFD Planning famille](33-sfd-planning-famille.md)                               | Vue commune « qui fait quoi, où, avec qui », trajets, détection de conflits                                                                                                                                                 |
| [38 — SFD Rattachement documentaire](38-sfd-rattachement-documentaire.md)             | La GED du foyer (Paperless) branchée sur l'app — dépôt, recherche, rattachement, par un second bord Tailscale — **validée v1.0** ; **hors séquence 31 → 33**, ordonnancement à arbitrer                                     |
| [39 — SFD Recette systématique & agents QA](39-sfd-recette-systematique-agents-qa.md) | Un filet de recette de bout en bout avant livraison : parcours par persona rejoué sur staging, défauts convertis en tests permanents — **validée v1.0** ; hors séquence 31 → 33, lot 0 (remise en état de staging) bloquant |

## Architecture & conception

| Doc                                                                                    | Contenu                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [04 — Architecture & technologies](04-architecture-et-technos.md)                      | Comparatif techno, choix justifiés, découpage en microservices                                                                                                                           |
| [09 — Spec : découplage & maturité microservices](09-spec-decouplage-microservices.md) | Décisions DEC-xx (contrats, projections, résilience)                                                                                                                                     |
| [10 — Plan d'implémentation du découplage](10-plan-implementation-decouplage.md)       | Sessions d'exécution de la doc 09                                                                                                                                                        |
| [14 — Peuplement BDD & API contrats](14-peuplement-bdd-et-api-contrats.md)             | Jeu de données de référence, consommation de l'API par le front                                                                                                                          |
| [37 — Registre des traitements, tiers et durées](37-registre-des-traitements.md)       | Quelles données personnelles vivent où, chez quels tiers, et combien de temps on les garde                                                                                               |
| [ADR 0001 → 0009](adr/)                                                                | Microservices, grain des services, toolchain, contrats décentralisés, registre de contrats, préférences de notification, exemption domestique, écarts de sémantique HTTP, nom du produit |

## Développement (standards & avancement)

| Doc                                                                 | Contenu                                                                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [CONTRIBUTING.md](../CONTRIBUTING.md) (racine)                      | Prérequis, commandes de base, workflow PR — le point d'entrée contributeur                                 |
| [CONVENTIONS.md](../CONVENTIONS.md) (racine)                        | Conventions TS/React outillées : strict, React Compiler, ratchet ESLint, frontières Nx, branded types      |
| [03 — Standards de développement](03-standards-developpement.md)    | Clean code, SOLID, hexagonal, tests, Git, CI — la référence détaillée                                      |
| [35 — Politique de documentation](35-politique-documentation.md)    | Normes retenues, un document/un quadrant, portes `pnpm liens` et `pnpm faits`, et ce qui n'est PAS outillé |
| [05 — Plan de développement](05-plan-de-developpement.md)           | **Document historique** (phases initiales) — l'état réel vit en doc 06                                     |
| [06 — État d'avancement & guide de reprise](06-etat-davancement.md) | Source de vérité de l'avancement, arborescence, commandes                                                  |
| [08 — Plan d'implémentation UX](08-plan-implementation-ux.md)       | Sessions d'exécution de la doc 07                                                                          |
| [Runbook — migration Nx](runbook-nx-migrate.md)                     | `nx migrate` pas-à-pas, pièges peer-deps, pourquoi les PR Dependabot `@nx/*` se ferment                    |

## Accessibilité

| Doc                                                                                 | Contenu                                                   |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [11 — Spec accessibilité AA & utilisabilité](11-spec-accessibilite-ct-ut.md)        | Exigences WCAG AA, audit CT-UT                            |
| [12 — Plan d'implémentation accessibilité](12-plan-implementation-accessibilite.md) | Sessions d'exécution de la doc 11                         |
| [13 — Validation accessibilité runtime](13-validation-accessibilite-runtime.md)     | Runbook de validation manuelle (lecteur d'écran, clavier) |

## Tests & qualité

| Doc                                                                                   | Contenu                                                                                 |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [15 — Tests E2E sur stack réelle](15-spec-tests-e2e-stack-reelle.md)                  | Étage E2E sans mock contre la pile dockerisée                                           |
| [17 — Tests Model-Based (CT-MBT)](17-tests-model-based-ct-mbt.md)                     | Modèles, property testing, oracle                                                       |
| [20 — Plan de test par phase](20-plan-de-test.md)                                     | Ce qui est testé, à quel niveau, par phase                                              |
| [21 — Politique & stratégie de test](21-politique-strategie-test.md)                  | Niveaux de test, KPI, politique de non-régression                                       |
| [22 — Registre d'anomalies](22-registre-anomalies.md)                                 | Anomalies AN-xx + DDP par niveau de détection                                           |
| [23 — Smoke de performance](23-smoke-performance.md)                                  | Garde de latence sur `/api/v1/couts/annuel`                                             |
| [39 — SFD Recette systématique & agents QA](39-sfd-recette-systematique-agents-qa.md) | Recette de parcours par persona avant livraison, agents explorateurs — **validée v1.0** |

## Exploitation ([`exploitation/`](exploitation/))

| Doc                                                                                             | Contenu                                                            |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [24 — Plan de déploiement serveur (CT-QDO)](exploitation/24-plan-deploiement-serveur-ct-qdo.md) | Production LAN : portes de déploiement, topologie pull-based, DORA |
| [Runbook de déploiement](exploitation/runbook-deploiement.md)                                   | Procédures pas-à-pas (local + renvoi prod doc 24)                  |
| [Observabilité](exploitation/observabilite.md)                                                  | Prometheus/Grafana/Tempo/Loki, alerting, dashboards                |
| [Sauvegardes PostgreSQL](exploitation/sauvegardes.md)                                           | Sauvegarde/restauration des bases, cron, rétention                 |
| [28 — Roadmap améliorations CI/CD & obs](exploitation/28-roadmap-ameliorations-cicd.md)         | Phases 5→13 (staging, rollback auto, pollers…) — **close**         |
| [29 — Chiffrement & rotation des secrets](exploitation/29-rotation-secrets.md)                  | sops + age, runbook de rotation par secret                         |

## Audits & plans de remédiation

Registres d'actions à **ID stables**, statut re-vérifié dans le code :

| Doc                                                                                   | Contenu                                                                                   |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [18 — Audit gestion des tests (CTAL-TM/TMMi)](18-audit-gestion-tests-ctal-tm-tmmi.md) | Maturité de la gestion de test, actions P1/P2                                             |
| [25 — Audit CI/CD & remédiation](25-audit-cicd-remediation.md)                        | Actions AUD-01→16 (16/16 livrées) + journal d'exécution                                   |
| [26 — Instrumentation DORA (AUD-08)](26-instrumentation-dora-aud-08.md)               | Design du wrapper de déploiement + métriques DORA                                         |
| [27 — Audit global & remédiation](27-audit-global-remediation.md)                     | Actions AQ-01→18 (statut détaillé au §1)                                                  |
| [34 — Registre d'améliorations, leçons et portes](34-registre-ameliorations.md)       | Registre **vivant** : pistes AM-xx, empêchements EM-xx, leçons LE-xx, motifs MO-x, portes |
| [36 — Veille sur les standards du produit](36-veille-standards.md)                    | Veille cadencée sur les référentiels applicables (RGPD, RFC, WCAG, OWASP)                 |

> La doc 34 est la seule de cette section qui ne se **clôt** pas : les docs 18/25/27 sont des
> instantanés d'audit, elle est le flux qui les remplace (gardée par `pnpm registre`).

> [`README-nx-template.md`](README-nx-template.md) est le README généré par Nx à la
> création du workspace, conservé pour référence — ce n'est pas une doc du projet.
