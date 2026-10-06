# veryslopnynotes

Client Android + serveur self-hosted pour consulter son Pronote : notes et moyennes, devoirs, EDT,
vie scolaire, actualités, cantine, messagerie, profil. Le **serveur est le seul** à parler à
Pronote (IP du serveur uniquement) ; le téléphone ne connaît qu'un hôte serveur.

Surcouche IA limitée et sourcée : assistant de devoirs et fiches de révision construits à partir
de cours et manuels, avec contenu externe traité comme **donnée** et jamais comme instruction.

> Projet non affilié à Pronote / Index Éducation. Aucun asset, logo ou écran d'un autre produit :
> l'identité est propre (MIT). L'accès Pronote passe par la bibliothèque communautaire
> [`pronotets`](https://www.npmjs.com/package/pronotets) et suppose un compte et une autorisation
> de l'établissement — à toi de vérifier que cet usage est autorisé chez toi.

## État du projet

| Domaine | État |
|---|---|
| Contrats API/événements/cache (`shared/contracts/`) | Complet, versionné (`0.8.0`), miroir OpenAPI |
| Serveur : lectures Pronote, API, SSE, cache, jobs | Complet (31 routes, 7 types d'événements) |
| Client Android (Kotlin/Compose) | Complété sur les écrans principaux, offline-first, assistant de connexion en 3 étapes (serveur → établissement → QR scanné + PIN), SSE, aide devoirs |
| Point d'entrée HTTP serveur (`make runServer`, Docker) | Câblé : setup (QR de l'app) → session Pronote → reader → snapshot → routes, ports d'écriture inclus. **Zéro credential serveur** |
| Garde-fous sécurité (I1–I8) + tests | 795 tests verts dans `make check`, scan d'architecture et de secrets en CI locale |
| Lecture « live » d'un établissement | Mesurée sur un compte réel : notes, devoirs, EDT, périodes, actus, menus, vie scolaire, profil, capacités. Onglets non couverts par l'établissement = **vide propre** |

## Fonctionnalités

- **Notes & moyennes** — 3 algorithmes (moyenne de matière, pondérée par coefficient, médiane),
  moyenne lue dans le bulletin publié par l'établissement (`/20`, par période) sinon estimée,
  influence de chaque note, courbe d'historique, périodes (trimestres/semestres).
- **Devoirs** — description, contenus de cours, pièces jointes, filtre par semaine,
  **toggle « fait » écrit dans Pronote** (action confirmée dans l'app, jamais déclenchée par l'IA).
- **Aide devoirs (IA)** — bouton par devoir : corrigé sourcé ou refus motivé, sources = la
  consigne et l'extrait de cours du devoir. La clé du fournisseur se saisit dans les réglages de
  l'app (chiffrée) et part dans le corps de chaque demande : le serveur n'en détient aucune.
- **Cours** (EDT) — vue semaine, professeur, salle, cours annulé/déplacé, badge « prochain cours »,
  bornes de semaine explicites en UTC.
- **Vie scolaire** — absences, retards, sanctions, compteurs par période.
- **Actualités, cantine, messagerie** — liste de fils, réponse, création, état lu, suppression.
- **Profil & accueil** — nom, classe, période, photo **via proxy serveur**, multi-comptes parent,
  déconnexion qui purge session et cache local, mode anonyme.
- **Matières personnalisées** — couleur, emoji, libellé appliqué partout (notes, devoirs, cours),
  thème clair/sombre.
- **Capacités dynamiques** — les onglets inactifs dans ton établissement sont masqués, pas vides-cassés.
- **Hors-ligne** — cache par ressource avec TTL et badge « périmé », repli cache si réseau KO.
- **Assistant devoirs & fiches de révision** — réponses sourcées (cours + manuels), citations
  vérifiées, export PDF, garde-fous anti-injection.
- **Alertes sécurité** — liste des injections neutralisées, pour vérifier que le contenu externe
  n'a jamais été exécuté.

## Démarrage rapide

Prérequis : [Bun](https://bun.sh) 1.4.2 (serveur) et, pour l'app, un SDK Android + un
JDK 17-21 (Gradle 8.7 refuse un JDK plus récent).

```bash
bun install
make check                     # secrets + typecheck + unit + arch + contracts + security + compile Kotlin
make e2e                       # tests bout-en-bout (store seed, zéro réseau)
make integration-api           # tests d'intégration (API locale, zéro secret)
make runServer                 # serveur branché : HTTPS sur 0.0.0.0:8080 (voir PORT/HOST/TLS)
```

Client Android :

```bash
make buildDebugApk             # APK debug  -> android/app/build/outputs/apk/debug/
make buildRelApk               # APK release (signé si STORE_FILE est dans l'environnement)
```

Les trois commandes Gradle (`buildDebugApk`, `buildRelApk`, `android-compile`) trouvent
leur JDK et leur SDK toutes seules, et **échouent** si l'outillage manque : un APK
demandé en silence n'en est pas un. Prérequis et installation : `android/README.md`.

Hôte serveur côté app : `android/local.properties` (non commité) ou env `SERVER_HOST`.
Défaut émulateur `10.0.2.2:3000` ; hors émulateur, HTTPS obligatoire. Cet hôte
n'est qu'un défaut : l'adresse réelle se saisit à l'étape 1 de l'assistant de
connexion. L'assistant ouvre la session : adresse du serveur, puis adresse de
l'établissement et **QR affiché par l'application Pronote + son PIN** — un seul
`POST /v1/setup` rend le jeton de device. Aucun identifiant n'est saisi nulle part. Détails : [`android/README.md`](android/README.md).
Détails build/signature : [`android/README.md`](android/README.md) et [`docs/RELEASE.md`](docs/RELEASE.md).

## Configuration

**Il n'y a pas de `.env`.** Le serveur ne détient aucun credential : il n'y a rien
à configurer, rien à commiter, rien à faire tourner. Tout ce qui s'authentifie
vient de l'app, à la demande :

| Ce qui s'authentifie | Qui l'envoie | Comment |
|---|---|---|
| Compte de l'établissement | l'app | `POST /v1/setup` avec le QR affiché par l'application Pronote + son PIN (le serveur ne le garde qu'en mémoire, le temps de la session) |
| Clé LLM (assistant devoirs) | l'app | champ `apiKey` de `POST /v1/homework/generate` (bornée, jamais journalisée, `writeOnly`) |

Seules ces variables restent lues, et ce ne sont pas des secrets :

| Variable | Rôle |
|---|---|
| `PORT` | port d'écoute du serveur (`runServer` : 8080) |
| `HOST` | hôte d'écoute (défaut `127.0.0.1`, loopback ; `runServer` : `0.0.0.0`) |
| `TLS_CERT_FILE` | chemin du certificat PEM — avec `TLS_KEY_FILE`, le serveur sert en HTTPS |
| `TLS_KEY_FILE` | chemin de la clé privée PEM (jamais dans le dépôt, jamais journalisée) |

`make runServer` génère un certificat auto-signé **hors du dépôt**
(`~/.cache/veryslopnynotes/tls`, réutilisé d'un run à l'autre, 600 sur la clé)
plutôt que de refuser de démarrer : l'app Android interdit le clairtext hors
émulateur
([`network_security_config.xml`](android/app/src/main/res/xml/network_security_config.xml)).
Fournissez `TLS_CERT_FILE` / `TLS_KEY_FILE` (mkcert, Let's Encrypt) pour un
certificat émis : elles sont respectées telles quelles, le Makefile ne génère
alors rien et `openssl` n'est pas requis.

Limite assumée : ce certificat auto-signé n'est dans aucune chaîne de
confiance. Le certificat de l'APK **debug** fait confiance aux certificats
installés par l'utilisateur
(`android/app/src/debug/res/xml/network_security_config.xml`, absent de la
release), donc il faut l'installer sur l'appareil — procédure complète dans
[`android/README.md`](android/README.md). Un APK release ne peut pas joindre un
certificat auto-signé : fournissez-lui un certificat émis (`mkcert` + sa racine
installée, ou un vrai nom).

Port : `runServer` sert le 8080, alors que l'adresse par défaut de l'app reste
`10.0.2.2:3000` (`android/core/.../ServerConfig.kt`) — saisir `https://10.0.2.2:8080`
depuis l'émulateur, `https://<ip-lan>:8080` depuis un téléphone.

Ce qui en découle, assumé : la clé de signature des `ref` média est tirée au sort à
chaque démarrage (une ref ne survit pas à un redémarrage, l'app la régénère), le push
n'est pas configuré (aucune clé VAPID ne peut venir du serveur) et le scraping de
manuels est désactivé (le compte éditeur n'a plus d'où sortir).

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
  integrations/   session Pronote, lectures, écritures confirmées
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
| I1 | Android sans aucun hôte Pronote/portail, médias par proxy serveur | `make architecture-test` |
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
| Santé, appairage, setup (ouvertes sans jeton) | `GET /v1/health`, `POST /v1/pairing/start`, `POST /v1/pairing/confirm`, `POST /v1/setup` |
| Notes | `GET /v1/grades` (notes + moyennes, `?algorithm=`, `?periodId=`), `GET /v1/periods` |
| Devoirs | `GET /v1/assignments` (filtres de dates/semaine), `POST /v1/assignments/toggle` |
| Cours (EDT) | `GET /v1/timetable` (`?weekStart=`, `?from=`, `?to=`) |
| Vie scolaire | `GET /v1/attendance`, `GET /v1/punishments` |
| Actualités, cantine | `GET /v1/news`, `GET /v1/menus` |
| Profil & médias | `GET /v1/me`, `GET /v1/media` (réf opaque uniquement) |
| Préférences matière | `GET /v1/subjects/prefs`, `PUT /v1/subjects/prefs` |
| Messagerie | `GET|POST /v1/discussions`, `/messages`, `/recipients`, `/reply`, `/read-state`, `/delete` |
| Sync & capacités | `GET /v1/capabilities`, `POST /v1/sync/refresh`, `GET /v1/events` (SSE) |
| IA | `POST /v1/homework/generate`, `GET /v1/revision-sheets`, `GET /v1/revision-sheets/pdf` |
| Sécurité | `GET /v1/security/alerts` |

Événements SSE : `GradeCreated`, `AssignmentUpdated`, `TimetableUpdated`, `SyncCompleted`,
`CacheInvalidated`, `SecurityAlert`, `NewsUpdated`. Ressources cachables : `grades`, `assignments`,
`timetable`, `news`, `menus`, `attendance`, `punishments`, `capabilities`, `discussions`.

## Tests et garde-fous

```bash
make check                  # tout : secrets, typecheck, unit, arch, contracts, security, compile Kotlin
make unit / contracts / architecture-test / security
make android-compile        # compile Gradle des 4 modules Android (JDK 17-21 + SDK requis)
make e2e                    # bout-en-bout sur store seed, zéro réseau
make integration-api        # API locale, zéro secret
make build                  # image Docker + rappel APK
```

795 tests dans `make check`, fixtures 100 % synthétiques, aucun accès réseau dans la suite par défaut.
La CI locale est `make check` : un changement qui casse un invariant est bloquant, même si
fonctionnellement il passe.

`make check` compile aussi le Kotlin (`make android-compile`) quand un **JDK 17-21** et un
**SDK Android** sont là — sans eux la cible skip en l'écrivant (« compile Kotlin NON
vérifiée »), jamais un faux vert. Prérequis et installation : `android/README.md`.

## Limitations connues

- **Police** : l'app compose en **Figtree** (SIL OFL 1.1, sous-ensemble Latin
  embarqué, 39,7 Ko), pas en SN Pro — la police de l'application de référence,
  non redistribuable hors interface Apple. Figtree a été choisie parce que ses
  largeurs d'avance sont les plus proches de celles de SN Pro parmi les polices
  libres : 1,16 % d'écart moyen et 2,88 % au pire sur des chaînes d'interface
  aux graisses 400/600/700, contre 2,12 % / 5,70 % pour Roboto. Le texte ne
  sera donc jamais aligné au pixel près sur la référence.
- **Rayons de matière** : l'application de référence tire l'encre matière à
  −15 % vers le noir, ce qui mesure 2,28:1 au pire de sa palette — sous le
  WCAG AA pour du texte. Nous gardons −45 % (4,87:1 au pire). Idem pour le gris
  secondaire, composé à 53 % d'opacité chez la référence (3,32:1) contre 65 %
  ici (4,76:1). Le contraste l'emporte sur la copie, par choix.
- **Données de note que la référence ne rend pas** : son type `Grade` n'a ni
  coefficient, ni bonus, ni facultatif, ni enseignant, ni moyenne de classe — donc
  sa ligne de note n'affiche rien de tout cela. Nous l'avons au contrat et c'est
  utile à une moyenne : la ligne garde ces deux lignes. Les retirer alignerait le
  pixel en supprimant une feature.
- **Recherche dans le corps, pas dans la barre** : la référence utilise la
  SearchBar **native** d'expo-router, qui n'écrit ni hauteur, ni rayon, ni typo
  (tout est fourni par la plateforme). Il n'y a donc aucun jeton à recopier, et la
  poser dans notre barre serait une feature de plus.
- **Titre « Nouvelles notes »** : la référence rend son carrousel sans titre. On le
  garde, parce qu'il est le seul point d'entrée du carrousel dans le menu
  « titres » de TalkBack. Le titre « Moyennes par matière », lui, a été retiré :
  il ne nommait rien que les en-têtes de matière ne nomment déjà.
- **Ombres de carte** : la référence pose `elevation: 1` sur ses rangées, valeur
  qui n'a d'effet qu'iOS et n'y dessine rien. Sur les cartes de l'onglet Notes
  nous ne posons donc **ni ombre ni bordure** : une ombre qui n'existe pas sur la
  plateforme visée serait un écart, pas une fidélité.
- Le serveur démarre TOUJOURS vide : lectures vides et écritures en 501 plutôt qu'un `200`
  mensonger. La session et son QR vivent en mémoire, jamais sur disque — donc un redémarrage les
  perd, et l'app doit refaire son setup.
- `POST /v1/setup` est la seule route ouverte qui déclenche une **sortie réseau** : l'URL de
  l'établissement est choisie par le client. Elle est filtrée (hôtes privés, loopback et
  link-local refusés ; 20 échecs par fenêtre de 10 min). Résiduel : plus d'épinglage
  d'établissement (il venait de l'URL d'ambiance, qui n'existe plus). Résiduel assumé : un **nom
  DNS** pointant sur une IP privée passe le filtre littéral (rebinding). À fermer quand le serveur-exposed grandit : résolution DNS + épinglage de
  l'IP résolue, ou liste blanche d'hôtes.
- Connexion par le QR de l'établissement uniquement (`qrcodeLogin`) : aucun identifiant n'est
  saisi, nulle part. Un établissement qui n'expose que son portail passe par son application.
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
- [`docs/architecture/INVARIANTS.md`](docs/architecture/INVARIANTS.md) — les invariants I1–I8
- [`docs/adr/`](docs/adr/) — décisions d'architecture (stack, provider Pronote)

Nouvelles dépendances : justifiées dans la PR, version épinglée, licence MIT-compatible.

## Licence

MIT — voir [`LICENSE`](LICENSE). Identité et écrans propres, aucun asset tiers copié.