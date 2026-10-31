#!/usr/bin/env bash
# Termine une branche agent : rebase sur origin/main, revue obligatoire, check,
# push, corps de PR prêt pour `gh`. Usage: ./agents/ship.sh <issue-n> ["titre"]
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

# Conflit = branche intacte : rien poussé, aucun rebase laissé en cours.
if ! git rebase origin/main; then
  git rebase --abort 2>/dev/null || true
  echo "ship: rebase sur origin/main impossible (conflits) — rien poussé." >&2
  exit 1
fi

# La note de revue porte sur le diff final : elle est vérifiée après rebase,
# donc contre le HEAD qui partira. Une note d'avant rebase est périmée.
GIT_DIR="$(git rev-parse --git-dir)"
REVIEW="$GIT_DIR/vsn-review.md"
HEAD_SHA="$(git rev-parse HEAD)"
if [ ! -f "$REVIEW" ]; then
  echo "ship: refus — note de revue absente ($REVIEW)." >&2
  echo "  écrire la note : 1re ligne « HEAD: $HEAD_SHA », puis le compte rendu." >&2
  exit 1
fi
if [ "$(head -n 1 "$REVIEW")" != "HEAD: $HEAD_SHA" ]; then
  echo "ship: refus — note de revue absente pour le HEAD courant ($HEAD_SHA)." >&2
  echo "  relire le diff puis réécrire $REVIEW (1re ligne « HEAD: $HEAD_SHA »)." >&2
  exit 1
fi
NOTE_BODY="$(tail -n +2 "$REVIEW")"
if [ -z "$(printf '%s' "$NOTE_BODY" | tr -d '[:space:]')" ]; then
  echo "ship: refus — note de revue vide ($REVIEW)." >&2
  exit 1
fi

# Le rebase peut changer bun.lock : on ne devine pas (8 ms à chaud).
bun install --frozen-lockfile
make check

# --force-with-lease : échoue si un autre agent a poussé entre-temps. Ne PAS
# fetcher la branche juste avant (armerait le lease avec SA valeur).
git push --force-with-lease -u origin "$BRANCH"

if [ -z "$TITLE" ]; then TITLE="$(git log -1 --format=%s)"; fi
BODY="$GIT_DIR/vsn-pr-body.md"
{
  printf 'Closes #%s\n\n' "$N"
  printf '## Changements\n\n'
  git log --format='- %s' origin/main..HEAD
  printf '\n## Revue\n\n%s\n' "$NOTE_BODY"
  printf '\n## Vérifications\n\n- `make check` : OK\n'
} > "$BODY"

printf 'ship: OK\n  branche : %s\n  titre   : %s\n  corps   : %s\n' "$BRANCH" "$TITLE" "$BODY"
printf 'gh : pr create --base main --head %s --title "%s" --body-file %s, pr merge --merge --delete-branch, issue close %s\n' \
  "$BRANCH" "$TITLE" "$BODY" "$N"
