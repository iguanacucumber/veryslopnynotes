# Invariants — Frontières et gate

> Détail du registre [`INVARIANTS.md`](../INVARIANTS.md). Une entrée par ID,
> dans l'ordre du registre ; ne lire que le fichier du thème concerné.

<a id="i1"></a>

## I1 — La frontière des modules est étanche : seul `android/pronote/` parle réseau (ADR-003)
- Invariant : hors `android/pronote/`, `android/` ne contient aucune URL ni
  référence d'hôte Pronote (`pronote`, `index-education`), la déclaration du
  module exceptée ; le serveur ne contacte jamais Pronote. La frontière Gradle
  (ADR-003) : `core`/`pronote` sans arête, `data` →
  `core`+`pronote`, `app` → `core`+`data` ; tout accès Pronote passe par
  l'unique `Client`. `android/core/` n'importe ni `java.net`, ni
  `android.database`, ni `androidx.room`. L'hôte auxiliaire (scraper) est validé
  à l'exécution (`ServerConfig.validateBaseUrl` : https, sauf boucle locale,
  préfixe strict) ; seul le site de démonstration public vit dans `DemoSchool.kt`.
- Test : `tests/architecture/invariants.test.ts`,
  `tests/unit/check-architecture-scan.test.ts`,
  `tests/unit/android-server-config.test.ts`,
  `tests/architecture/demo-school.test.ts`.
- Commande : `make architecture-test`.
- Emplacement : `android/**/*`, `android/core/`, `server/`,
  `android/pronote/Client.kt`. Réf : `docs/adr/003-client-direct.md`.

<a id="i8"></a>

## I8 — Le scraper est un sidecar local, sans auth, borné et sans SSRF
- Invariant : session et clé LLM restent locales ; le scraper, sans auth, n'est
  joignable qu'en local ou derrière un proxy authentifié. Identifiants refusés
  (400), login jamais ingéré (`login_required`), jar choisi par le SERVEUR,
  `authFile` refusé. Navigation : hôtes privés et IP internes refusés, plus de
  20 redirections refusées, URL finale re-vérifiée. Le HTML est borné AVANT
  lecture (4 Mo `content-length`, 1 Mo lu), 2 scrapes simultanés, 30 s, 504 au
  délai. Image non-root, TLS obligatoire, pas de `HOST` forcé.
- Test : `tests/unit/scraper-ssrf.test.ts`, `tests/unit/scraper-only.test.ts`,
  `tests/unit/scraper-limits.test.ts`,
  `tests/unit/scraper-concurrency.test.ts`,
  `tests/unit/server-image-playwright.test.ts`,
  `tests/contracts/contracts.test.ts`,
  `tests/architecture/invariants.test.ts`.
- Commande : `make check`.
- Emplacement : `server/infrastructure/`, `Dockerfile.server`,
  `shared/contracts/`, `android/data/SessionStore.kt`.

<a id="i10"></a>

## I10 — Le pont est sans réseau, borné, et ne sature pas (ADR-004)
- Invariant : `web/` ne contient ni `fetch`, XHR, WebSocket, EventSource ni URL
  distante, et la CSP impose `connect-src 'none'`. Aucun jeton ni clé LLM au JS ;
  seules des méthodes allowlistées sont exposées, jamais un proxy d'URL. Toute
  entrée répond EXACTEMENT une fois (échec compris) ; aucun « ok » sans
  écriture. Un appel court ne fait pas la queue derrière cinq appels longs ; les
  opérations LLM ont leur file bornée à deux ; délais hiérarchisés : natif < JS.
- Test : `tests/architecture/web.test.ts`,
  `tests/unit/kotlin-bridge-executors.test.ts`, `tests/web/bridge.test.ts`,
  `tests/unit/android-bridge-call.test.ts`,
  `tests/unit/android-pairing-message.test.ts`,
  `tests/unit/android-homework-message.test.ts`,
  `tests/unit/android-bridge-error.test.ts`,
  `tests/unit/android-subject-pref.test.ts`, `tests/web/profile.test.ts`,
  `tests/unit/kotlin-offline-artifacts.test.ts`.
- Commande : `make check`.
- Emplacement : `web/**`, `android/app/VsnBridge.kt`,
  `android/app/BridgeExecutors.kt`.

<a id="i22"></a>

## I22 — Le gate ne peut pas être neutralisé par l'environnement
- Invariant : `make check` sort NON-ZÉRO dès qu'une étape échoue, QUEL QUE SOIT
  l'environnement (`MAKEFLAGS`, `make -i`, `make -k`). `make -i` fait IGNORER
  l'échec d'une RECETTE : un gate ROUGE devenait VERT, et `agents/ship.sh`
  (lui-même en `set -e`) écrivait « `make check` : OK » dans le corps de PR
  (#523). Le gate est donc en DEUX phases : `check-run` lance le harnais et
  ÉCRIT son code de sortie, `check` REFUSE tout code ≠ 0 par `$(error)` — une
  erreur de MAKE, que `-i` n'ignore pas. Sans statut, le gate n'A PAS
  TOURNÉ : c'est un ÉCHEC, jamais un vert. Même règle côté harnais : les make
  ENFANTS (un par étape) sont lancés SANS `MAKEFLAGS`, sinon une étape rouge
  passait pour verte.
- Test : `tests/unit/check-runner.test.ts` (le harnais neutralise `MAKEFLAGS`
  pour ses enfants ; `make check` reste rouge sous `MAKEFLAGS=-i` ; le verdict
  refuse par `$(error)`).
- Commande : `make check`.
- Emplacement : `Makefile` (cibles `check-run` / `check`),
  `agents/runtime/check.ts` (environnement des make enfants).
