# shared/contracts/ — source de vérité app↔serveur
`api.openapi.yaml` (miroir), `models.ts`, `events.ts`, `api.ts`, `cache.ts` + validateurs `is*`.
Événements (`GradeCreated`, `AssignmentUpdated`, `TimetableUpdated`, `SyncCompleted`, `CacheInvalidated`).
Cache : TTL par ressource + `cacheStatus()` (badge périmé app, phase 4 #14), invalidation par événement.
Les API convertissent domaine → contrats, sans logique Pronote/métier.

Version : `CONTRACTS_VERSION` (`models.ts`) = `info.version` (`api.openapi.yaml`) = `v` des événements.
v0 (`0.1.0`, phase 1, issue #4) : notes, devoirs, EDT, appairage QR+PIN, santé, SSE.
v0.2 (`0.2.0`, issue #74) : `/v1/grades` renvoie `averages` (moyenne générale + par matière,
fournie sinon estimée, algorithme `subject`/`weighted`/`median`, historique, influence par note),
nouvelle route `/v1/periods`. **Cassant** : l'app doit ignorer `averages` avant 0.2.0.
Changement cassant = bump version + PR justificative ; `tests/contracts` impose le sync.
