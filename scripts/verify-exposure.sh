#!/usr/bin/env bash
# ===========================================================================
# verify-exposure.sh — Critère de sortie sécurité de l'exposition (doc 24 §6)
# Usage : ./scripts/verify-exposure.sh <host> [tls_port]
#   host      : IP/nom du serveur (à lancer depuis UN AUTRE poste du LAN,
#               ou depuis un pair du tailnet — c'est de là qu'est venu AM-94)
#   tls_port  : port HTTPS historique de Caddy (défaut : 443 ; prod = 8443).
#               Il doit DÉSORMAIS être refusé lui aussi (cf. ci-dessous).
#
# ⚠️ Ce script a CHANGÉ DE VERDICT le 2026-08-17 (`AM-94`). Il attendait que le
# port TLS de Caddy RÉPONDE (« seul le web/TLS est exposé »). Or ce chemin ne
# passe pas par Cloudflare Access : la requête arrivait à la gateway SANS
# identité, et le dossier des foyers était lisible depuis le tailnet sans JWT
# (mesuré : 200 sur /api/v1/foyers). La prod ne publie donc plus AUCUN port hors
# `127.0.0.1` — Caddy compris.
#
# Résultat attendu : **rien ne répond**. Depuis une autre machine, tous les
# ports de la pile, TLS inclus, doivent être injoignables. L'application se
# joint par son URL publique (tunnel Cloudflare, authentifié par Access) ou,
# localement, par un tunnel SSH.
#
# Ce script mesure la MACHINE, là où `pnpm conteneurs` ne lit que le texte des
# composes : un conteneur déjà en marche garde les bindings de sa création, et
# un `docker run -p` à la main n'est écrit nulle part.
#
# Variables d'environnement :
#   REFUSED_PORTS  liste (séparée par des espaces) des ports qui DOIVENT être
#                  injoignables (défaut : 5433 9090 9093 3000 4200 4220 8082)
#
# Sortie non nulle si un seul contrôle échoue → utilisable en porte CI/ops.
# ===========================================================================
set -uo pipefail

HOST="${1:-}"
TLS_PORT="${2:-443}"
REFUSED_PORTS="${REFUSED_PORTS:-5433 9090 9093 3000 4200 4220 8082}"
# Port de VIE : le seul contrôle qui doit RÉUSSIR. Depuis l'inversion du verdict
# (AM-94), tous les autres attendent un refus — et « tout est refusé » est aussi
# ce que rendraient une mauvaise IP, un serveur éteint ou un filtrage de sortie.
# Sans témoin positif, le script conclurait « conforme » sans avoir rien joint.
ALIVE_PORT="${ALIVE_PORT:-22}"

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

# --- 0. Témoin de VIE : l'hôte doit être joignable ------------------------
# Sinon le reste du script ne prouve rien (cf. ALIVE_PORT ci-dessus).
printf "[VIE]  %s:%s doit RÉPONDRE (sinon rien n'est prouvé) ... " "${HOST}" "${ALIVE_PORT}"
if timeout 5 bash -c "exec 3<>/dev/tcp/${HOST}/${ALIVE_PORT}" 2>/dev/null; then
    echo "OK (joignable)"
else
    echo "ÉCHEC (hôte injoignable — mauvaise IP, serveur éteint, ou filtrage : le verdict ci-dessous serait vert PAR DÉFAUT)"
    FAILURES=$((FAILURES + 1))
fi

# --- 1. Le port TLS de Caddy DOIT être refusé (AM-94) ---------------------
# Inversion assumée : ce port servait l'application sans identité. S'il répond,
# c'est qu'un `docker compose up -d` a rouvert le trou (ou qu'un déploiement
# tourne sur un compose antérieur au correctif).
printf "[TLS]  https://%s:%s/ doit être REFUSÉ ... " "${HOST}" "${TLS_PORT}"
if curl -ksS -o /dev/null --max-time 8 "https://${HOST}:${TLS_PORT}/"; then
    echo "ÉCHEC (répond — l'app est servie hors Cloudflare Access, cf. AM-94 !)"
    FAILURES=$((FAILURES + 1))
else
    echo "OK (refusé)"
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
echo "Tous les contrôles passent — la pile n'expose RIEN hors de la loopback."
exit 0
