# INVARIANTS.md — règles critiques (bloquantes)

Format : Invariant → test → commande → emplacement.

## Architecture actuelle

- `android/` est l'appareil client ; seul `android/pronote/` parle à Pronote.
- `web/` est l'interface React embarquée dans la WebView ; elle ne parle à
  aucun réseau et passe par le pont natif (`android/app/.../VsnBridge.kt`).
- `server/` sert uniquement le scraper de manuels.
- `shared/contracts/` décrit les deux routes du scraper et conserve des validateurs utilisés par les tests Android.

## I1 — Seuls `android/pronote/` et le scraper parlent réseau (ADR-003)
- Invariant : hors `android/pronote/`, `android/` ne contient aucune URL/référence hôte Pronote. Le module du port (zéro dépendance) est le seul à parler Pronote en direct ; la déclaration du module dans `settings.gradle.kts` est l'unique mention tolérée hors module. Côté app, PLUS AUCUN client HTTP vers un serveur applicatif (`ApiClient` supprimé en #206 : appairage, lectures et médias sont device-only) ; côté process, seul le scraper Playwright parle réseau (portail éditeur, `server/infrastructure/http.ts`).
- Hôte auxiliaire (le scraper) choisi à l'exécution : l'allowlist n'est plus une
  constante de build mais `ServerConfig.validateBaseUrl` (https, sauf émulateur/
  boucle locale en http ; hôte et port bornés ; identifiants, chemin, query,
  fragment, espaces et caractères de contrôle refusés) + `isAllowed` en préfixe
  strict. `BuildConfig.SERVER_HOST` n'est plus qu'une graine. Une déconnexion
  purge la session et les caches (`AccountStore.logout()`).
- Test : `tests/architecture/invariants.test.ts` (I1 : zéro mention hors module + déclaration unique) + `agents/runtime/check-architecture.ts` (I1) + `tests/unit/android-server-config.test.ts`.
- Commande : `make architecture-test`.
- Emplacement : `android/**/*` (tolérances : `android/pronote/**` + ligne `include(...)` de `settings.gradle.kts`). Réf : `docs/adr/003-client-direct.md`.

## I10 — WebView sans réseau et sans secret (ADR-004)
- Invariant : `web/` ne contient ni `fetch`, XHR, WebSocket, EventSource, ni
  URL distante. La CSP de `web/index.html` impose `connect-src 'none'`. Aucun
  jeton de session ni clé LLM n'est exposé au JS ; le pont natif n'expose que
  des méthodes allowlistées, jamais un proxy d'URL.
- Test : `tests/architecture/web.test.ts` (réseau, CSP, HTML injecté, hôte
  Pronote, secrets persistés).
- Commande : `make web` (ou `make architecture-test`).
- Emplacement : `web/**`, `android/app/src/main/java/fr/veryslopnynotes/app/VsnBridge.kt`.

## I2 — Aucun accès Pronote côté serveur ; un seul client Android (ADR-003)
- Invariant : le serveur ne contacte jamais Pronote. Dans l'app, tout accès réseau Pronote passe par l'unique `Client` de `android/pronote/` ; aucun autre module Android (`app`, `core`, `data`) ne contacte Pronote (pinné par I1).
- Test : `tests/architecture/invariants.test.ts` (aucun accès réseau serveur + un `Client` Android) + `agents/runtime/check-architecture.ts`.
- Commande : `make architecture-test`.
- Emplacement : `android/pronote/Client.kt`. Réf : `docs/adr/003-client-direct.md`.

## I3 — Cœur Android sans SQLite ni HTTP
- Invariant : `android/core/` dépend seulement de la stdlib Kotlin et de la plateforme, sans SQLite ni framework HTTP.
- Test : `tests/architecture/invariants.test.ts` (I3, `android/core/`).
- Commande : `make architecture-test`.
- Emplacement : `android/core/`.

## I4 — Pas de secrets dans prompts LLM
- Invariant : aucun secret/token/credential dans prompt LLM (`server/ai/` supprimé en #210, module porté dans `android/core/`, #204).
- Test : `tests/architecture/invariants.test.ts` (I4, module IA Kotlin) + `agents/runtime/check-secrets.ts`.
- Commande : `make check` (architecture-test + lint).
- Emplacement : `android/core/*Ai*.kt`, `android/core/AiPrompts.kt`.

## I5 — LLM sans outils/secrets dans le prompt
- Invariant : le prompt ne contient aucun secret ; sortie texte/JSON validée. L'app appelle OpenRouter directement en HTTPS et transmet la clé dans l'en-tête `Authorization`, jamais au serveur applicatif (voir I8).
- Test : `tests/architecture/invariants.test.ts` + `check-architecture.ts` (scan `android/core/`) + `tests/unit/android-homework.test.ts` (miroirs) + `tests/unit/android-revision.test.ts` (Kotlin compilé : consigne JSON de la fiche + garde I5).
- Commande : `make check`.
- Emplacement : `android/core/` (IA) + `android/data/` (store de clé, dépôt devoirs). Réf : `docs/adr/003-client-direct.md`.

## I6 — Contenu externe = UNTRUSTED_DATA
- Invariant : tout contenu externe marqué `Untrusted` avant traitement IA, entre délimiteurs à nonce, déclaré donnée (`server/ai/` supprimé en #210 ; le marquage vit dans `android/core/Untrusted.kt`).
- Test : `tests/architecture/invariants.test.ts` (I6) + `tests/unit/android-homework.test.ts` (miroirs) + `tests/unit/android-untrusted.test.ts` (Kotlin réel : marqueur non forgeable, #373).
- Commande : `make check`.
- Emplacement : `android/core/Untrusted.kt`.

## I7 — Pas d'effet bord via sortie libre LLM
- Invariant : aucun effet métier déclenché par sortie libre LLM. `server/jobs/` supprimé en #210 (jobs portés en Kotlin natif, #207) ; les jobs device ne touchent ni LLM ni réseau. Notifications/détection DS sur données structurées Pronote, sinon confirmation app.
- Test : `tests/architecture/invariants.test.ts` (I7 : pas de `server/jobs/`, jobs device sans LLM/réseau).
- Commande : `make architecture-test`.
- Emplacement : `android/core/GradeDiff.kt`, `ExamDetect.kt`, `NotifyFormat.kt`, `RevisionSheet.kt`.

## I8 — Session Pronote et clé LLM restent hors serveur

Le serveur ne lit que `PORT`, `HOST` et les chemins TLS `TLS_CERT_FILE` /
`TLS_KEY_FILE`. La session Pronote est ouverte et stockée sur le téléphone ; la
clé OpenRouter reste chiffrée dans l'app et part directement au fournisseur dans
un en-tête HTTPS `Authorization`. Aucun `.env*`, jeton de session ou clé LLM dans
le dépôt, les variables serveur ou les logs.

**Exception de sécurité :** `POST /v1/manuals/scrape` est volontairement sans
authentification. Il reçoit les identifiants du portail de manuels et une URL
dans le corps de la requête, sans les journaliser ; Playwright réutilise un
cookie jar local gitignoré (`playwright/.auth/manuals.json`) dont le chemin
n'est **plus** choisi par l'appelant (seulement le nom du jar : le serveur
impose son répertoire, #362). La navigation est gardée (`shared/contracts/net.ts`
+ `server/infrastructure/manuals-scrape.ts`) : hôte privé/interne refusé
(IP littérale, entière, hexadécimale, IPv4-mapped IPv6, ULA, link-local,
métadonnées), **chaîne de redirections vérifiée avant le navigateur** et
**URL finale re-vérifiée après navigation**. Reste le risque résolu par le
réseau : un nom DNS public qui pointe vers une IP interne (rebinding), et
l'épuisement du compte. Toute personne pouvant joindre ce serveur peut donc
encore piloter une navigation Playwright (risque SSRF résiduel) et consommer ce
compte. Garder le serveur sur loopback/réseau de confiance ; pour l'exposer,
placer un proxy authentifié devant lui.

**Plafond de concurrence :** l'endpoint étant public, il borne les navigateurs
vivants : 2 scrapes simultanés (les autres = 503) et 30 s de délai — délai
auquel le Chromium est réellement fermé, pas seulement la promesse rejetée
(empilement de Chromium = épuisement mémoire, cf. #363).

Piné par `tests/architecture/invariants.test.ts` (I8),
`tests/unit/android-homework.test.ts`, `tests/unit/scraper-only.test.ts` et
`tests/unit/scraper-concurrency.test.ts` ; garde SSRF et jar :
`tests/unit/scraper-ssrf.test.ts`.

## I9 — Pas de code mort dans `android/`
- Invariant : aucun `fun`/`class` de premier niveau sans appelant dans le code
  Kotlin. Liste de tolérance = points d'entrée du port encore rejoués par les
  miroirs (`core/`, `data/`), surface `pronote/`, jobs et IA : c'est la liste
  qui est gardée, pas du code oublié. Les noms qui n'existaient que pour
  l'interface Compose ont disparu avec `android/ui/`.
- Test : `tests/architecture/invariants.test.ts` (I9).
- Commande : `make architecture-test`.
- Emplacement : `android/**/*`.
