#!/usr/bin/env bash
# Wrapper du poller de STAGING (Phase 8) — exécuté par creche-staging-poll.service.
#
# Porte le VERROU anti-concurrence et le chargement de .env.staging, puis délègue la
# logique « digest changé ? → déployer → marquer » à scripts/staging-poll.mjs.
#
#   flock -n (verrou DÉDIÉ staging, distinct de celui de la prod)
#     → git fetch + git pull --ff-only      (rattrape compose/scripts pour ce :main)
#     → set -a; . ./.env.staging; set +a
#     → node scripts/staging-poll.mjs        (sonde GHCR + deploy.mjs si nouveau)
#
# Topologie pull-based préservée : tout est SORTANT, rien n'est exposé en entrant.
# Le clone de staging est SÉPARÉ de celui de la prod (ex. /home/edouard/
# creche-planner-staging) pour qu'un `git pull` du poller ne touche jamais l'arbre
# de travail de la prod. Cf. scripts/systemd/README.md.
#
# Lancement manuel (test/bootstrap) depuis le clone de staging :
#   ./scripts/staging-poll.sh
#   STAGING_FORCE=1 ./scripts/staging-poll.sh    # forcer un déploiement
set -euo pipefail

# cosign (DEPLOY_VERIFY_COSIGN=1) est installé dans ~/.local/bin sur le serveur.
export PATH="$HOME/.local/bin:$PATH"

# Racine = le clone qui contient ce script (résout les liens symboliques systemd).
ROOT="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$ROOT"

# Verrou anti-concurrence DÉDIÉ au staging (la prod a /tmp/creche-deploy.lock) :
# deux ticks ne se chevauchent jamais, et un déploiement prod manuel reste possible
# en parallèle (projets/piles Compose distincts).
exec 9>/tmp/creche-staging-deploy.lock
if ! flock -n 9; then
  echo 'STAGING: un poll/déploiement est DÉJÀ en cours (verrou occupé) — abandon.' >&2
  exit 0
fi

if [ "${STAGING_SKIP_PULL:-0}" != '1' ]; then
  echo 'STAGING: git fetch + git pull --ff-only'
  git fetch --tags --prune origin
  git pull --ff-only
fi
echo "STAGING: commit du clone = $(git rev-parse --short HEAD 2>/dev/null || echo '?')"

set -a
. ./.env.staging
set +a

exec node scripts/staging-poll.mjs
