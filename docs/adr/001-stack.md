# ADR-001 — stack

- Statut : accepté (issue #2)

## Décision

- Android : Kotlin natif, Gradle ; interface React/TypeScript locale dans une WebView (voir [ADR-004](004-webview.md)).
- Serveur facultatif : Bun + TypeScript strict + `Bun.serve` pour le scraper de manuels.
- Tests : `bun test` et scripts locaux ; `make check` est le contrôle complet, étapes parallèles.
- Dépendances : versions épinglées dans les manifests et `bun.lock` ; préférer stdlib et APIs natives.

L'app parle directement à Pronote ; le serveur n'est pas dans le flux de l'app
(voir [ADR-003](003-client-direct.md)). Versions et outil de release :
[`docs/RELEASE.md`](../RELEASE.md).

## Conséquences

- Toute nouvelle dépendance doit être justifiée, épinglée, auditée et compatible MIT.
- Les contrôles de `make check` doivent rester reproductibles localement.
