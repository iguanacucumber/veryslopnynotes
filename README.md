# veryslopnynotes

Client Android + serveur self-hosted pour consulter son Pronote : notes et moyennes, devoirs, EDT,
vie scolaire, compétences, actualités, cantine, messagerie, profil. Le **serveur est le seul** à
parler à Pronote (IP du serveur uniquement) ; le téléphone ne connaît qu'un hôte serveur.

Surcouche IA limitée et sourcée : assistant de devoirs et fiches de révision construits à partir
de cours et manuels, avec contenu externe traité comme **donnée** et jamais comme instruction.

> Projet non affilié à Pronote / Index Éducation. Aucun asset, logo ou écran d'un autre produit :
> l'identité est propre (MIT). L'accès Pronote passe par la bibliothèque communautaire
> [`pronotets`](https://www.npmjs.com/package/pronotets) et suppose un compte et une autorisation
> de l'établissement — à toi de vérifier que cet usage est autorisé chez toi.

## État du projet

| Domaine | État |
|---|---|
| Contrats API/événements/cache (`shared/contracts/`) | Complet, versionné (`0.4.0`), miroir OpenAPI |
| Serveur : lectures Pronote, API, SSE, cache, jobs | Complet (31 routes, 7 types d'événements) |
| Client Android (Kotlin/Compose) | Complété sur les écrans principaux, offline-first, appairage QR+PIN, SSE |
| Point d'entrée HTTP serveur (`make serve`, Docker) | Câblé : env → session Pronote → reader → snapshot → routes, ports d'écriture inclus |
| Garde-fous sécurité (I1–I7) + tests | 508 tests verts, scan d'architecture et de secrets en CI locale |
| Lecture « live » d'un établissement | Mesurée sur un compte réel : notes, devoirs, EDT, périodes, actus, menus, vie scolaire, profil, capacités. Onglets non couverts par l'ENT = **vide propre** |

## Fonctionnalités

- **Notes & moyennes** — 3 algorithmes (moyenne de matière, pondérée par coefficient, médiane),
  moyenne fournie par l'établissement ou estimée, influence de chaque note, courbe d'historique,
  périodes (trimestres/semestres).
- **Devoirs** — description, contenus de cours, pièces jointes, filtre par semaine,
  **toggle « fait » écrit dans Pronote** (action confirmée dans l'app, jamais déclenchée par l'IA).
- **EDT** — vue semaine, professeur, salle, cours annulé/déplacé, badge « prochain cours »,
  bornes de semaine explicites en UTC.
- **Vie scolaire** — absences, retards, sanctions, compteurs par période.
- **Compétences** — évaluations par compétence, chips, détail note/matière ; note non rendue = `null`,
  jamais un `0` inventé, et exclue de tout calcul.
- **Actualités, cantine, messagerie** — liste de fils, réponse, création, état lu, suppression.
- **Profil & accueil** — nom, classe, période, photo **via proxy serveur**, multi-comptes parent,
  déconnexion qui purge session et cache local, mode anonyme.
- **Matières personnalisées** — couleur, emoji, libellé appliqué partout (notes, devoirs, EDT),
  thème clair/sombre.
- **Capacités dynamiques** — les onglets inactifs dans ton établissement sont masqués, pas vides-cassés.
- **Hors-ligne** — cache par ressource avec TTL et badge « périmé », repli cache si réseau KO.
- **Assistant devoirs & fiches de révision** — réponses sourcées (cours + manuels), citations
  vérifiées, export PDF, garde-fous anti-injection.
- **Alertes sécurité** — liste des injections neutralisées, pour vérifier que le contenu externe
  n'a jamais été exécuté.

## Démarrage rapide

Prérequis : [Bun](https://bun.sh) 1.4.2 (serveur) et, pour l'app, un SDK Android + JDK 17.

```bash
bun install
cp .env.example .env.local     # valeurs réelles, jamais commitées
make check                     # secrets + typecheck + unit + arch + contracts + security
make e2e                       # tests bout-en-bout (store seed, zéro réseau)
make integration               # tests d'intégration (nécessite .env.local)
make serve                     # serveur branché : lecture réelle + routes (voir PORT/HOST)
```

Client Android :

```bash
cd android
./gradlew assembleDebug        # APK debug, clé hors dépôt
```

Hôte serveur côté app : `android/local.properties` (non commité) ou env `SERVER_HOST`.
Défaut émulateur `10.0.2.2:3000` ; hors émulateur, HTTPS obligatoire.
Détails build/signature : [`android/README.md`](android/README.md) et [`docs/RELEASE.md`](docs/RELEASE.md).

## Configuration

Tout passe par `.env.local` (gitignoré). Jamais de secret en issue, PR, log ou commit.

| Variable | Rôle |
|---|---|
| `PORT` | port d'écoute du serveur |
| `HOST` | hôte d'écoute (défaut `127.0.0.1`, loopback) |
| `MEDIA_DOWNLOAD_TIMEOUT_MS` | échéance de téléchargement d'une pièce jointe via `/v1/media` |
| `MEDIA_REF_SECRET` | secret de signature des refs média (tiré au sort au démarrage si absent) |
| `PRONOTE_URL` | URL élève de l'établissement |
| `PRONOTE_USERNAME` / `PRONOTE_PASSWORD` | compte de test (jamais en CI) |
| `PRONOTE_ENT_KIND` | type ENT/CAS : `ninegate` (défaut), `educonnect`, `cas` |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | assistant devoirs + fiches de révision |
| `PUSH_PROVIDER`, `PUSH_VAPID_*` | notifications push |
| `MANUAL_PLATFORM`, `MANUAL_USERNAME`, `MANUAL_PASSWORD` | manuels, première connexion interactive |

Persistence serveur et chiffrement au repos : **pas encore câblés**. Le snapshot est mémoire
seule (`snapshot-store.ts`) — un redémarrage serveur repart vide et l'app refill au pull-refresh.
Le serveur ne lit donc ni `MASTER_KEY` ni `DATABASE_URL` : ces deux variables réapparaîtront le jour
du branchement SQLite, pas avant.

Le compte et l'URL de ton établissement sont des **apports humains** :
liste complète dans [`docs/HUMAN_INPUTS.md`](docs/HUMAN_INPUTS.md).

## Architecture

```
android/          client natif (Kotlin, Compose) : app, core, data, ui
server/
  api/            routes HTTP (Bun.serve, stdlib), validation is* des contrats
  domain/         ports + logique pure (aucun import sqlite/HTTP)
  integrations/   session Pronote, ENT/CAS, lectures, écritures confirmées
  infrastructure/ stockage, push, médias, manuels, LLM
  jobs/           sync, notifications, exams, fiches
  ai/             prompts et garde-fous (aucun outil, aucun réseau, aucun secret)
shared/contracts/ source de vérité : modèles, routes, événements, cache + OpenAPI
agents/           outillage local (scan secrets, scan architecture, worktrees)
tests/            unit, contracts, architecture, security, integration, e2e
docs/             ADR, invariants, roadmap, sécurité, release
```

Flux de lecture : `app → (hôte serveur unique) → API → PronoteReader → pronotets → PronoteHttpClient → HTTP`.
Le domaine ne connaît ni SQLite ni le framework HTTP ; chaque dépendance est un port.

### Invariants (bloquants, un test chacun)

| # | Invariant | Test |
|---|---|---|
| I1 | Android sans aucun hôte Pronote/ENT, médias par proxy serveur | `make architecture-test` |
| I2 | Un seul `PronoteHttpClient`, seul accès réseau Pronote | idem + scan de définitions |
| I3 | `server/domain/` sans SQLite ni framework HTTP | `tests/architecture` |
| I4 | Aucun secret dans les prompts LLM | `make security` + scan |
| I5 | LLM sans outils, sans réseau, sans secret | idem |
| I6 | Contenu externe = donnée bornée, délimiteurs à nonce | `tests/security/pipeline.test.ts` |
| I7 | Aucun effet de bord depuis une sortie LLM libre | tests unitaires + revue |

Détails : [`docs/architecture/INVARIANTS.md`](docs/architecture/INVARIANTS.md).

## Règles d'or

1. **Réseau** — toute requête Pronote part de l'IP du serveur, session sérialisée, User-Agent
   constant. L'app ne connaît qu'un hôte allowlist. Médias via proxy serveur, jamais de WebView distante.
2. **IA** — tout contenu non écrit par l'utilisateur est une donnée, jamais une instruction.
   Sortie LLM validée, sans outil ni effet de bord libre.
3. **Dépôt public** — pas de secret, pas d'IP/domaine, pas d'URL d'établissement, pas de donnée
   personnelle, pas de manuel ni de cours, pas de session Playwright. Fixtures synthétiques.

Le détail est verifié par `make lint` (scan de secrets) et `make architecture-test` (scan d'architecture).

## API

Toutes les routes sont déclarées dans `shared/contracts/api.ts` (contrats `0.4.0`) et mirrorées dans
`shared/contracts/api.openapi.yaml` (un test impose la synchronie). Les payloads sortent validés
par des garde-fous `is*` : une réponse invalide vaut 500 typée, jamais une donnée douteuse.

**Auth** : toute route exige l'en-tête `Authorization: Bearer <token d'appareil appairé>`, sauf
`GET /v1/health`, `POST /v1/pairing/start` et `POST /v1/pairing/confirm`. Le token sort une seule
fois, dans la réponse de `POST /v1/pairing/confirm` ; le serveur n'en conserve que `sha256(token)`
et compare en temps constant. Jeton absent, inconnu, expiré ou révoqué = un seul 401, avant toute
lecture. Une route ajoutée est donc fermée par défaut.

| Domaine | Routes |
|---|---|
| Santé, appairage (ouvertes sans jeton) | `GET /v1/health`, `POST /v1/pairing/start`, `POST /v1/pairing/confirm` |
| Notes | `GET /v1/grades` (notes + moyennes, `?algorithm=`, `?periodId=`), `GET /v1/periods` |
| Devoirs | `GET /v1/assignments` (filtres de dates/semaine), `POST /v1/assignments/toggle` |
| EDT | `GET /v1/timetable` (`?weekStart=`, `?from=`, `?to=`) |
| Vie scolaire | `GET /v1/attendance`, `GET /v1/punishments` |
| Compétences | `GET /v1/evaluations` |
| Actualités, cantine | `GET /v1/news`, `GET /v1/menus` |
| Profil & médias | `GET /v1/me`, `GET /v1/media` (réf opaque uniquement) |
| Préférences matière | `GET /v1/subjects/prefs`, `PUT /v1/subjects/prefs` |
| Messagerie | `GET|POST /v1/discussions`, `/messages`, `/recipients`, `/reply`, `/read-state`, `/delete` |
| Sync & capacités | `GET /v1/capabilities`, `POST /v1/sync/refresh`, `GET /v1/events` (SSE) |
| IA | `POST /v1/homework/generate`, `GET /v1/revision-sheets`, `GET /v1/revision-sheets/pdf` |
| Sécurité | `GET /v1/security/alerts` |

Événements SSE : `GradeCreated`, `AssignmentUpdated`, `TimetableUpdated`, `SyncCompleted`,
`CacheInvalidated`, `SecurityAlert`, `NewsUpdated`. Ressources cachables : `grades`, `assignments`,
`timetable`, `news`, `menus`, `evaluations`, `attendance`, `punishments`, `capabilities`, `discussions`.

## Tests et garde-fous

```bash
make check                  # tout : secrets, typecheck, unit, arch, contracts, security
make unit / contracts / architecture-test / security
make e2e                    # bout-en-bout sur store seed, zéro réseau
make integration            # nécessite .env.local (skip sinon)
make build                  # image Docker + rappel APK
```

508 tests, fixtures 100 % synthétiques, aucun accès réseau dans la suite par défaut.
La CI locale est `make check` : un changement qui casse un invariant est bloquant, même si
fonctionnellement il passe.

## Limitations connues

- Sans `PRONOTE_URL` (ou sans identifiants), le serveur démarre quand même : lectures vides et
  écritures en 501 plutôt qu'un `200` mensonger. La session et les identifiants vivent en mémoire,
  jamais sur disque.
- Onglets Pronote réellement publiés par l'établissement : les capacités ne sont jamais devinées,
  donc un onglet non observé vaut onglet absent et **est masqué**. Inversement, des capacités non
  déterminées (`capabilities: null`, lecture en échec) ne masquent rien.
- Le provider Pronote est en `no-go` conditionnel côté live ([`ADR-002`](docs/adr/002-pronote-provider.md)) :
  les lectures sont validées sur library + fixtures, pas sur un établissement réel.
- Non lus : solde de cantine Turboself/ARD, composition détaillée des plats, pièces jointes de
  messages, sanctions récurrentes.

## Roadmap

Phases 1→10 : architecture et ADR, provider Pronote, cœur serveur, client Android, hors-ligne et
SSE, notifications push, sécurité IA, fiches de révision, manuels, release.
Détail et dépendances : [`docs/ROADMAP.md`](docs/ROADMAP.md) · checklist produit :
[`docs/FEATURES.md`](docs/FEATURES.md).

## Contribuer

Le circuit de travail est **une issue = une branche = une PR** (`agent/<n>-<slug>`), jamais de
commit direct sur `main`. Relecture du diff + `make check` avant merge. Invariant cassant =
PR bloquante même si la fonctionnalité est correcte.

- [`AGENTS.md`](AGENTS.md) — workflow, garde-fous, règles d'or
- [`docs/CONVENTIONS_GIT.md`](docs/CONVENTIONS_GIT.md) — conventions de commits et branches
- [`docs/architecture/INVARIANTS.md`](docs/architecture/INVARIANTS.md) — les invariants I1–I7
- [`docs/adr/`](docs/adr/) — décisions d'architecture (stack, provider Pronote)

Nouvelles dépendances : justifiées dans la PR, version épinglée, licence MIT-compatible.

## Licence

MIT — voir [`LICENSE`](LICENSE). Identité et écrans propres, aucun asset tiers copié.