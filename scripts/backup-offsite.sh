#!/usr/bin/env bash
# ===========================================================================
# backup-offsite.sh — Copie hors-site chiffrée du dernier jeu de dumps
# Usage : ./scripts/backup-offsite.sh [BACKUP_DIR]
#   BACKUP_DIR : répertoire contenant les sous-dossiers horodatés
#                (défaut : ./backups)
#
# Chiffre le jeu de dumps le plus récent avec `age` (clé PUBLIQUE du projet,
# la même que sops — la clé PRIVÉE ne quitte jamais le serveur) puis le pousse
# vers une cible rclone (cloud). Enchaîné après backup-prune.sh par
# backup-cron.sh ; rejouable à la main, idempotent (un jeu déjà poussé n'est
# pas re-transféré).
#
# Variables d'environnement (via .env.server, chargé par backup-cron.sh) :
#   OFFSITE_REMOTE          cible rclone, ex. gdrive-creche:creche-backups.
#                           ABSENTE → étape sautée avec avertissement (opt-in),
#                           code 0 : les installations sans hors-site ne
#                           cassent pas la sauvegarde locale.
#   OFFSITE_AGE_RECIPIENT   clé publique age (défaut : lue dans .sops.yaml —
#                           une rotation de clé sops est ainsi suivie).
#   OFFSITE_RETENTION_DAYS  rétention côté cloud en jours (défaut : 90).
#
# Restauration depuis le hors-site : voir docs/exploitation/sauvegardes.md §9.
# ===========================================================================
set -euo pipefail

# systemd lance la tâche avec un PATH minimal ; age/rclone peuvent être dans
# ~/.local/bin (convention du serveur, cf. sops-install.sh).
PATH="${HOME}/.local/bin:${PATH}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

BACKUP_DIR="${1:-${PROJECT_DIR}/backups}"
RETENTION_DAYS="${OFFSITE_RETENTION_DAYS:-90}"

echo "=== creche-planner backup-offsite ==="

if [ -z "${OFFSITE_REMOTE:-}" ]; then
    echo "OFFSITE_REMOTE non défini — copie hors-site NON CONFIGURÉE (sautée)." >&2
    echo "Pour l'activer : docs/exploitation/sauvegardes.md §9." >&2
    exit 0
fi

# À partir d'ici le hors-site est VOULU : toute défaillance doit être bruyante
# (code ≠ 0 → échec de creche-backup.service visible dans journalctl).
for outil in age rclone tar; do
    if ! command -v "${outil}" > /dev/null; then
        echo "Erreur : '${outil}' introuvable sur le PATH (${PATH})." >&2
        exit 1
    fi
done

if ! [[ "${RETENTION_DAYS}" =~ ^[0-9]+$ ]]; then
    echo "Erreur : OFFSITE_RETENTION_DAYS doit être un entier (reçu : '${RETENTION_DAYS}')" >&2
    exit 2
fi

# Destinataire age : surcharge explicite, sinon la clé publique du projet
# déclarée dans .sops.yaml (celle dont la privée est ~/.config/sops/age/keys.txt).
RECIPIENT="${OFFSITE_AGE_RECIPIENT:-$(grep -oE 'age1[0-9a-z]+' "${PROJECT_DIR}/.sops.yaml" | head -n 1)}"
if [ -z "${RECIPIENT}" ]; then
    echo "Erreur : aucune clé publique age (ni OFFSITE_AGE_RECIPIENT, ni .sops.yaml)." >&2
    exit 2
fi

# Dernier jeu de dumps : les dossiers sont horodatés ISO-8601 → le tri
# lexicographique est chronologique.
LATEST="$(find "${BACKUP_DIR}" -mindepth 1 -maxdepth 1 -type d 2> /dev/null | sort | tail -n 1)"
if [ -z "${LATEST}" ]; then
    echo "Erreur : aucun jeu de dumps dans ${BACKUP_DIR} (backup-all.sh a-t-il tourné ?)." >&2
    exit 1
fi

JEU="$(basename "${LATEST}")"
ARCHIVE="creche_${JEU}.tar.age"

echo "Jeu local     : ${LATEST}"
echo "Cible         : ${OFFSITE_REMOTE}/${ARCHIVE}"
echo "Destinataire  : ${RECIPIENT}"
echo "Rétention     : ${RETENTION_DAYS} j (côté cloud)"
echo ""

# Idempotence : un jeu déjà présent côté cloud n'est pas re-poussé (un rejeu
# manuel retombe sur le même dernier jeu tant qu'un nouveau backup n'a pas
# tourné). Au premier envoi le dossier distant n'existe pas encore : lsf sort
# en erreur, avalée par le `if` (l'envoi a alors simplement lieu).
if rclone lsf "${OFFSITE_REMOTE}" 2> /dev/null | grep -qxF "${ARCHIVE}"; then
    echo "Déjà présent côté cloud — rien à pousser."
    exit 0
fi

# tar + chiffrement en un flux, vers un fichier de travail sous BACKUP_DIR
# (même système de fichiers, nettoyé même en cas d'échec). Le clair ne touche
# jamais le cloud : seul le .tar.age sort du serveur.
TMP_ARCHIVE="$(mktemp "${BACKUP_DIR}/.offsite-XXXXXX.tar.age")"
trap 'rm -f "${TMP_ARCHIVE}"' EXIT

printf -- "-> Chiffrement (age)..."
tar -C "${BACKUP_DIR}" -cf - "${JEU}" | age -r "${RECIPIENT}" -o "${TMP_ARCHIVE}"
SIZE_KB=$(du -k "${TMP_ARCHIVE}" | cut -f1)
echo " OK (${SIZE_KB} Ko)"

printf -- "-> Envoi (rclone)..."
rclone copyto --transfers 1 --contimeout 30s "${TMP_ARCHIVE}" "${OFFSITE_REMOTE}/${ARCHIVE}"
echo " OK"

# Vérification : l'archive doit être listable côté cloud avant de purger quoi
# que ce soit.
if ! rclone lsf "${OFFSITE_REMOTE}" | grep -qxF "${ARCHIVE}"; then
    echo "Erreur : ${ARCHIVE} absente du listing distant après envoi." >&2
    exit 1
fi

echo "-> Purge distante (> ${RETENTION_DAYS} j)..."
rclone delete --min-age "${RETENTION_DAYS}d" "${OFFSITE_REMOTE}"

echo ""
echo "Copie hors-site terminée : ${OFFSITE_REMOTE}/${ARCHIVE}"
exit 0
