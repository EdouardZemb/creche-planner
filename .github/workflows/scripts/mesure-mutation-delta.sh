#!/usr/bin/env bash
# MESURE — coût réel d'un mutation testing limité au code modifié, rejoué sur une
# PR historique (SHA de base et de tête figés). Annexe de la proposition
# `docs/exploitation/proposition-ci-mutation-delta.md` : ce script MESURE, il ne juge rien et
# n'est pas un gate. À retirer avant toute fusion de la proposition.
#
# Usage : mesure-mutation-delta.sh <etiquette> <sha-base> <sha-tete> <projet-nx> <dossier-lib>
set -euo pipefail

ETIQ="$1"; BASE="$2"; TETE="$3"; PROJET="$4"; LIB="$5"
RACINE="$(pwd)"
SORTIE="${RACINE}/mesures-${ETIQ}.tsv"
: > "$SORTIE"

chrono() { # chrono <mode> <commande...> — mesure la durée murale, garde le JSON
  local mode="$1"; shift
  local t0 t1
  t0=$(date +%s.%N)
  set +e
  ( cd "${RACINE}/${LIB}" && "$@" ) > "${RACINE}/log-${ETIQ}-${mode}.txt" 2>&1
  local code=$?
  set -e
  t1=$(date +%s.%N)
  local json="${RACINE}/${LIB}/test-output/stryker/mutation.json"
  local stats="—"
  if [ -f "$json" ]; then
    stats=$(node -e '
      const r = require(process.argv[1]); const c = {};
      for (const f of Object.values(r.files)) for (const m of f.mutants) c[m.status] = (c[m.status] ?? 0) + 1;
      const tues = (c.Killed ?? 0) + (c.Timeout ?? 0);
      const juges = tues + (c.Survived ?? 0) + (c.NoCoverage ?? 0);
      const total = Object.values(c).reduce((a, b) => a + b, 0);
      console.log(`${total}\t${juges ? (100 * tues / juges).toFixed(2) : "rien à juger"}\t${JSON.stringify(c)}`);
    ' "$json")
    mv "$json" "${RACINE}/mutation-${ETIQ}-${mode}.json"
  fi
  local reutilises
  reutilises=$(sed 's/\x1b\[[0-9;]*m//g' "${RACINE}/log-${ETIQ}-${mode}.txt" | grep -oE "Incremental report:.*" | head -1 || true)
  printf '%s\t%s\t%.1f\t%s\t%s\t%s\n' "$ETIQ" "$mode" "$(awk -v a="$t0" -v b="$t1" 'BEGIN{print b-a}')" "$code" "$stats" "${reutilises:-}" | tee -a "$SORTIE"
}

preparer() { # preparer <sha> — checkout + install + build des dépendances, chronométrés à part
  local sha="$1" t0 t1
  git checkout -q --force "$sha"
  t0=$(date +%s.%N)
  pnpm install --frozen-lockfile --prefer-offline > /dev/null 2>&1
  pnpm nx run "${PROJET}:build" --outputStyle=static > /dev/null 2>&1
  t1=$(date +%s.%N)
  printf '%s\tpreparation-%s\t%.1f\t0\t—\t—\n' "$ETIQ" "${sha:0:7}" "$(awk -v a="$t0" -v b="$t1" 'BEGIN{print b-a}')" | tee -a "$SORTIE"
}

MB=$(git merge-base "$BASE" "$TETE")

# 1. Base : run complet qui PRODUIT le fichier incrémental (ce que ferait le run
#    de nuit sur main). Sa durée = coût du repli « base absente ».
preparer "$BASE"
rm -rf "${LIB}/test-output/stryker"
chrono complet-base npx stryker run --incremental --force --reporters json,clear-text

# Le fichier incrémental vit sous test-output/ (ignoré par git) : il survit au checkout.
cp "${LIB}/test-output/stryker/incremental.json" "${RACINE}/incremental-base-${ETIQ}.json"

# 2. Tête : les quatre façons de juger la PR.
preparer "$TETE"

chrono complet-tete npx stryker run --reporters json,clear-text

cp "${RACINE}/incremental-base-${ETIQ}.json" "${LIB}/test-output/stryker/incremental.json"
chrono incremental npx stryker run --incremental --reporters json,clear-text

# Fichiers source modifiés de la lib (hors specs), relatifs au dossier de la lib.
mapfile -t FICHIERS < <(git diff --name-only --diff-filter=AM "$MB" "$TETE" -- "${LIB}/src/lib" \
  | grep -E '\.ts$' | grep -vE '\.spec\.ts$' | sed "s#^${LIB}/##")
echo "fichiers modifiés : ${FICHIERS[*]:-aucun}"

if [ "${#FICHIERS[@]}" -gt 0 ]; then
  # `--mutate` prend UNE liste séparée par des virgules : répéter le drapeau ne
  # garde que le dernier (erreur de la première version de cette mesure).
  LISTE=$(IFS=,; echo "${FICHIERS[*]}")
  chrono fichiers-modifies npx stryker run --mutate "$LISTE" --reporters json,clear-text

  # Lignes modifiées : plages côté « nouveau » de chaque hunk (git diff -U0).
  PLAGES=()
  for f in "${FICHIERS[@]}"; do
    while read -r plage; do PLAGES+=("${f}:${plage}"); done < <(
      git diff -U0 "$MB" "$TETE" -- "${LIB}/${f}" | grep -E '^@@' \
        | sed -E 's/^@@ -[0-9,]+ \+([0-9]+)(,([0-9]+))? @@.*/\1 \3/' \
        | awk '{ n = ($2 == "") ? 1 : $2; if (n > 0) print $1 "-" ($1 + n - 1) }')
  done
  echo "plages : ${PLAGES[*]:-aucune}"
  if [ "${#PLAGES[@]}" -gt 0 ]; then
    LISTE=$(IFS=,; echo "${PLAGES[*]}")
    chrono lignes-modifiees npx stryker run --mutate "$LISTE" --reporters json,clear-text
  fi
fi
