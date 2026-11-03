# Invariants — Frontières et gate

> Détail du registre [`INVARIANTS.md`](../INVARIANTS.md). Une entrée par ID,
> dans l'ordre du registre ; ne lire que le fichier du thème concerné.

<a id="i1"></a>

## I1 — Frontière étanche : `android/pronote/` seul parle à Pronote (ADR-003)
- Invariant : hors `android/pronote/`, `android/` ne contient aucune URL ni
  référence d'hôte Pronote (`pronote`, `index-education`), sauf déclaration du
  module ; le serveur ne contacte jamais Pronote. Gradle :
  `core`/`pronote` sans arête, `data` →
  `core`+`pronote`, `app` → `core`+`data` ; accès Pronote via l'unique
  `Client`. `android/core/` n'importe ni `java.net` ni `android.database`.
  Clients réseau : `Client`, OpenRouter
  (`android/data/OpenRouterLlm.kt`, I4), scraper (I8). Hôte auxiliaire :
  (`ServerConfig.validateBaseUrl` : https ; clair loopback en debug seul,
  interdit en release ; préfixe strict) ; seul `DemoSchool.kt` porte la
  démonstration.
- Test : `tests/architecture/invariants.test.ts`,
  `tests/unit/check-architecture-scan.test.ts`,
  `tests/unit/android-server-config.test.ts`,
  `tests/architecture/demo-school.test.ts`.
- Commande : `make architecture-test`.
- Emplacement : `android/**/*`, `android/core/`, `server/`,
  `android/pronote/Client.kt`. Réf : `docs/adr/003-client-direct.md`.

<a id="i8"></a>

## I8 — Le scraper est un sidecar local, sans auth, borné et sans SSRF
- Invariant : session/clé locale ; scraper sans auth ; hors loopback,
  `ALLOW_PUBLIC=1` + `SCRAPER_TOKEN` Bearer, seau par jeton, file bornée
  (`429`+`Retry-After`). Identifiants refusés, login jamais ingéré, jar du
  SERVEUR 0700/0600, `authFile` refusé. Hôtes privés, non-http, popups, WS/SW
  refusés ; 20 redirections, URL finale re-vérifiée. Document épinglé ;
  sous-ressources via égression réseau. JSON `application/json`
  ≤16 Kio streamé (`413`), téléchargements coupés. HTML borné (1 Mo), 2
  scrapes, 30 s, 504. Non-root, TLS obligatoire, `HOST` non forcé,
  `/v1/ready`, drain SIGTERM.
- Test : `tests/unit/scraper-ssrf.test.ts`, `tests/unit/scraper-only.test.ts`,
  `tests/unit/scraper-jar.test.ts`, `tests/unit/scraper-limits.test.ts`,
  `tests/unit/scraper-concurrency.test.ts`,
  `tests/unit/server-rate-limit.test.ts`,
  `tests/unit/server-operability.test.ts`,
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
  entrée répond EXACTEMENT une fois ; aucun « ok » sans
  écriture. Un appel court ne fait pas la queue ; les
  opérations LLM ont leur file bornée à deux ; délais hiérarchisés : natif < JS.
- Test : `tests/architecture/web.test.ts`,
  `tests/unit/kotlin-bridge-executors.test.ts`, `tests/web/bridge.test.ts`,
  `tests/unit/android-bridge-call.test.ts`,
  `tests/unit/android-pairing-handle.test.ts`,
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
- Invariant : `make check` sort NON-ZÉRO dès qu'une étape échoue, quel que soit l'environnement (`MAKEFLAGS`, `make -i`). Le gate est en DEUX phases : `check-run` écrit le code de sortie ; `check` refuse tout code ≠ 0 par `$(error)` (erreur de MAKE). Sans statut, le gate n'a pas tourné : échec. Les make enfants sont lancés sans `MAKEFLAGS`.
- Test : `tests/unit/check-runner.test.ts`.
- Commande : `make check`.
- Emplacement : `Makefile` (`check-run` / `check`), `agents/runtime/check.ts`.
