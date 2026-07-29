#!/usr/bin/env bash
# ===========================================================================
# backup-prune.sh — Purge des anciens dumps de creche-planner (rétention)
# Usage : ./scripts/backup-prune.sh [BACKUP_DIR] [RETENTION_DAYS]
#   BACKUP_DIR     : répertoire contenant les sous-dossiers horodatés
#                    (défaut : ./backups)
#   RETENTION_DAYS : nombre de jours à conserver
#                    (défaut : $BACKUP_RETENTION_DAYS, sinon 30)
#
# Supprime les sous-dossiers de sauvegarde (un par horodatage) plus vieux que
# RETENTION_DAYS. Pensé pour être enchaîné après backup-all.sh dans une tâche
# planifiée (cron / timer systemd). Idempotent et sûr : ne touche qu'aux
# dossiers de premier niveau sous BACKUP_DIR.
# ===========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

BACKUP_DIR="${1:-${PROJECT_DIR}/backups}"
RETENTION_DAYS="${2:-${BACKUP_RETENTION_DAYS:-30}}"

if ! [[ "${RETENTION_DAYS}" =~ ^[0-9]+$ ]]; then
    echo "Erreur : RETENTION_DAYS doit être un entier (reçu : '${RETENTION_DAYS}')" >&2
    exit 2
fi

if [ ! -d "${BACKUP_DIR}" ]; then
    echo "Rien à purger : ${BACKUP_DIR} n'existe pas encore."
    exit 0
fi

echo "=== creche-planner backup-prune ==="
echo "Répertoire : ${BACKUP_DIR}"
echo "Rétention  : ${RETENTION_DAYS} jour(s)"
echo ""

# Lister puis supprimer les dossiers de sauvegarde plus vieux que la rétention.
# -mindepth/-maxdepth 1 : uniquement les sous-dossiers directs (un par dump).
REMOVED=0
while IFS= read -r -d '' dir; do
    echo "-> Suppression de $(basename "${dir}")"
    rm -rf "${dir}"
    REMOVED=$((REMOVED + 1))
done < <(find "${BACKUP_DIR}" -mindepth 1 -maxdepth 1 -type d \
    -mtime "+${RETENTION_DAYS}" -print0)

echo ""
echo "=== Résumé ==="
echo "${REMOVED} dossier(s) de sauvegarde supprimé(s) (> ${RETENTION_DAYS} j)."
exit 0
