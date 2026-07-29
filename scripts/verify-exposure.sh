#!/usr/bin/env bash
# ===========================================================================
# verify-exposure.sh — Critère de sortie sécurité de l'exposition (doc 24 §6)
# Usage : ./scripts/verify-exposure.sh <host> [tls_port]
#   host      : IP/nom du serveur (à lancer depuis UN AUTRE poste du LAN)
#   tls_port  : port HTTPS de Caddy (défaut : 443 ; prod LAN = 8443)
#
# Résultat attendu quand la prod ne publie que Caddy (cf. doc 24 §6 :
# docker-compose.server.yml sans les ports internes) :
#   - le port TLS de Caddy RÉPOND (la SPA est servie) ;
#   - les ports API / DB / observabilité sont REFUSÉS (connexion impossible).
#
# Variables d'environnement :
#   REFUSED_PORTS  liste (séparée par des espaces) des ports qui DOIVENT être
#                  injoignables (défaut : 5433 9090 9093 3000 4200)
#
# Sortie non nulle si un seul contrôle échoue → utilisable en porte CI/ops.
# ===========================================================================
set -uo pipefail

HOST="${1:-}"
TLS_PORT="${2:-443}"
REFUSED_PORTS="${REFUSED_PORTS:-5433 9090 9093 3000 4200}"

if [ -z "${HOST}" ]; then
    echo "Usage : $0 <host> [tls_port]" >&2
    exit 2
fi

if ! command -v curl >/dev/null 2>&1; then
    echo "Erreur : curl est requis." >&2
    exit 2
fi

FAILURES=0
echo "=== Vérification d'exposition : ${HOST} ==="
echo ""

# --- 1. Le port TLS de Caddy DOIT répondre --------------------------------
printf "[TLS]  https://%s:%s/ doit répondre ... " "${HOST}" "${TLS_PORT}"
if curl -ksS -o /dev/null --max-time 8 "https://${HOST}:${TLS_PORT}/"; then
    echo "OK (répond)"
else
    echo "ÉCHEC (pas de réponse — Caddy injoignable ?)"
    FAILURES=$((FAILURES + 1))
fi

# --- 2. Les ports internes DOIVENT être refusés ---------------------------
for port in ${REFUSED_PORTS}; do
    printf "[BLOC] %s:%s doit être refusé ... " "${HOST}" "${port}"
    # On attend un échec de connexion. Un succès = fuite réseau.
    if curl -ksS -o /dev/null --max-time 5 "http://${HOST}:${port}/" 2>/dev/null; then
        echo "ÉCHEC (joignable — port exposé au LAN !)"
        FAILURES=$((FAILURES + 1))
    else
        echo "OK (refusé)"
    fi
done

echo ""
echo "=== Résumé ==="
if [ "${FAILURES}" -gt 0 ]; then
    echo "${FAILURES} contrôle(s) en échec — exposition NON conforme." >&2
    exit 1
fi
echo "Tous les contrôles passent — seul le web/TLS est exposé."
exit 0
