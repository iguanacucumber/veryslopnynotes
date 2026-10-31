#!/usr/bin/env bash
# Démarre une issue : branche depuis origin/main frais, dépendances prêtes,
# claim poussé. Usage: ./agents/launch.sh <issue-n> <slug> [--in-place] [--no-push]
set -euo pipefail

N="${1:?issue requise}"; SLUG="${2:?slug requis}"; shift 2

MODE=worktree
PUSH=1
for arg in "$@"; do
  case "$arg" in
    --in-place) MODE=in-place ;;
    --no-push) PUSH=0 ;;
    *) echo "launch: option inconnue « $arg »" >&2; exit 2 ;;
  esac
done

ROOT="${VSN_ROOT:-$(git rev-parse --show-toplevel)}"
BRANCH="agent/${N}-${SLUG}"
WT="${VSN_WORKTREE_DIR:-$(dirname "$ROOT")/wt-${N}-${SLUG}}"

if [ "$MODE" = in-place ]; then
  [ -z "$(git -C "$ROOT" status --porcelain)" ] || {
    echo "launch: refus — arbre sale. Commit ou stash avant --in-place." >&2
    exit 1
  }
fi
if git -C "$ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "launch: refus — branche locale $BRANCH existe déjà." >&2
  exit 1
fi
if [ "$MODE" = worktree ] && [ -e "$WT" ]; then
  echo "launch: refus — chemin $WT existe déjà." >&2
  exit 1
fi

# Base fraîche : un worktree créé depuis un main local périmé oblige à rebaser
# plus tard (lockfile, fichier déjà pris par un autre agent).
git -C "$ROOT" fetch origin main --prune
git -C "$ROOT" rev-parse --verify --quiet origin/main >/dev/null || {
  echo "launch: refus — origin/main introuvable (remote mal configuré ?)." >&2
  exit 1
}

# Push = claim, refusé AVANT de créer : pas de worktree orphelin.
if [ "$PUSH" = 1 ] && git -C "$ROOT" ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  echo "launch: refus — $BRANCH existe déjà sur origin (claim pris)." >&2
  exit 1
fi

if [ "$MODE" = worktree ]; then
  git -C "$ROOT" worktree add "$WT" -b "$BRANCH" origin/main
  DIR="$WT"
else
  git -C "$ROOT" switch -c "$BRANCH" origin/main
  DIR="$ROOT"
fi

# 8 ms à chaud : le worktree doit être prêt à tester, pas à installer.
(cd "$DIR" && bun install --frozen-lockfile)

# local.properties est gitignoré : sans copie, android-compile SKIPpe dans
# chaque nouveau worktree.
if [ -f "$ROOT/android/local.properties" ] && [ ! -f "$DIR/android/local.properties" ]; then
  cp "$ROOT/android/local.properties" "$DIR/android/local.properties"
fi

if [ "$PUSH" = 1 ]; then
  git -C "$DIR" push --quiet -u origin "$BRANCH" || {
    echo "launch: claim non poussé — branche locale $BRANCH conservée." >&2
    exit 1
  }
fi

printf 'launch: %s sur %s (base origin/main)\n' "$DIR" "$BRANCH"
printf '  cd %s && make watch\n' "$DIR"
