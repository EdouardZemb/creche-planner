#!/usr/bin/env bash
# Wrapper du poller de PRODUCTION (Phase 10) — exécuté par creche-release-poll.service.
#
# Supprime la dépendance au poste de dev pour déployer : un timer systemd SORTANT
# sonde les GitHub Releases SIGNÉES et déclenche `scripts/deploy.mjs` à chaque
# nouvelle version semver. Porte le VERROU anti-concurrence et le chargement de
# .env.server, puis délègue la logique « release > déployé ? → déployer → marquer »
# à scripts/release-poll.mjs.
#
#   flock -n (verrou PROD PARTAGÉ avec remote-deploy → /tmp/creche-deploy.lock)
#     → git fetch + git pull --ff-only      (rattrape compose/scripts)
#     → set -a; . ./.env.server; set +a
#     → node scripts/release-poll.mjs        (sonde Releases + deploy.mjs si nouvelle version)
#
# Topologie pull-based préservée : tout est SORTANT, rien n'est exposé en entrant.
# Ce wrapper vise le clone de PROD (/home/edouard/creche-planner) — le MÊME que
# remote-deploy : le verrou commun garantit qu'un poll et un déclenchement manuel
# ne s'entrelacent jamais sur la pile de prod. Cf. scripts/systemd/README.md.
#
# Lancement manuel (test/bootstrap) depuis le clone de prod :
#   ./scripts/release-poll.sh
#   RELEASE_FORCE=1 ./scripts/release-poll.sh    # redéployer la release latest
set -euo pipefail

# cosign (DEPLOY_VERIFY_COSIGN=1) est installé dans ~/.local/bin sur le serveur.
export PATH="$HOME/.local/bin:$PATH"

# Racine = le clone qui contient ce script (résout les liens symboliques systemd).
ROOT="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$ROOT"

# Verrou anti-concurrence PARTAGÉ avec remote-deploy.ps1/.sh (même pile = même prod) :
# le poller et un déclenchement manuel ne se chevauchent jamais. flock NON bloquant :
# si un déploiement prod est déjà en cours, on abandonne SILENCIEUSEMENT (exit 0) →
# rien n'est marqué, le prochain tick réessaiera.
exec 9>/tmp/creche-deploy.lock
if ! flock -n 9; then
  echo 'RELEASE: un déploiement prod est DÉJÀ en cours (verrou occupé) — abandon.' >&2
  exit 0
fi

if [ "${RELEASE_SKIP_PULL:-0}" != '1' ]; then
  echo 'RELEASE: git fetch + git pull --ff-only'
  git fetch --tags --prune origin
  git pull --ff-only
fi
echo "RELEASE: commit du clone = $(git rev-parse --short HEAD 2>/dev/null || echo '?')"

set -a
. ./.env.server
set +a

exec node scripts/release-poll.mjs
