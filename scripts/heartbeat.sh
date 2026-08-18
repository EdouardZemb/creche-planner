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
#                                     cette URL répond **2xx** : le battement
#                                     atteste alors « serveur ET app OK », pas
#                                     seulement « machine allumée ». Viser une
#                                     origine LOOPBACK qui atteint réellement
#                                     l'app (`http://127.0.0.1:4220/...`), pas
#                                     le domaine public : cf. « Le piège du
#                                     302 » ci-dessous.
#                                     ⚠️ LIVENESS, pas readiness : depuis le lot
#                                     B3 la readiness gateway agrège ses 5
#                                     amonts — la viser ici ferait taire le
#                                     battement au moindre amont dégradé, donc
#                                     une alerte externe indiscernable d'une
#                                     panne d'hôte (le seul cas que ce moniteur
#                                     détecte seul). Amont dégradé = Prometheus.
#   HEARTBEAT_CA_CERT     (optionnel) CA à faire confiance pour le TLS
#                                     « internal » de Caddy sur l'URL de santé.
#                                     Jamais -k : confiance RÉELLE du CA.
#   HEARTBEAT_ETAT_DIR    (optionnel) où mémoriser l'armement de la sonde.
#                                     Défaut : $STATE_DIRECTORY (fourni par
#                                     `StateDirectory=` de l'unité systemd),
#                                     sinon /var/lib/creche-heartbeat.
#
# ---------------------------------------------------------------------------
# LE PIÈGE DU 302 (mesuré le 2026-08-18, cf. AM-100/LE-78)
# ---------------------------------------------------------------------------
# La jauge visait `https://creche.testlens.dev/api/health`. Cette URL est
# derrière Cloudflare Access, qui répond **302** vers sa page de login SANS
# jamais toucher l'origine. Or `curl -f` ne fâche qu'à partir de 400 : le 302
# sortait en code 0, la jauge passait, et le battement attestait « Access
# répond » — jamais « l'app répond ». Le dead man's switch aurait continué de
# rassurer le moniteur avec l'application entièrement morte.
# D'où, ici : on lit le **code HTTP** et on exige un 2xx. Un 3xx est refusé
# nommément, parce qu'il ne signifie qu'une chose — on parle à un portail, pas
# à l'application.
#
# ---------------------------------------------------------------------------
# ARMEMENT DE LA SONDE (avant / après le déploiement de la PR #345)
# ---------------------------------------------------------------------------
# La cible loopback `127.0.0.1:4220` est publiée par `docker-compose.server.yml`
# depuis la PR #345 : elle n'existe donc PAS sur une prod qui n'a pas encore
# reçu ce déploiement. On ne peut pas non plus tolérer un port absent pour
# toujours : si toute la pile tombe, docker-proxy disparaît et « port absent »
# deviendrait indiscernable d'une panne totale — exactement le silence que ce
# moniteur existe pour empêcher.
# D'où un **cliquet** : tant que la sonde n'a JAMAIS répondu 2xx, un port
# injoignable (curl 7) est toléré et le battement continue en mode dégradé
# « machine seule », bruyamment journalisé. Au premier 2xx la sonde est
# **armée** de façon persistante, et dès lors toute défaillance — y compris un
# port disparu — coupe le battement. Le durcissement se fait donc tout seul au
# déploiement, sans geste ni fenêtre d'oubli.
# La tolérance est elle-même conditionnée à la MÉMOIRE : si le répertoire d'état
# n'est pas utilisable, on ne tolère rien (sans mémoire, l'indulgence n'a pas de
# fin et couvrirait une panne totale).
#
# Lancement manuel (test) :
#   set -a && . /etc/creche-heartbeat.env && set +a && ./scripts/heartbeat.sh
set -euo pipefail

: "${HEARTBEAT_PING_URL:?HEARTBEAT_PING_URL manquante — cf. scripts/systemd/README.md (heartbeat)}"

ETAT_DIR="${HEARTBEAT_ETAT_DIR:-${STATE_DIRECTORY:-/var/lib/creche-heartbeat}}"
TEMOIN_ARMEE="$ETAT_DIR/sonde-armee"

# `--retry-all-errors` (curl ≥ 7.71) étend les tentatives aux erreurs que
# `--retry` seul ignore — dont l'échec de RÉSOLUTION DNS (curl 6). Sans lui, un
# clignotement du résolveur suffit à faire manquer un battement, et un seul
# battement manqué dépasse déjà period+grace côté moniteur (5 min + 5 min) :
# c'est ce qui a produit de faux « DOWN » les 17 et 18/08 (LE-79).
#
# La fenêtre doit couvrir la panne visée, pas la symboliser : un échec DNS
# revient INSTANTANÉMENT (pas de timeout), donc la durée couverte est celle des
# pauses seules. Les coupures mesurées durent ~25 s → 5 tentatives espacées de
# 10 s couvrent ~50 s. Le pire cas (chaque essai jusqu'au bout des -m 10) reste
# très en deçà des 5 min du timer, et `Type=oneshot` n'impose pas de
# TimeoutStartSec par défaut.
RETENTE=(--retry 5 --retry-delay 10)
# La garde évite un échec DUR sur un curl ancien : l'option inconnue ferait
# sortir curl en 2 et tuerait le battement entier — soit exactement la panne
# qu'on prétend éviter.
if curl --help all 2>/dev/null | grep -q -- '--retry-all-errors'; then
  RETENTE+=(--retry-all-errors)
else
  echo "HEARTBEAT: curl sans --retry-all-errors (< 7.71) — un clignotement DNS ne sera pas rattrapé." >&2
fi

sonde_armee() { [ -f "$TEMOIN_ARMEE" ]; }

memoire_utilisable() { mkdir -p "$ETAT_DIR" 2>/dev/null && [ -w "$ETAT_DIR" ]; }

armer_sonde() {
  if sonde_armee; then return 0; fi
  if memoire_utilisable && : > "$TEMOIN_ARMEE" 2>/dev/null; then
    echo "HEARTBEAT: sonde applicative ARMÉE ($HEARTBEAT_HEALTH_URL) — toute défaillance coupera désormais le battement."
  else
    echo "HEARTBEAT: sonde OK mais armement NON mémorisable dans $ETAT_DIR — le battement resterait indulgent. Réinstaller l'unité (elle porte StateDirectory=) : sudo cp scripts/systemd/creche-heartbeat.service /etc/systemd/system/ && sudo systemctl daemon-reload" >&2
  fi
}

# Écrit le code HTTP sur stdout ; le code de sortie est celui de curl.
# `-s` sans `-S` : c'est NOUS qui diagnostiquons (code HTTP + code curl, avec le
# sens de la panne). Laisser curl écrire les siens en plus noierait le journal
# sous quatre lignes identiques par tentative, à chaque passage de 5 min.
interroger_sante() {
  if [ -n "${HEARTBEAT_CA_CERT:-}" ]; then
    curl -s -m 10 "${RETENTE[@]}" -o /dev/null -w '%{http_code}' \
      --cacert "$HEARTBEAT_CA_CERT" "$HEARTBEAT_HEALTH_URL"
  else
    curl -s -m 10 "${RETENTE[@]}" -o /dev/null -w '%{http_code}' "$HEARTBEAT_HEALTH_URL"
  fi
}

# 0 = la jauge passe (ou est absente) ; 1 = elle refuse, pas de ping.
verifier_sante() {
  [ -n "${HEARTBEAT_HEALTH_URL:-}" ] || return 0

  local code sortie
  set +e
  code="$(interroger_sante)"
  sortie=$?
  set -e

  case "$code" in
    2??)
      armer_sonde
      return 0
      ;;
    3??)
      echo "HEARTBEAT: santé KO ($HEARTBEAT_HEALTH_URL) — HTTP $code. Un 3xx ne prouve RIEN sur l'app : c'est un portail (Cloudflare Access) qui répond à sa place. Viser une origine loopback." >&2
      return 1
      ;;
  esac

  if [ "$sortie" -eq 7 ] && ! sonde_armee; then
    # La tolérance ne vaut QUE si l'on saura se souvenir d'en sortir. Sans
    # mémoire (unité installée sans StateDirectory=, répertoire non
    # inscriptible), « port jamais publié » et « pile entièrement tombée »
    # redeviennent indiscernables, et l'indulgence s'installe pour toujours :
    # le moniteur resterait vert pendant la panne totale. On refuse, bruyamment.
    if ! memoire_utilisable; then
      echo "HEARTBEAT: sonde injoignable ET mémoire d'armement inutilisable ($ETAT_DIR) — refus de tolérer, car sans elle une panne totale serait prise pour un port jamais publié. Réinstaller l'unité : sudo cp scripts/systemd/creche-heartbeat.service /etc/systemd/system/ && sudo systemctl daemon-reload" >&2
      return 1
    fi
    echo "HEARTBEAT: sonde applicative injoignable ($HEARTBEAT_HEALTH_URL) et JAMAIS armée — port pas encore publié (PR #345 non déployée ?). Battement DÉGRADÉ : il n'atteste que « machine allumée »." >&2
    return 0
  fi

  echo "HEARTBEAT: santé KO ($HEARTBEAT_HEALTH_URL) — curl $sortie, HTTP $code — ping NON envoyé, le moniteur externe alertera." >&2
  return 1
}

verifier_sante || exit 1

curl -fsS -m 10 "${RETENTE[@]}" -o /dev/null "$HEARTBEAT_PING_URL"
echo 'HEARTBEAT: ping envoyé.'
