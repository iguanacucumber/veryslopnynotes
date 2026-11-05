# ADR-011 — le gate local fait autorité pour le merge

- Statut : accepté (issue #1157)
- Amende : [ADR-005](005-rules-and-architecture.md), §9. Aucun ADR n'est
  remplacé.

## Contexte

ADR-005 §9 exige que `ship.sh` attende vert les checks GitHub de la PR avant le
merge. La CI rejoue exactement `make check`, qui tourne pourtant déjà en local
après rebase. L'attente n'ajoute aucune preuve : elle renouvelle le contrôle
sans inspecter autre chose.

Le ruleset de `main` exigeait en plus `check`, `web-smoke` et `gitleaks`. Tant
qu'il les exige, GitHub refuse le merge : le gate local reste le seul contrôle
pertinent, mais le merge se bloque sur une CI redondante, non attendue.

## Décision

- `ship.sh` fusionne la PR après `make check` vert, sans attendre la CI.
- Le ruleset de `main` cesse d'exiger des checks : il garde la PR obligatoire,
  la suppression et le force-push interdits, zéro approbation requise.
- La CI continue de tourner sur les PR et sur `main` : vérification a
  posteriori, jamais un préalable au merge.
- `gitleaks` continue de scanner l'historique sur chaque PR et sur `main` ;
  il ne bloque plus le merge.

## Alternatives rejetées

- **Garder `gh pr checks --watch`** : c'est la redondance qui motive cette
  issue. Rejeté.
- **Fusionner avec `--admin` en contournant le ruleset** : un contournement
  passe en silence et se banalise. Rejeté.
- **Garder le ruleset et attendre quand même la CI** : réinscrit l'attente que
  cette décision supprime. Rejeté.
- **Alléger `make check` pour la CI** : interdit par ADR-005 §8. Rejeté.

## Conséquences

- Le merge ne peut pas être bloqué par un échec ou une absence de CI ; il l'est
  uniquement par un `make check` rouge, la revue du HEAD (ADR-007) ou un échec
  de push/merge.
- Une régression détectée par la CI a posteriori n'empêche pas le merge : elle
  s'instruit comme un incident (AGENTS.md), pas comme un refus de porte.
- Le ruleset reste la source de vérité de la protection de `main` ;
  `agents/protect-main.sh` réapplique sa forme allégée.
- Loi 5 (« le gate est l'autorité ») inchangée : le gate est `make check`.

## Risques

- Une régression ne bloquant pas le merge entre sur `main` si `make check`
  passe mais la CI échouerait autrement. La CI rejoue le même contrôle sans
  variation d'environnement connue ; un écart s'instruit comme incident.
