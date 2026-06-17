#!/usr/bin/env bash
# ===========================================================================
# backup-cron.sh — Tâche de sauvegarde planifiée (serveur de production)
# Usage : ./scripts/backup-cron.sh
#
# Pensé pour cron ou un timer systemd. Enchaîne :
#   1. chargement des secrets (.env.server → PG_<DB>_PWD) ;
#   2. backup-all.sh vers un répertoire persistant ;
#   3. backup-prune.sh (purge selon la rétention).
#
# Variables d'environnement :
#   BACKUP_DIR              répertoire de sortie persistant
#                           (défaut : $HOME/backups/creche)
#   BACKUP_RETENTION_DAYS   rétention en jours (défaut : 30)
#   ENV_FILE               fichier d'environnement à sourcer
#                           (défaut : <racine>/.env.server)
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

# Charger les secrets de prod (mots de passe PG_*_PWD) pour que backup-all.sh
# se connecte aux bases. En dev (pas de .env.server), les scripts retombent
# sur le repli user == mot de passe.
if [ -f "${ENV_FILE}" ]; then
    echo "Chargement de l'environnement : ${ENV_FILE}"
    set -a
    # shellcheck disable=SC1090
    source "${ENV_FILE}"
    set +a
else
    echo "Avertissement : ${ENV_FILE} introuvable — repli sur les identifiants de dev." >&2
fi

mkdir -p "${BACKUP_DIR}"

echo ">>> Sauvegarde vers ${BACKUP_DIR}"
"${SCRIPT_DIR}/backup-all.sh" "${BACKUP_DIR}"

echo ">>> Purge (rétention : ${BACKUP_RETENTION_DAYS:-30} j)"
"${SCRIPT_DIR}/backup-prune.sh" "${BACKUP_DIR}" "${BACKUP_RETENTION_DAYS:-30}"

echo ">>> Sauvegarde planifiée terminée."
