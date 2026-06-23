#!/usr/bin/env bash
# Phase 11 — déchiffre les secrets serveur (sops + age) le temps d'UNE commande.
#
# Remplace l'ancien `set -a; . ./.env.server; set +a` des wrappers de déploiement :
# le clair n'existe plus sur le disque. Ce helper déchiffre `.env.server.enc` (sops,
# format dotenv) vers un fichier ÉPHÉMÈRE en RAM (tmpfs `/dev/shm`, mode 600), le
# `source` (→ les secrets entrent dans l'environnement du process et de ses enfants),
# expose `DEPLOY_ENV_FILE` vers ce fichier (→ `docker compose --env-file` l'utilise
# pour l'interpolation `${VAR}`), exécute la commande passée, PUIS détruit le clair
# (`trap EXIT` → shred/rm). Aucun clair persistant non protégé (cf. doc 29).
#
# Usage :
#   bash scripts/with-secrets.sh node scripts/deploy.mjs
#   # surcharger une variable APRÈS le source (sinon la valeur du fichier l'écrase) :
#   bash scripts/with-secrets.sh env IMAGE_TAG=0.1.0 node scripts/deploy.mjs
#
# Pré-requis serveur : `sops` sur le PATH (cf. scripts/sops-install.sh) et la clé
# privée age dans ~/.config/sops/age/keys.txt (générée au bootstrap, jamais versionnée).
#
# Variables :
#   SECRETS_ENC_FILE   fichier chiffré (défaut .env.server.enc, relatif au cwd).
#   SOPS_AGE_KEY_FILE  clé privée age (défaut ~/.config/sops/age/keys.txt).
set -euo pipefail

ENC_FILE="${SECRETS_ENC_FILE:-.env.server.enc}"
AGE_KEY="${SOPS_AGE_KEY_FILE:-$HOME/.config/sops/age/keys.txt}"

if [ "$#" -lt 1 ]; then
  echo 'with-secrets: aucune commande fournie (usage : with-secrets.sh <cmd> [args…]).' >&2
  exit 2
fi
if ! command -v sops >/dev/null 2>&1; then
  echo 'with-secrets: `sops` absent du PATH (cf. scripts/sops-install.sh).' >&2
  exit 1
fi
if [ ! -f "$ENC_FILE" ]; then
  echo "with-secrets: fichier chiffré introuvable : $ENC_FILE (cwd=$(pwd))." >&2
  exit 1
fi
if [ ! -f "$AGE_KEY" ]; then
  echo "with-secrets: clé privée age introuvable : $AGE_KEY." >&2
  echo '             (générée au bootstrap ; restaurer depuis la sauvegarde offline si perdue).' >&2
  exit 1
fi

# Répertoire RAM (tmpfs) : le clair n'atteint jamais le disque. Repli sur TMPDIR/tmp
# si /dev/shm est indisponible (rare). umask 077 → le mktemp naît en 600.
RAMDIR=/dev/shm
if ! { [ -d "$RAMDIR" ] && [ -w "$RAMDIR" ]; }; then
  RAMDIR="${TMPDIR:-/tmp}"
fi
umask 077
PLAIN="$(mktemp "$RAMDIR/creche-env.XXXXXX")"
cleanup() { shred -u "$PLAIN" 2>/dev/null || rm -f "$PLAIN"; }
trap cleanup EXIT INT TERM

# Déchiffrement (type dotenv explicite : l'extension .enc n'est pas auto-détectée).
SOPS_AGE_KEY_FILE="$AGE_KEY" sops --decrypt \
  --input-type dotenv --output-type dotenv "$ENC_FILE" >"$PLAIN"

# `set -a` : tout ce qui est sourcé est EXPORTÉ → hérité par la commande et ses enfants
# (docker compose lit `secrets: environment:` et l'interpolation depuis l'env du process).
set -a
# shellcheck disable=SC1090
. "$PLAIN"
set +a
# `docker compose --env-file <tmpfile>` (deploy.mjs/release-poll.mjs lisent DEPLOY_ENV_FILE).
export DEPLOY_ENV_FILE="$PLAIN"

# PAS d'`exec` : on doit conserver la main pour que le trap EXIT détruise le clair.
set +e
"$@"
rc=$?
set -e
exit "$rc"
