#!/usr/bin/env bash
# Termine une branche agent : rebase sur origin/main, check complet, push,
# corps de PR prêt pour `gh`. Usage: ./agents/ship.sh <issue-n> ["titre"]
set -euo pipefail

N="${1:?issue requise}"; shift
TITLE=""
if [ "$#" -gt 0 ]; then TITLE="$1"; shift; fi
[ "$#" -eq 0 ] || { echo "ship: argument inconnu « $1 »" >&2; exit 2; }

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BRANCH="$(git branch --show-current)"

# Un force-push n'est acceptable que sur SA propre branche d'issue.
case "$BRANCH" in
  agent/"$N"-*) ;;
  *) echo "ship: refus — branche « $BRANCH » ≠ agent/$N-*." >&2; exit 1 ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo "ship: refus — arbre sale. Commit avant ship." >&2
  exit 1
fi

git fetch origin main --prune

# Conflit = on rend la branche intacte : rien n'est poussé, rien n'est laissé
# en cours de rebase.
if ! git rebase origin/main; then
  git rebase --abort 2>/dev/null || true
  echo "ship: rebase sur origin/main impossible (conflits) — rien poussé." >&2
  exit 1
fi

# Le rebase peut changer bun.lock ; 8 ms à chaud, donc on ne devine pas.
bun install --frozen-lockfile
make check

# --force-with-lease compare au dernier remote-tracking connu (le claim ou le
# push précédent) : si un autre agent a poussé entre-temps, le push échoue au
# lieu de l'écraser. Ne PAS fetcher la branche juste avant : ça armerait le lease
# avec la valeur de l'autre agent.
git push --force-with-lease -u origin "$BRANCH"

if [ -z "$TITLE" ]; then TITLE="$(git log -1 --format=%s)"; fi
GIT_DIR="$(git rev-parse --git-dir)"
BODY="$GIT_DIR/vsn-pr-body.md"
{
  printf 'Closes #%s\n\n' "$N"
  printf '## Changements\n\n'
  git log --format='- %s' origin/main..HEAD
  printf '\n## Vérifications\n\n- `make check` : OK\n'
} > "$BODY"

printf 'ship: OK\n  branche : %s\n  titre   : %s\n  corps   : %s\n' "$BRANCH" "$TITLE" "$BODY"
printf 'gh : pr create --base main --head %s --title "%s" --body-file %s, pr merge --merge --delete-branch, issue close %s\n' \
  "$BRANCH" "$TITLE" "$BODY" "$N"
