#!/usr/bin/env bash
# Battement de cœur vers un moniteur EXTERNE (dead man's switch) — lot A4.
# Exécuté toutes les ~5 min par creche-heartbeat.service/.timer.
#
# Pourquoi : Prometheus/Alertmanager tournent SUR la machine qu'ils surveillent →
# une panne de l'hôte (coupure, kernel panic, disque plein, réseau) = SILENCE
# total, aucune alerte. Ici la logique est INVERSÉE : un moniteur hébergé
# ailleurs (Healthchecks.io ou équivalent) attend un ping périodique et alerte
# quand les pings CESSENT. Topologie pull-based préservée : tout est SORTANT.
#
# Variables (fichier /etc/creche-heartbeat.env, HORS dépôt — cf.
# scripts/systemd/README.md et scripts/systemd/creche-heartbeat.env.example) :
#   HEARTBEAT_PING_URL    (requis)    URL de ping du check externe. SECRET :
#                                     quiconque la connaît peut « rassurer » le
#                                     moniteur pendant une vraie panne.
#   HEARTBEAT_HEALTH_URL  (optionnel) si définie, le ping n'est envoyé que si
#                                     cette URL répond 2xx (ex.
#                                     <SERVER_ORIGIN>/api/health) : le battement
#                                     atteste alors « serveur ET app OK », pas
#                                     seulement « la machine est allumée ».
#   HEARTBEAT_CA_CERT     (optionnel) CA à faire confiance pour le TLS
#                                     « internal » de Caddy sur l'URL de santé
#                                     (ex. /home/<user>/creche-planner/caddy-root.crt).
#                                     Jamais -k : confiance RÉELLE du CA.
#
# Lancement manuel (test) :
#   set -a && . /etc/creche-heartbeat.env && set +a && ./scripts/heartbeat.sh
set -euo pipefail

: "${HEARTBEAT_PING_URL:?HEARTBEAT_PING_URL manquante — cf. scripts/systemd/README.md (heartbeat)}"

# Santé applicative d'abord (si demandée) : un échec = PAS de ping → le moniteur
# externe alerte après sa période de grâce. NB : --cacert ne s'applique qu'ici
# (il REMPLACE le magasin de CA ; l'URL de ping, elle, est signée par un CA public).
verifier_sante() {
  if [ -n "${HEARTBEAT_CA_CERT:-}" ]; then
    curl -fsS -m 10 -o /dev/null --cacert "$HEARTBEAT_CA_CERT" "$HEARTBEAT_HEALTH_URL"
  else
    curl -fsS -m 10 -o /dev/null "$HEARTBEAT_HEALTH_URL"
  fi
}

if [ -n "${HEARTBEAT_HEALTH_URL:-}" ] && ! verifier_sante; then
  echo "HEARTBEAT: santé KO ($HEARTBEAT_HEALTH_URL) — ping NON envoyé, le moniteur externe alertera." >&2
  exit 1
fi

curl -fsS -m 10 --retry 3 -o /dev/null "$HEARTBEAT_PING_URL"
echo 'HEARTBEAT: ping envoyé.'
