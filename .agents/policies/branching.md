# Politique branches
- `main` protégée, changements uniquement via PR GitHub mergée avec `gh` après 2 reviews locales.
- Branche agent : `agent/<role>/<n>-<slug>` (ex. `agent/dev-server/12-pronote-client`).
- Un worktree par agent (`agents/launch.sh`). Pas de commit direct sur `main`.
- Verrou global : première branche `agent/*/<n>-*` pushée = propriétaire de l'issue `<n>`. Doublon = prendre une autre issue (voir `AGENTS.md § Parallèle` + `.agents/CLAIMS.md`). Pas de force-push sur branche d'autrui.
