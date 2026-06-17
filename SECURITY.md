# Politique de sécurité

Ce projet (`creche-planner`) gère des données de foyers et des montants de
facturation : la sécurité y est traitée comme une exigence de premier ordre
(SCA bloquant, SAST CodeQL, Dependabot, secret scanning — cf.
[doc 25](docs/25-audit-cicd-remediation.md)).

## Versions supportées

Le projet est livré en continu depuis la branche `main` (déploiement serveur LAN
et Cloudflare Tunnel, cf.
[doc 24](docs/exploitation/24-plan-deploiement-serveur-ct-qdo.md)). Seule la
**dernière version déployée depuis `main`** est supportée ; il n'existe pas de
branches de maintenance.

| Version               | Supportée |
| --------------------- | --------- |
| `main` (dernier dép.) | ✅        |
| Tout commit antérieur | ❌        |

## Signaler une vulnérabilité

**Ne créez pas d'issue publique pour une faille de sécurité.** Utilisez le canal
privé de GitHub :

- l'onglet **Security → Report a vulnerability** du dépôt
  (**Private Vulnerability Reporting**). Le rapport reste confidentiel jusqu'à
  publication d'un correctif.

Merci d'inclure : description, impact estimé, étapes de reproduction, et toute
preuve de concept. Ne committez ni n'attachez de secret réel.

### Délais de réponse (best effort, mainteneur unique)

| Étape                           | Délai cible                                |
| ------------------------------- | ------------------------------------------ |
| Accusé de réception             | 72 h                                       |
| Évaluation initiale / triage    | 7 jours                                    |
| Correctif ou plan d'atténuation | selon sévérité (CRITICAL/HIGH en priorité) |

## Périmètre

Dans le périmètre : le code applicatif (`apps/`, `libs/`), la chaîne CI/CD
(`.github/workflows/`), la configuration de déploiement (`docker-compose*.yml`,
`Caddyfile`, exemples `.env*.example`).

Hors périmètre : les secrets réels (jamais committés — `.env.server` et `.env`
sont gitignorés, cf. [doc 24 §1](docs/exploitation/24-plan-deploiement-serveur-ct-qdo.md)),
les services tiers (GitHub, Cloudflare) relevant de leurs propres politiques.

## Garde-fous automatiques

- **Secret scanning** — un job `secret-scan` (gitleaks) s'exécute sur chaque push
  et chaque PR et **bloque** sur tout secret détecté
  ([.github/workflows/ci.yml](.github/workflows/ci.yml)).
- **SCA** — `pnpm audit --prod` bloquant sur HIGH/CRITICAL.
- **SAST** — CodeQL (en pause tant que le dépôt est privé sur plan gratuit :
  l'upload de résultats « code scanning » exige GitHub Advanced Security).
- **Dépendances** — Dependabot (npm + actions GitHub épinglées par SHA).

## Limitation connue — protection de branche

Le dépôt est **privé sur plan GitHub gratuit** : la protection de branche
classique et les rulesets sont **indisponibles** (`gh api .../branches/main/protection`
→ HTTP 403 « Upgrade to GitHub Pro or make this repository public »). Il n'y a
donc **pas d'enforcement serveur** des revues obligatoires ni des checks requis ;
la discipline repose sur la convention « une branche + une PR » et les portes CI.
Voir [doc 25 §AUD-04](docs/25-audit-cicd-remediation.md) pour les options
(GitHub Pro/Team, repo public, ou acter la limitation).
