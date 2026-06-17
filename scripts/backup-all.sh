#!/usr/bin/env bash
# ===========================================================================
# backup-all.sh — Sauvegarde des 4 bases PostgreSQL de creche-planner
# Usage : ./scripts/backup-all.sh [OUTPUT_DIR] [FORMAT]
#   OUTPUT_DIR : répertoire de sortie (défaut : ./backups)
#   FORMAT     : custom (défaut) | plain
#
# Prérequis : Docker actif, pile démarrée (docker compose up -d).
# Lancer depuis la racine du projet.
# ===========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

OUTPUT_DIR="${1:-${PROJECT_DIR}/backups}"
FORMAT="${2:-custom}"

TIMESTAMP="$(date -u '+%Y-%m-%dT%H-%M-%S')"
DUMP_DIR="${OUTPUT_DIR}/${TIMESTAMP}"

mkdir -p "${DUMP_DIR}"

echo "=== creche-planner backup-all ==="
echo "Dossier de sortie : ${DUMP_DIR}"
echo "Format            : ${FORMAT}"
echo ""

# ---------------------------------------------------------------------------
# Bases à sauvegarder (noms lus dans docker-compose.yml)
# Format : "SERVICE USER DBNAME"
# ---------------------------------------------------------------------------
DATABASES=(
    "postgres-referentiel   referentiel   referentiel"
    "postgres-foyer         foyer         foyer"
    "postgres-planification planification planification"
    "postgres-tarification  tarification  tarification"
)

if [ "${FORMAT}" = "custom" ]; then
    EXT="dump"
    PG_FORMAT="c"
else
    EXT="sql"
    PG_FORMAT="p"
fi

ERRORS=0
TOTAL="${#DATABASES[@]}"

for entry in "${DATABASES[@]}"; do
    # shellcheck disable=SC2086
    read -r SERVICE USER DBNAME <<< ${entry}
    FILE="${DUMP_DIR}/${DBNAME}_${TIMESTAMP}.${EXT}"

    # Mot de passe : en prod, lu depuis l'env (PG_<DB>_PWD, défini dans
    # .env.server) ; en dev, repli sur le user (le compose de base met
    # POSTGRES_PASSWORD = user). Sans ce repli, la sauvegarde planifiée
    # échouerait sur le serveur où les mots de passe sont des secrets.
    PWD_VAR="PG_$(echo "${DBNAME}" | tr '[:lower:]' '[:upper:]')_PWD"
    DB_PWD="${!PWD_VAR:-${USER}}"

    # `--` : sans lui, printf prend le format « -> » pour une option et échoue
    # (sous set -e, ça avorterait la sauvegarde avant le moindre pg_dump).
    printf -- "-> Sauvegarde de %s (service : %s)..." "${DBNAME}" "${SERVICE}"

    if docker compose exec -T \
        -e "PGPASSWORD=${DB_PWD}" \
        "${SERVICE}" \
        pg_dump -U "${USER}" -d "${DBNAME}" -F "${PG_FORMAT}" \
        > "${FILE}" 2>/tmp/backup_err_${DBNAME}; then

        SIZE_KB=$(du -k "${FILE}" | cut -f1)
        echo " OK (${SIZE_KB} Ko)"
    else
        echo " ERREUR"
        cat /tmp/backup_err_${DBNAME} >&2
        rm -f "${FILE}"
        ERRORS=$((ERRORS + 1))
    fi
done

echo ""
echo "=== Résumé ==="
SUCCESS=$((TOTAL - ERRORS))
echo "${SUCCESS}/${TOTAL} bases sauvegardées dans : ${DUMP_DIR}"

if [ "${ERRORS}" -gt 0 ]; then
    echo "Bases en erreur : ${ERRORS}" >&2
    exit 1
fi

echo "Sauvegarde terminée avec succès."
exit 0
