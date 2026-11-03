## Objet

Closes #

<!-- Une issue = une branche = une PR. Explique le POURQUOI, pas seulement le quoi. -->

## Changements

-

## Vérifications

- [ ] `make check` vert (gate complet, pas `check-fast`)
- [ ] `make web-smoke` si l'interface change
- [ ] test manuel sur téléphone si le comportement natif change
- [ ] docs, invariants ou ADR mis à jour si une règle change

## Données

- [ ] Aucun secret, `.env`, session ni clé dans le diff
- [ ] Aucune donnée scolaire ni capture non caviardée
- [ ] Une faille exploitable n'est pas décrite ici (voir `SECURITY.md`)
