#!/usr/bin/env bash
# Applique le ruleset de `main` : PR obligatoire, suppression et force-push
# interdits. Le gate local fait autorité, aucun check requis (ADR-011).
# Usage: ./agents/protect-main.sh
set -euo pipefail

REPO="${VSN_REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
NAME="main — gate obligatoire"

RULESET="$(cat <<'JSON'
{
  "name": "main — gate obligatoire",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "require_extra_approval_for_unattributed_changes": false,
        "required_review_thread_resolution": false
      }
    }
  ]
}
JSON
)"

ID="$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$NAME\") | .id" 2>/dev/null || true)"
if [ -n "$ID" ]; then
  if ! gh api --method PUT "repos/$REPO/rulesets/$ID" --input - >/dev/null <<<"$RULESET"; then
    echo "protect-main: ÉCHEC — token sans droit admin sur $REPO ?" >&2
    exit 1
  fi
  echo "protect-main: ruleset « $NAME » mis à jour sur $REPO."
else
  if ! gh api --method POST "repos/$REPO/rulesets" --input - >/dev/null <<<"$RULESET"; then
    echo "protect-main: ÉCHEC — token sans droit admin sur $REPO ?" >&2
    exit 1
  fi
  echo "protect-main: ruleset « $NAME » créé sur $REPO."
fi

gh api "repos/$REPO/rulesets" --jq '.[] | "  \(.name) [\(.enforcement)] id=\(.id)"'
