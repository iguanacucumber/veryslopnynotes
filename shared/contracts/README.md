# shared/contracts/ — source de vérité app↔serveur
`api.openapi.yaml` (miroir), `models.ts`, `events.ts`, `api.ts` + validateurs `is*`.
Événements (`GradeCreated`, `AssignmentUpdated`, `TimetableUpdated`, `SyncCompleted`).
Les API convertissent domaine → contrats, sans logique Pronote/métier.

Version : `CONTRACTS_VERSION` (`models.ts`) = `info.version` (`api.openapi.yaml`) = `v` des événements.
v0 (`0.1.0`, phase 1, issue #4) : notes, devoirs, EDT, appairage QR+PIN, santé, SSE.
Changement cassant = bump version + PR justificative ; `tests/contracts` impose le sync.
