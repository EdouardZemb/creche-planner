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

- **Secret scanning** — double couche : (1) un job `secret-scan` (gitleaks) s'exécute
  sur chaque push et chaque PR et **bloque** sur tout secret détecté
  ([.github/workflows/ci.yml](.github/workflows/ci.yml)) ; (2) le **secret scanning
  natif GitHub** et la **push protection** sont activés (dépôt public) — un secret
  poussé est détecté côté serveur et le push est refusé avant d'atterrir.
- **SCA** — `pnpm audit --prod` bloquant sur HIGH/CRITICAL.
- **SAST** — CodeQL (code scanning) sur push `main`, PR et passage hebdomadaire ;
  les alertes remontent dans l'onglet **Security → Code scanning** (GitHub Advanced
  Security, gratuit sur dépôt public).
- **Dépendances** — Dependabot (npm + actions GitHub épinglées par SHA).

## Protection de branche

Le dépôt étant **public**, la protection de branche est **activée et appliquée
côté serveur** sur `main` (PUB-D, cf. [doc 25 §AUD-04](docs/25-audit-cicd-remediation.md)) :

- **PR obligatoire** pour modifier `main` (push direct refusé).
- **Check `ci` requis** et à jour (`strict: true`) avant tout merge. Le check
  `security` n'est volontairement **pas** requis tant qu'il porte une vuln
  pré-existante hors périmètre (Multer DoS, < 2.2.0) qui le maintient rouge.
- **Force-push et suppression de branche interdits.**
- Mainteneur unique : **0 revue obligatoire** (auto-merge possible) et
  `enforce_admins` désactivé (échappatoire d'urgence conservée).

> Historique : tant que le dépôt était privé sur plan gratuit, cette protection
> était indisponible (`gh api .../branches/main/protection` → HTTP 403). La
> limitation est **levée** depuis le passage en public.
