#!/usr/bin/env bash
# Lance un agent local sur une issue : crée worktree + branche.
# Usage: ./agents/launch.sh <role> <issue-n> <slug>
set -euo pipefail
ROLE="${1:?role requis}"; N="${2:?issue requise}"; SLUG="${3:?slug requis}"
BRANCH="agent/${ROLE}/${N}-${SLUG}"
WT="../wt-${N}-${SLUG}"
git worktree add "$WT" -b "$BRANCH"
echo "worktree $WT sur $BRANCH. Lire AGENTS.md + .agents/roles/${ROLE}.md depuis branche référence."
