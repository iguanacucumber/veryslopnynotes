# ADR-007 — revue de code obligatoire avant ship

- Statut : accepté (issue #753)
- Amende : [ADR-005](005-rules-and-architecture.md), §9. Aucun ADR n'est
  remplacé.

## Contexte

ADR-005 §9 fait du gate la relecture finale et autorise le merge automatique
sans attente humaine. `make check` vérifie que le code tient ses invariants ;
il ne juge ni le périmètre du diff (une modification hors issue passe) ni sa
lisibilité (un diff correct mais illisible passe aussi). Rien n'obligeait
l'agent à relire son propre travail avant `ship.sh` : le gate validait, puis la
PR partait.

Une relecture humaine avant chaque merge contredirait l'automatisme d'ADR-005
§9. Il manquait donc une trace de relecture produite par l'agent, vérifiable
par l'outillage, et visible dans la PR.

## Décision

Avant `ship.sh`, l'agent relit le diff `origin/main...HEAD` sur deux axes :

1. **Spec** — chaque critère d'acceptation de l'issue est couvert, rien
   d'étranger au périmètre n'a été ajouté ;
2. **Standards** — les règles du dépôt (lois, ADR, conventions de nommage et de
   commentaires) sont respectées.

La relecture s'écrit dans `$GIT_DIR/vsn-review.md` :

```
HEAD: <sha du commit relu>
## Standards
...
## Spec
...
```

`ship.sh` vérifie la note **après** le rebase sur `origin/main`, contre le HEAD
qui sera poussé. Une note absente, vide ou liée à un autre commit fait échouer
le ship avant `make check` et avant tout push. La note est recopiée telle quelle
dans le corps de PR sous `## Revue`.

Un rebase change le HEAD : la note devient périmée et le ship refuse. C'est
voulu — la relecture porte sur le diff final, pas sur celui d'avant rebase.
L'agent relit le diff rebasé puis relance `ship.sh`, dont le rebase est alors
un no-op.

La note vit dans le répertoire Git du worktree : elle n'est ni commitée ni
poussée, seul son contenu arrive dans la PR.

## Alternatives rejetées

- **Garder le gate seul** : c'est l'état qui a motivé l'issue ; le gate ne voit
  ni le périmètre ni la lisibilité. Rejeté.
- **Note dans un commentaire de PR** : exige un push avant validation, et rien
  ne relie le commentaire au commit relu. Rejeté.
- **`git notes`** : natif, mais un rebase perd la note et le ref n'est pas
  poussé par défaut, sans gain sur un fichier du répertoire Git. Rejeté.
- **Approbation humaine obligatoire** : contredit ADR-005 §9 et la boucle
  automatique. Rejeté.

## Conséquences

- Le corps de PR expose la relecture : un agent ou un humain peut la contester.
- Une note d'un autre HEAD bloque le ship ; le message donne le SHA attendu.
- Aucune étape ajoutée au gate, aucun nouvel invariant : la règle est portée
  par `ship.sh` et couverte par `tests/unit/agent-flow.test.ts`.
- La relecture reste un jugement, pas une preuve ; elle rend le travail visible
  au lieu de le garantir.

## Risques

- **Note de complaisance** (« rien à signaler ») : deux axes explicites et un
  corps de PR public rendent la paresse visible, sans l'empêcher.
- **Friction après rebase** : relire à nouveau coûte du temps. Le refus est
  volontaire, car pousser un diff non relu annulerait la décision.
