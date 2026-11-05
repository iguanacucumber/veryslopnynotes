# Protection de `main` — PR obligatoire, gate local

`main` n'accepte que les PR ; le gate qui autorise le merge est `make check`,
exécuté en local après rebase. Le ruleset `main — gate obligatoire` est
appliqué par `./agents/protect-main.sh` (idempotent, token avec droit admin
requis) :

```bash
./agents/protect-main.sh
```

Il pose trois règles sur `refs/heads/main` :

- **PR obligatoire** — aucun push direct, même pour un mainteneur. Zéro
  approbation requise : l'automatisme d'[ADR-005](../adr/005-rules-and-architecture.md)
  §9 tient lieu de relecture finale, avec la note de revue d'ADR-007.
- **Suppression interdite** — la branche ne peut pas être supprimée.
- **Force-push interdit** — l'historique de `main` ne se réécrit pas.

Aucun check n'est requis : [ADR-011](../adr/011-local-gate-authority.md) fait
du gate local l'unique préalable au merge. La CI joue un contrôle a
posteriori, jamais un préalable.

Aucun acteur de contournement n'est déclaré : `gh pr merge --admin` reste une
sortie explicite, jamais un défaut.

## Flux avant merge

`agents/ship.sh` crée (ou retrouve) la PR, puis :

1. fetch, rebase sur `origin/main`, note de revue liée au HEAD (ADR-007) ;
2. `make check` vert, sinon aucun push, aucune PR ;
3. `gh pr merge --merge --delete-branch --match-head-commit <sha>` fusionne
   exactement le commit relu, sans attendre la CI.

La CI rejoue le même gate sur la PR et sur `main` : elle détecte une
régression a posteriori, sans pouvoir bloquer un merge. Une telle régression
s'instruit comme un incident (AGENTS.md), pas comme un refus de porte.

Vérification côté GitHub (lecture seule) :

```bash
gh api repos/{owner}/{repo}/rulesets \
  --jq '.[] | "\(.name) [\(.enforcement)] id=\(.id)"'
gh api repos/{owner}/{repo}/rulesets/{id} \
  --jq '.rules[] | "\(.type)"'
```

Le ruleset est la source de vérité ; `branches/main/protection` peut répondre
`404` (API classique non utilisée), ce n'est pas une régression.

`tests/unit/agent-flow.test.ts` vérifie que le ruleset du script reste
« PR obligatoire + suppression et force-push interdits » : renommer ou
réintroduire une règle sans toucher le test fait rougir le gate.
