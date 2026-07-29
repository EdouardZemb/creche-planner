#!/usr/bin/env bash
# Phase 11 — bootstrap serveur : installe `sops` + `age`/`age-keygen` dans
# ~/.local/bin (sans sudo, MÊME emplacement que cosign — cf. release-poll.sh qui
# enrichit déjà le PATH). Versions ÉPINGLÉES + sha256 VÉRIFIÉ (chaîne d'appro).
# Idempotent : ne réinstalle pas si la version épinglée est déjà en place.
#
# Usage : bash scripts/sops-install.sh
#
# Après installation, générer la clé age (UNE fois, voir doc 29) :
#   umask 077; mkdir -p ~/.config/sops/age
#   age-keygen -o ~/.config/sops/age/keys.txt        # clé PRIVÉE → fichier (jamais imprimée)
#   age-keygen -y ~/.config/sops/age/keys.txt        # clé PUBLIQUE (recipient .sops.yaml)
set -euo pipefail

# --- Versions + empreintes épinglées (linux/amd64) --------------------------
# Empreintes vérifiées au bootstrap (téléchargement TLS depuis les releases officielles
# getsops/sops et FiloSottile/age) — cf. docs/exploitation/29-rotation-secrets.md.
SOPS_VERSION='3.9.4'
SOPS_SHA256='5488e32bc471de7982ad895dd054bbab3ab91c417a118426134551e9626e4e85'
AGE_VERSION='1.2.1'
AGE_SHA256='7df45a6cc87d4da11cc03a539a7470c15b1041ab2b396af088fe9990f7c79d50'

BIN="$HOME/.local/bin"
mkdir -p "$BIN"

# Outils requis pour l'install elle-même.
for tool in curl sha256sum tar; do
  command -v "$tool" >/dev/null 2>&1 || { echo "sops-install: '$tool' requis." >&2; exit 1; }
done

verifier() { # <fichier> <sha256 attendu>
  local got
  got="$(sha256sum "$1" | awk '{print $1}')"
  if [ "$got" != "$2" ]; then
    echo "sops-install: empreinte sha256 INVALIDE pour $1" >&2
    echo "  attendu : $2" >&2
    echo "  obtenu  : $got" >&2
    return 1
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- sops -------------------------------------------------------------------
if command -v sops >/dev/null 2>&1 && sops --version 2>/dev/null | grep -q "$SOPS_VERSION"; then
  echo "sops $SOPS_VERSION déjà présent ($(command -v sops))."
else
  echo "Installation de sops $SOPS_VERSION → $BIN/sops"
  curl -fsSL -o "$TMP/sops" \
    "https://github.com/getsops/sops/releases/download/v${SOPS_VERSION}/sops-v${SOPS_VERSION}.linux.amd64"
  verifier "$TMP/sops" "$SOPS_SHA256"
  install -m 0755 "$TMP/sops" "$BIN/sops"
fi

# --- age + age-keygen -------------------------------------------------------
if command -v age >/dev/null 2>&1 && command -v age-keygen >/dev/null 2>&1 \
   && age --version 2>/dev/null | grep -q "$AGE_VERSION"; then
  echo "age $AGE_VERSION déjà présent ($(command -v age))."
else
  echo "Installation de age $AGE_VERSION → $BIN/{age,age-keygen}"
  curl -fsSL -o "$TMP/age.tgz" \
    "https://github.com/FiloSottile/age/releases/download/v${AGE_VERSION}/age-v${AGE_VERSION}-linux-amd64.tar.gz"
  verifier "$TMP/age.tgz" "$AGE_SHA256"
  tar -xzf "$TMP/age.tgz" -C "$TMP"
  install -m 0755 "$TMP/age/age" "$BIN/age"
  install -m 0755 "$TMP/age/age-keygen" "$BIN/age-keygen"
fi

echo
echo "OK. Vérifier que ~/.local/bin est sur le PATH (release-poll.sh/remote-* le font déjà) :"
echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
command -v sops age age-keygen
