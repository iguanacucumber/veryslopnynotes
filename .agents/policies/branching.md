# Politique branches
- `main` protégée, changements uniquement via PR GitHub mergée avec `gh` après 2 reviews locales.
- Branche agent : `agent/<role>/<n>-<slug>` (ex. `agent/dev-server/12-pronote-client`).
- Un worktree par agent (`agents/launch.sh`). Pas de commit direct sur `main`.
