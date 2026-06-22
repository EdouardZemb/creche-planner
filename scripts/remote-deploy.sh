#!/usr/bin/env bash
# Déclenche un déploiement de PRODUCTION traçable EN UNE COMMANDE depuis le poste
# de dev (Phase 3 du plan de déploiement, cf. docs/exploitation/24 §9.2).
#
# Le déploiement reste PULL-BASED : la topologie réseau interdit qu'un runner
# GitHub pousse en SSH (aucun port entrant ; Cloudflare Tunnel sortant ; deploy
# key git-only — doc 26 §1-2). L'événement doit NAÎTRE sur le serveur. Ce script
# se contente de DÉCLENCHER, via SSH, le geste déjà traçable côté serveur :
#
#     flock (anti-concurrence)
#       → git fetch + git pull --ff-only
#       → set -a; source .env.server; set +a
#       → IMAGE_TAG=<version> node scripts/deploy.mjs   (portes + GitHub Deployment → DORA)
#
# La traçabilité DORA est HÉRITÉE de scripts/deploy.mjs ; rien n'est poussé en
# entrant sur le serveur.
#
# ⚠️ SUR LE POSTE WINDOWS DU PROJET, UTILISER remote-deploy.ps1, PAS ce script :
# la clé SSH y est chiffrée et déchiffrée dans le SERVICE Windows ssh-agent, que
# seul le ssh.exe natif voit — le ssh de Git Bash échoue
# (« Permission denied (publickey) »). Cette variante .sh ne convient qu'à un
# opérateur Linux/Mac dont la clé est dans un agent POSIX (ssh-agent classique).
#
# Usage :
#   scripts/remote-deploy.sh <IMAGE_TAG> [options]
#
# Options :
#   --deploy-ref <ref>   Ref consigné sur le GitHub Deployment (rollback SHA brut).
#   --server <u@host>    Cible SSH (défaut : edouard@192.168.1.129).
#   --repo-path <path>   Clone serveur (défaut : /home/edouard/creche-planner).
#   -y, --yes            Saute la confirmation interactive.
#   --allow-main         Autorise le tag MUTABLE main/latest (déconseillé).
#   --skip-pull          Ne pas git pull --ff-only côté serveur avant de déployer.
#   -h, --help           Affiche cette aide.
#
# Exemples :
#   scripts/remote-deploy.sh 0.1.0
#   scripts/remote-deploy.sh 0e5e59e --deploy-ref 0e5e59e --yes      # rollback tracé
set -euo pipefail

IMAGE_TAG=""
DEPLOY_REF=""
SERVER="edouard@192.168.1.129"
REPO_PATH="/home/edouard/creche-planner"
ASSUME_YES=0
ALLOW_MAIN=0
SKIP_PULL=0

die() { echo "Erreur : $*" >&2; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --deploy-ref) DEPLOY_REF="${2:-}"; shift 2 ;;
    --server)     SERVER="${2:-}"; shift 2 ;;
    --repo-path)  REPO_PATH="${2:-}"; shift 2 ;;
    -y|--yes)     ASSUME_YES=1; shift ;;
    --allow-main) ALLOW_MAIN=1; shift ;;
    --skip-pull)  SKIP_PULL=1; shift ;;
    -h|--help)    sed -n '2,40p' "$0"; exit 0 ;;
    -*)           die "option inconnue : $1" ;;
    *)
      if [ -z "$IMAGE_TAG" ]; then IMAGE_TAG="$1"; else die "argument en trop : $1"; fi
      shift ;;
  esac
done

# --- Validation (anti-injection : valeurs interpolées dans un script bash distant)
SAFE='^[A-Za-z0-9][A-Za-z0-9._/-]*$'
[ -n "$IMAGE_TAG" ] || die "IMAGE_TAG manquant. Usage : remote-deploy.sh <IMAGE_TAG> [options]"
[[ "$IMAGE_TAG" =~ $SAFE ]] || die "IMAGE_TAG invalide : '$IMAGE_TAG'."
if [ -n "$DEPLOY_REF" ]; then
  [[ "$DEPLOY_REF" =~ $SAFE ]] || die "DEPLOY_REF invalide : '$DEPLOY_REF'."
fi
[[ "$REPO_PATH" =~ ^[A-Za-z0-9._/-]+$ ]] || die "repo-path invalide : '$REPO_PATH'."

if { [ "$IMAGE_TAG" = "main" ] || [ "$IMAGE_TAG" = "latest" ]; } && [ "$ALLOW_MAIN" -eq 0 ]; then
  die "IMAGE_TAG « $IMAGE_TAG » est MUTABLE. Déployez une version figée (ex. 0.1.0) ou passez --allow-main."
fi

# --- Construction du payload bash distant
if [ "$SKIP_PULL" -eq 1 ]; then
  PULL_BLOCK="echo 'REMOTE: --skip-pull → clone non mis a jour.'"
else
  PULL_BLOCK=$'echo \'REMOTE: git fetch + git pull --ff-only\'\ngit fetch --tags --prune origin\ngit pull --ff-only'
fi

DEPLOY_REF_ASSIGN=""
[ -n "$DEPLOY_REF" ] && DEPLOY_REF_ASSIGN="DEPLOY_REF='$DEPLOY_REF' "

REMOTE_SCRIPT=$(cat <<EOF
set -euo pipefail
export PATH="\$HOME/.local/bin:\$PATH"
cd '$REPO_PATH'

exec 9>/tmp/creche-deploy.lock
if ! flock -n 9; then
  echo 'REMOTE: un deploiement est DEJA en cours (verrou /tmp/creche-deploy.lock occupe) — abandon.' >&2
  exit 69
fi

echo "REMOTE: hote=\$(hostname) pwd=\$(pwd)"
$PULL_BLOCK

echo "REMOTE: commit du clone = \$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
set -a
. ./.env.server
set +a

echo 'REMOTE: lancement de scripts/deploy.mjs (portes + GitHub Deployment → DORA)…'
IMAGE_TAG='$IMAGE_TAG' ${DEPLOY_REF_ASSIGN}node scripts/deploy.mjs
EOF
)

B64=$(printf '%s' "$REMOTE_SCRIPT" | base64 | tr -d '\n')

# --- Récapitulatif + go/no-go humain
echo "=== creche-planner — declencheur de deploiement (Phase 3) ==="
echo "Serveur    : $SERVER"
echo "Clone      : $REPO_PATH"
echo "IMAGE_TAG  : $IMAGE_TAG"
[ -n "$DEPLOY_REF" ] && echo "DEPLOY_REF : $DEPLOY_REF"
echo "git pull   : $([ "$SKIP_PULL" -eq 1 ] && echo 'NON (--skip-pull)' || echo 'oui (ff-only)')"
echo

if [ "$ASSUME_YES" -eq 0 ]; then
  printf 'Declencher le deploiement en PRODUCTION ? [y/N] '
  read -r resp
  case "$resp" in
    y|Y|yes|YES|o|O|oui|OUI) ;;
    *) echo "Annule."; exit 0 ;;
  esac
fi

# --- Exécution distante (sortie streamée)
echo
echo "--- Sortie distante ($SERVER) ---"
echo
set +e
ssh "$SERVER" "echo $B64 | base64 -d | bash"
code=$?
set -e

echo
case "$code" in
  0)  echo "✅ Deploiement declenche avec succes (IMAGE_TAG=$IMAGE_TAG)."
      echo "   Trace DORA : gh api repos/EdouardZemb/creche-planner/deployments --jq '.[0]'" ;;
  69) echo "⏳ Abandon : un deploiement est deja en cours sur le serveur (verrou occupe)." ;;
  *)  echo "❌ Echec du deploiement (code $code) — voir la sortie distante ci-dessus." ;;
esac
exit $code
