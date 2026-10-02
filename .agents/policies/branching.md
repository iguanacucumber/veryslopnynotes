# Politique branches
- `main` protégée, changements via PR `gh` après review locale. Pas de commit direct, pas de force-push sur branche d'autrui.
- Branche : `agent/<n>-<slug>`. Push = claim (vérif : `git fetch origin && git branch -r | grep '/<n>-'`).
