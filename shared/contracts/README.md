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
v0.2 add-only (issue #78) : modèles `Skill`/`Evaluation`/`CompetenceSummary` (tous les champs
optionnels omis quand Pronote ne les publie pas, `note: null` = non noté) + nouvelle route
`/v1/evaluations` (compétences fournies, sinon trois listes vides) et ressource cache `evaluations`.
Invalidation = `CacheInvalidated` (resource `evaluations`), pas d'événement dédié.

Add-only #79 (mêmes versions) : route `/v1/news` (`NewsItem`), événement SSE `NewsUpdated`,
ressource cache `news` (TTL 60 min). Onglet Actualités absent côté établissement
= liste vide (200), jamais 500.
Changement cassant = bump version + PR justificative ; `tests/contracts` impose le sync.
