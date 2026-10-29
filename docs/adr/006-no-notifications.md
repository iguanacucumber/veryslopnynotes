# ADR-006 — pas de notifications push pour l'instant

- Statut : accepté (issue #651)
- Remplace : rien. Complète [ADR-005](005-rules-and-architecture.md).

## Contexte

La chaîne de notifications (`NotifyFormat.kt`, `GradeDiff.kt`,
`ExamDetect.detectExams`) était écrite et testée, mais sans entrée applicative :
`PeriodicSyncWorker` réécrit le cache sans comparer ni notifier, aucun
`NotificationManager`, canal ou `POST_NOTIFICATIONS` n'existe dans l'app, et
les fonctions de formatage n'ont aucun appelant de production. Les mêmes
symboles morts existaient hors notifications (`subjectAverage`,
`providedAveragesFor`, `generateGuarded`, `buildHomeworkPrompt`,
`enleverAlea`).

## Décision

**B. Supprimer.** Les notifications ne sont pas livrées dans cette version.

Sont supprimés avec leurs miroirs de test et leurs pilotes de parité :
`NotifyFormat.kt`, `GradeDiff.kt`, `detectExams` et ses constantes,
`subjectAverage`, `providedAveragesFor`, `generateGuarded`,
`buildHomeworkPrompt` (+ `SYSTEM_HOMEWORK`) et `enleverAlea`.

Sont conservés, parce qu'ils ont un appelant de production : `ExamCandidate`
(entrée de `RevisionSheet` et du pont), `localDay` (déplacé dans
`IsoDates.kt`) et `jsonStr` (déplacé dans `RevisionSheet.kt`).

## Alternatives écartées

- **A. Brancher** : aurait imposé un canal, la demande de permission au bon
  moment, un texte borné, une déduplication au redémarrage et leurs tests —
  pour une fonctionnalité P5 sans demande utilisateur.
- Garder les fichiers « pour plus tard » : c'est précisément le code mort que
  la revue 2026-10 (#638) a demandé de trancher.

## Conséquences

Aucune notification n'est émise. Pour la livrer, il faudra une nouvelle issue
avec son UX de permission et son état de déduplication ; l'historique utile
reste dans #651, les commits et cet ADR.
