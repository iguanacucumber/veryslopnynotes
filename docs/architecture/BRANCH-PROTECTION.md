# Protection de `main` — PR et checks obligatoires

`main` n'accepte que les PR dont les checks sont verts. Le ruleset `main — gate
obligatoire` est appliqué par `./agents/protect-main.sh` (idempotent, token avec
droit admin requis) :

```bash
./agents/protect-main.sh
```

Il pose quatre règles sur `refs/heads/main` :

- **PR obligatoire** — aucun push direct, même pour un mainteneur. Zéro
  approbation requise : l'automatisme d'[ADR-005](../adr/005-rules-and-architecture.md)
  §9 tient lieu de relecture finale, avec la note de revue d'ADR-007.
- **Checks requis** — les trois jobs qui décident du merge :
  `check` et `web-smoke` (`.github/workflows/ci.yml`), `gitleaks`
  (`.github/workflows/secret-scan.yml`). Le contexte requis est le nom du job,
  pas celui du workflow. `strict` est désactivé : le rebase de `ship.sh`
  précède le push, et une `main` qui avance ne force pas à rejouer le gate de
  chaque PR.
- **Suppression interdite** — la branche ne peut pas être supprimée.
- **Force-push interdit** — l'historique de `main` ne se réécrit pas.

Aucun acteur de contournement n'est déclaré : `gh pr merge --admin` reste une
sortie explicite, jamais un défaut.

## Attente avant merge

`agents/ship.sh` crée (ou retrouve) la PR, puis :

1. `gh pr checks <pr> --watch --fail-fast` attend la fin des checks ;
2. un check rouge, annulé ou absent fait sortir `ship.sh` en erreur : **aucun
   merge** ;
3. checks verts seulement : `gh pr merge --merge --delete-branch
   --match-head-commit <sha>` fusionne exactement le commit relu.

Vérification côté GitHub (lecture seule) :

```bash
gh api repos/{owner}/{repo}/rulesets \
  --jq '.[] | "\(.name) [\(.enforcement)] id=\(.id)"'
gh api repos/{owner}/{repo}/rulesets/{id} \
  --jq '.rules[] | "\(.type) \(.parameters.required_status_checks // [] | map(.context) | join(","))"'
```

Le ruleset est la source de vérité ; `branches/main/protection` peut répondre
`404` (API classique non utilisée), ce n'est pas une régression.

`tests/unit/agent-flow.test.ts` compare les contextes ci-dessus au ruleset du
script et aux jobs des workflows : renommer un job sans toucher les deux fait
rougir le gate.
