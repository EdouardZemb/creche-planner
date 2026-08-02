#!/usr/bin/env bash
# ===========================================================================
# backup-cron.sh — Tâche de sauvegarde planifiée (serveur de production)
# Usage : ./scripts/backup-cron.sh
#
# Pensé pour cron ou un timer systemd. Enchaîne :
#   1. chargement des secrets (.env.server → PG_<DB>_PWD, OFFSITE_*) ;
#   2. backup-all.sh vers un répertoire persistant ;
#   3. backup-prune.sh (purge selon la rétention) ;
#   4. backup-offsite.sh (copie hors-site chiffrée — sautée si OFFSITE_REMOTE
#      n'est pas défini dans l'environnement).
#
# Variables d'environnement :
#   BACKUP_DIR              répertoire de sortie persistant
#                           (défaut : $HOME/backups/creche)
#   BACKUP_RETENTION_DAYS   rétention en jours (défaut : 30)
#   ENV_FILE               fichier d'environnement à sourcer
#                           (défaut : <racine>/.env.server ; si absent et que
#                            <ENV_FILE>.enc existe, relais par with-secrets.sh)
#
# Sortie non nulle si la sauvegarde échoue (utile pour OnFailure systemd /
# MAILTO cron).
# ===========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_DIR}"

BACKUP_DIR="${BACKUP_DIR:-${HOME}/backups/creche}"
ENV_FILE="${ENV_FILE:-${PROJECT_DIR}/.env.server}"

# Depuis la Phase 11, le serveur n'a PLUS de `.env.server` en clair : les secrets
# vivent dans `.env.server.enc` (sops + age). Sans ce relais, ce script tombait
# dans le repli « identifiants de dev » et `OFFSITE_REMOTE` n'était JAMAIS défini
# — la copie hors-site se sautait donc elle-même, en silence et sans échec, alors
# que la variable était bien posée dans le store chiffré (constaté en prod le
# 2026-08-02 : « OFFSITE_REMOTE non défini — copie hors-site NON CONFIGURÉE »).
#
# On se re-lance UNE seule fois sous `with-secrets.sh`, qui déchiffre en tmpfs,
# exporte, puis détruit le clair à la sortie (trap). Le garde-fou anti-boucle est
# CRECHE_SECRETS_CHARGES.
#
# Conditions volontairement strictes : sans clé privée age ni `sops`, on NE tente
# rien et on conserve exactement l'ancien comportement (poste de dev, où
# `.env.server.enc` est pourtant présent puisqu'il est versionné).
AGE_KEY="${SOPS_AGE_KEY_FILE:-${HOME}/.config/sops/age/keys.txt}"
# `sops` vit dans ~/.local/bin sur le serveur (convention sops-install.sh) et le
# PATH de systemd ne l'inclut pas — même correctif que backup-offsite.sh.
PATH="${HOME}/.local/bin:${PATH}"
export PATH

if [ ! -f "${ENV_FILE}" ] && [ -f "${ENV_FILE}.enc" ] &&
    [ -z "${CRECHE_SECRETS_CHARGES:-}" ] && [ -f "${AGE_KEY}" ] &&
    command -v sops >/dev/null 2>&1; then
    echo "Secrets chiffrés détectés (${ENV_FILE}.enc) — relais par with-secrets.sh."
    export CRECHE_SECRETS_CHARGES=1
    exec bash "${SCRIPT_DIR}/with-secrets.sh" bash "${BASH_SOURCE[0]}" "$@"
fi

# Charger les secrets de prod (mots de passe PG_*_PWD, OFFSITE_*) pour que
# backup-all.sh se connecte aux bases et que backup-offsite.sh trouve sa cible.
# En dev (ni clair, ni clé age), les scripts retombent sur le repli
# user == mot de passe.
if [ -f "${ENV_FILE}" ]; then
    echo "Chargement de l'environnement : ${ENV_FILE}"
    set -a
    # shellcheck disable=SC1090
    source "${ENV_FILE}"
    set +a
elif [ -n "${CRECHE_SECRETS_CHARGES:-}" ]; then
    echo "Environnement chargé depuis ${ENV_FILE}.enc (sops + age, clair en tmpfs)."
else
    echo "Avertissement : ${ENV_FILE} introuvable — repli sur les identifiants de dev." >&2
fi

mkdir -p "${BACKUP_DIR}"

echo ">>> Sauvegarde vers ${BACKUP_DIR}"
"${SCRIPT_DIR}/backup-all.sh" "${BACKUP_DIR}"

echo ">>> Purge (rétention : ${BACKUP_RETENTION_DAYS:-30} j)"
"${SCRIPT_DIR}/backup-prune.sh" "${BACKUP_DIR}" "${BACKUP_RETENTION_DAYS:-30}"

echo ">>> Copie hors-site chiffrée (age + rclone)"
"${SCRIPT_DIR}/backup-offsite.sh" "${BACKUP_DIR}"

echo ">>> Sauvegarde planifiée terminée."
