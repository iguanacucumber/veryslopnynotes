#!/usr/bin/env bash
# Crée worktree + branche (optionnel). Usage: ./agents/launch.sh <issue-n> <slug>
set -euo pipefail
N="${1:?issue requise}"; SLUG="${2:?slug requis}"
BRANCH="agent/${N}-${SLUG}"
WT="../wt-${N}-${SLUG}"
# Garde-fous locaux (hors-ligne OK). Claim distant = premier push (voir AGENTS.md § Claim).
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then echo "refus: branche locale $BRANCH existe" >&2; exit 1; fi
if [ -e "$WT" ]; then echo "refus: chemin $WT existe" >&2; exit 1; fi
git worktree add "$WT" -b "$BRANCH"
echo "worktree $WT sur $BRANCH. Puis: git push -u origin $BRANCH (= claim)."
