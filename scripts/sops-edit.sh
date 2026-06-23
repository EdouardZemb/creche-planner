#!/usr/bin/env bash
# Phase 11 — édite un secret chiffré (sops + age) en place, sans clair persistant.
#
# `sops` ouvre le contenu DÉCHIFFRÉ dans $EDITOR (fichier temporaire à perms
# restreintes qu'il nettoie lui-même), puis RE-CHIFFRE à la sauvegarde. C'est la
# voie canonique de ROTATION : déchiffre → édite → re-chiffre en une étape, le
# clair ne touchant jamais le disque de façon persistante.
#
# Le type dotenv doit être explicite : l'extension `.enc` n'est pas auto-détectée
# par sops (sinon il traiterait le fichier comme binaire et casserait le format).
#
# Usage :
#   EDITOR=nano bash scripts/sops-edit.sh                 # édite .env.server.enc
#   EDITOR=vim  bash scripts/sops-edit.sh .env.server.enc
#
# Après sauvegarde : committer le `.enc` modifié puis recréer le(s) conteneur(s)
# concerné(s) en `--no-deps` (cf. docs/exploitation/29-rotation-secrets.md).
#
# Pré-requis : `sops` sur le PATH et la clé privée age dans
# ~/.config/sops/age/keys.txt (SOPS_AGE_KEY_FILE pour surcharger).
set -euo pipefail

FILE="${1:-.env.server.enc}"

if ! command -v sops >/dev/null 2>&1; then
  echo 'sops-edit: `sops` absent du PATH (cf. scripts/sops-install.sh).' >&2
  exit 1
fi
if [ ! -f "$FILE" ]; then
  echo "sops-edit: fichier chiffré introuvable : $FILE (cwd=$(pwd))." >&2
  exit 1
fi
if [ -z "${EDITOR:-}" ]; then
  echo 'sops-edit: $EDITOR non défini (ex. EDITOR=nano bash scripts/sops-edit.sh).' >&2
  exit 2
fi

exec sops --input-type dotenv --output-type dotenv "$FILE"
