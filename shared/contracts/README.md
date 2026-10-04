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

v0.3 (`0.3.0`, issues #78 #79 #81 #83) : vague de parité add-only. Les contrats
existants ne changent pas de forme, seul le jeu de routes et de ressources cache
grandit. **Non cassant** pour les apps 0.2.0 : elles ignorent les nouvelles ressources.

Add-only #83 (v0.3) : préférences matière `SubjectPrefs` (couleur `#RRGGBB` strict,
emoji borné, libellé perso) + `GET`/`PUT /v1/subjects/prefs`. Matière sans prefs = nom
d'origine, donc les apps 0.2.0 ignorent le champ sans régression.

v0.4 (`0.4.0`) : `PairingConfirmResponse` = `{ device: Device, token: string }`.
Le token d'appareil en clair sort **UNE SEULE FOIS**, dans la réponse de
`POST /v1/pairing/confirm` ; le serveur ne conserve que `sha256(token)`
(`Device.tokenHash`) et ne le re-servit jamais. `isPairingConfirmResponse` valide
`device` via `isDevice` + `token` borné non vide (`PAIRING_TOKEN_MAX_CHARS`).
**Cassant** : champ requis de plus sur `/v1/pairing/confirm`, et les routes qui
exigent un credential(`/v1/media`, `/v1/assignments/toggle`) renvoient 401 à une
app 0.3.0 — qui ne connaît que `{ id, tokenHash }` et ne peut donc présenter aucun
bearer. Secret jamais journalisé, jamais persisté en clair, jamais dans un
`toJSON` ; un secret perdu = ré-appairage.

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


Add-only #75 (mêmes versions) : `Assignment` enrichi (`description?`, `lessonContent?`,
`attachments?: AttachmentRef[]`, `periodId?`, `weekId?` — tous omis quand l'établissement
ne les publie pas), filtre de fenêtre `GET /v1/assignments?weekStart=` ou `?from=&to=`
(400 sur date illisible, sans reflet de l'input), `POST /v1/assignments/toggle`
(écriture Pronote = **action APP confirmée uniquement**, I7 ; 401 session expirée,
409 devoir introuvable, 501 écriture non supportée) et `GET /v1/media?accountId=&ref=`
(proxy des pièces jointes). `AttachmentRef.ref` est une référence **opaque** : le
validateur refuse `http://`, `https://`, `//`, `data:` et `\\` — l'app n'a jamais d'URL
Pronote (I1, règle d'or média). Le toggle renvoie l'**événement existant**
`AssignmentUpdated` (aucun nouveau type d'événement) pour l'invalidation de cache.


Add-only #77 (pas de bump) : vie scolaire — `AbsenceRecord` (absences ET retards unifiés
par `kind: "absence" | "late"`, motif borné 500), `Punishment` (motif + type requis,
gravité optionnelle), `AttendancePeriod` (compteurs dérivés par période) + routes
`/v1/attendance` et `/v1/punishments`, ressources cache `attendance`/`punishments`
(TTL 60 min). Onglet vie scolaire inactif côté établissement = listes vides (200),
jamais 500. Invalidation = `CacheInvalidated` (resource `attendance`), pas d'événement
dédié ; la détection de nouvelle absence se fait sur comparaison de données structurées
(`newAbsences` dans `server/jobs/notify.ts`), jamais sur une sortie LLM (I7).


Add-only #82 (pas de bump) : `UserInfo` (+`ChildAccount`) et `GET /v1/me` (`user: null` =
infos non publiées, aucun nom inventé), plus `GET /v1/media` : résolution serveur d'une
**réf opaque** (`photo:<id>`), une URL dans `photoRef` est rejetée par `isUserInfo` (I1,
règle d'or média). `profile`/`me` n'est PAS une ressource cachable : le profil reste en
mémoire côté app (mode anonyme, aucune donnée personnelle persistée).
Les périodes de l'année restent sur `/v1/periods` (#74) — pas de doublon.


Add-only #87 (pas de bump) : **capacités dynamiques** — `Capabilities` (`accountId`,
`tabs`, `fetchedAt`) + `TabCapability` (dix onglets Pronote : `grades`, `homework`,
`timetable`, `evaluations`, `news`, `menus`, `attendance`, `punishments`,
`discussions`, `profile`) et `GET /v1/capabilities`. Onglet absent de la liste =
capacité `false` (l'app masque l'entrée, écran avec état vide propre) ; un onglet
non observé n'est **jamais** déduit actif, et un onglet absent chez l'établissement
n'est pas une erreur de lecture. `capabilities: null` = capacités non déterminées
(session absente, adaptateur sans détection) : l'app ne masque alors rien.
Ressource cache `capabilities` (TTL 24 h), invalidée par `CacheInvalidated`
(existant, pas d'événement dédié) — le snapshot `/v1/events` reste à trois
enveloppes. Also `POST /v1/sync/refresh` (pull-refresh app → serveur → Pronote,
lecture bornée, sans LLM : I7) qui renvoie **les types d'événements existants**
(`GradeCreated`, `TimetableUpdated`, `SyncCompleted`, `CacheInvalidated`), donc
aucun type novel et une app 0.3.0 comprend déjà la réponse. Le flux `/v1/events`
est un snapshot **borné** : une écriture puis fermeture (plus de connexion tenue
sans rien émettre). Refresh de session côté serveur : TTL 5 min, renewal
sérialisée par compte, timeout 10 s, retry ≤ 1 (`server/integrations/session-refresh.ts`).


Add-only #80 (mêmes versions, pas de bump) : messagerie — `Recipient`
(`student`/`teacher`/`administration`), `Message` (corps **borné 4000**,
`attachments?` en réf opaque comme les PJ #75) et `Discussion` (`participants`,
`unreadCount?`, `lastMessageAt?`, `updatedAt`). Lectures : `GET /v1/discussions`,
`GET /v1/discussions/messages?id=`, `GET /v1/discussions/recipients` — onglet
Discussions inactif côté établissement = listes **vides** (200), jamais 500.
Écritures : `POST /v1/discussions` (créer), `/reply`, `/read-state`, `/delete` —
**actions APP CONFIRMÉES uniquement** (I7) : corps borné avant parse, `is*Request`,
erreurs `not_implemented`/`unauthorized`/`conflict`, et **jamais de faux succès**.
`delete` est un POST (le contrat `ApiRoute` n'accepte que GET/POST/PUT).
SSE : **aucun type d'événement nouveau** — l'invalidation de cache est
`CacheInvalidated` (resource `discussions`), renvoyé dans la réponse des 4
actions. Ressource cache `discussions` = **liste des fils seulement** (TTL 15 min,
donnée personnelle purgée au logout par le `clearAll()` global #82) ; les messages
d'un fil sont lus à la demande et **jamais** écrits sur disque.
I6 : le corps d'un message est une DONNÉE bornée — jamais exécutée, jamais
interprétée, jamais remise à un LLM (test I7 dans `tests/unit/discussions.test.ts`).

**Cassant 0.6.0** : le type de portail d'établissement sort du contrat.
`SetupRequest.ent` **disparu** (une app 0.5.0 qui l'envoie est ignorée, son setup
marche toujours) et le code d'erreur `ent_unreachable` (502) devient
**`school_unreachable`** — là c'est cassant pour de vrai : une app 0.5.0 lit ce
502 comme un code inconnu et n'affiche donc aucune phrase actionnable.

**Cassant 0.7.0** : **zéro credential côté serveur**. Le serveur ne lit plus
aucune variable d'environnement de secret (`PORT`/`HOST` restent les seules
lues). `SetupRequest` devient **QR-only** : `qr` + `pin` sont requis, plus de
`username`/`password` (une app 0.6.0 se voit refuser en 400 — elle n'a plus
aucune méthode accepted). `HomeworkGenerateRequest` porte la clé LLM de
l'appelant (`apiKey`, `writeOnly`, bornée 512) : elle est vérifiée à la
frontière, part dans l'en-tête `Authorization` de l'appel fournisseur, et n'est
ni journalisée ni persistée. Conséquences assumées : `MEDIA_REF_SECRET` tirée au
sort à chaque boot (les `ref` média meurent au redémarrage), push non configuré
(pas de clé VAPID), scraping de manuels désactivé.
