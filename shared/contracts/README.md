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

Add-only #83 (pas de bump) : préférences matière `SubjectPrefs` (couleur `#RRGGBB` strict,
emoji borné, libellé perso) + `GET`/`PUT /v1/subjects/prefs`. Matière sans prefs = nom
d'origine, donc les apps 0.2.0 ignorent le champ sans régression.

Add-only #76 (pas de bump) : `TimetableEntry` + `teacher?`, `status?`
(`normal`/`cancelled`/`moved`), `originalStart?`/`originalEnd?` (cours déplacé).
Champ absent = établissement qui ne publie rien (jamais de `""` ni de `normal`
deviné) ; un payload 0.2.0 antérieur reste valide. `GET /v1/timetable` accepte
une fenêtre `weekStart` (lundi→dimanche, bornes **UTC explicites** = bug d'offset
de l'onglet EDT Papillon non reproduit) ou `from`/`to` (amplitude bornée à 14
jours) ; date illisible = 400 sans répliquer l'input. Pas de champ `weekId` :
la semaine est une requête, le « prochain cours » se calcule côté app (donnée
dérivée, pas du publié). SSE : `TimetableUpdated` (type existant) est réémis
dans le snapshot `/v1/events`, le diff de sync EDT l'émet sur cours ajouté,
annulé ou déplacé. Ressource cache `timetable` inchangée (TTL 60 min).
