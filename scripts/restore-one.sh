#!/usr/bin/env bash
# ===========================================================================
# restore-one.sh — Restauration d'une base PostgreSQL de creche-planner
# Usage : ./scripts/restore-one.sh <DBNAME> <DUMP_FILE> [--force]
#   DBNAME    : referentiel | foyer | planification | tarification
#   DUMP_FILE : chemin vers le fichier .dump (custom) ou .sql (plain)
#   --force   : écrase les données existantes (demande confirmation)
#
# Prérequis : Docker actif, conteneur PostgreSQL cible démarré.
# Lancer depuis la racine du projet.
# ===========================================================================
set -euo pipefail

usage() {
    echo "Usage: $0 <DBNAME> <DUMP_FILE> [--force]"
    echo "  DBNAME : referentiel | foyer | planification | tarification"
    exit 1
}

# ---------------------------------------------------------------------------
# Validation des arguments
# ---------------------------------------------------------------------------
if [ "$#" -lt 2 ]; then
    usage
fi

DBNAME="$1"
DUMP_FILE="$2"
FORCE=false

if [ "${3:-}" = "--force" ]; then
    FORCE=true
fi

# Vérification du nom de base
case "${DBNAME}" in
    referentiel|foyer|planification|tarification) ;;
    *) echo "Erreur : DBNAME invalide '${DBNAME}'. Valeurs attendues : referentiel | foyer | planification | tarification" >&2; exit 2 ;;
esac

# Correspondance base → service docker-compose (lus dans docker-compose.yml)
case "${DBNAME}" in
    referentiel)   SERVICE="postgres-referentiel"   ;;
    foyer)         SERVICE="postgres-foyer"         ;;
    planification) SERVICE="postgres-planification" ;;
    tarification)  SERVICE="postgres-tarification"  ;;
esac

DB_USER="${DBNAME}"  # user == dbname dans ce projet

# Mot de passe : en prod, lu depuis l'env (PG_<DB>_PWD, défini dans .env.server) ;
# en dev, repli sur le user (le compose de base met POSTGRES_PASSWORD = user).
PWD_VAR="PG_$(echo "${DBNAME}" | tr '[:lower:]' '[:upper:]')_PWD"
DB_PWD="${!PWD_VAR:-${DB_USER}}"

if [ ! -f "${DUMP_FILE}" ]; then
    echo "Erreur : fichier dump introuvable : ${DUMP_FILE}" >&2
    exit 2
fi

EXT="${DUMP_FILE##*.}"
case "${EXT}" in
    dump) IS_BINARY=true ;;
    sql)  IS_BINARY=false ;;
    *) echo "Erreur : extension non reconnue '.${EXT}'. Attendu : .dump ou .sql" >&2; exit 2 ;;
esac

# ---------------------------------------------------------------------------
# Confirmation si --force
# ---------------------------------------------------------------------------
if [ "${FORCE}" = true ]; then
    echo "ATTENTION : la restauration avec --force va écraser les données existantes"
    echo "de la base '${DBNAME}' (service ${SERVICE}). Cette opération est IRREVERSIBLE"
    echo "sauf si vous avez une sauvegarde récente."
    echo ""
    read -r -p "Confirmer ? (tapez 'oui' pour continuer) : " CONFIRM
    if [ "${CONFIRM}" != "oui" ]; then
        echo "Restauration annulée."
        exit 0
    fi
fi

echo "=== creche-planner restore-one ==="
echo "Base       : ${DBNAME}"
echo "Service    : ${SERVICE}"
echo "Fichier    : ${DUMP_FILE}"
echo "Format     : $([ "${IS_BINARY}" = true ] && echo 'custom (pg_restore)' || echo 'plain SQL (psql)')"
echo "Mode Force : ${FORCE}"
echo ""

# ---------------------------------------------------------------------------
# Restauration
# ---------------------------------------------------------------------------
if [ "${IS_BINARY}" = true ]; then
    # --- Format custom : pg_restore ---
    CLEAN_FLAGS=()
    if [ "${FORCE}" = true ]; then
        CLEAN_FLAGS=(--clean --if-exists)
    fi

    printf "Lancement de pg_restore..."
    docker compose exec -T \
        -e "PGPASSWORD=${DB_PWD}" \
        "${SERVICE}" \
        pg_restore \
        -U "${DB_USER}" \
        -d "${DBNAME}" \
        --no-owner \
        --no-privileges \
        --exit-on-error \
        "${CLEAN_FLAGS[@]}" \
        < "${DUMP_FILE}"
else
    # --- Format plain SQL : psql ---
    printf "Lancement de psql..."
    docker compose exec -T \
        -e "PGPASSWORD=${DB_PWD}" \
        "${SERVICE}" \
        psql \
        -U "${DB_USER}" \
        -d "${DBNAME}" \
        --single-transaction \
        < "${DUMP_FILE}"
fi

echo " OK"
echo ""
echo "Restauration de '${DBNAME}' terminée avec succès."
exit 0
