# PR locale — TEMPLATE (ne pas merger tel quel)

Issue: #<n>
Branche: agent/<role>/<n>-<slug>
SHA: <head>

## REVIEW 1
head: <SHA complet 40 hex>
tests: make check → pass | fail
findings:
- [blocking|non-blocking] chemin:ligne — description

## REVIEW 2
head: <SHA complet 40 hex>
tests: make check → pass | fail
findings:
- [blocking|non-blocking] chemin:ligne — description

Décision: mergable | non-mergable (zéro blocking + make check pass + invariants OK)
Publication: `gh pr create/update + gh pr merge` seulement après 2 reviews sur SHA courant.
Toute modification après review invalide les deux reviews.
