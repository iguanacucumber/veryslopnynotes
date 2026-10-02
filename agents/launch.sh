#!/usr/bin/env bash
# Lance un agent local sur une issue : crée worktree + branche.
# Usage: ./agents/launch.sh <role> <issue-n> <slug>
set -euo pipefail
ROLE="${1:?role requis}"; N="${2:?issue requise}"; SLUG="${3:?slug requis}"
BRANCH="agent/${ROLE}/${N}-${SLUG}"
WT="../wt-${N}-${SLUG}"
# Garde-fous parallèle : refuse si branche/worktree/claim existent déjà.
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then echo "refus: branche locale $BRANCH existe" >&2; exit 1; fi
if git worktree list --porcelain | grep -q "^branch refs/heads/$BRANCH\$"; then echo "refus: worktree sur $BRANCH existe" >&2; exit 1; fi
if [ -e "$WT" ]; then echo "refus: chemin $WT existe" >&2; exit 1; fi
if git ls-remote --heads origin "agent/*/${N}-*" | grep -q .; then echo "refus: issue #$N déjà claimée (branche agent/*/${N}-* distante)" >&2; exit 1; fi
git worktree add "$WT" -b "$BRANCH"
echo "worktree $WT sur $BRANCH. CLAIM en <60s : gh issue comment $N --body \"CLAIM $BRANCH\" + self-assign + ligne .agents/CLAIMS.md + push branche. Lire AGENTS.md § Parallèle + top issue #35."
