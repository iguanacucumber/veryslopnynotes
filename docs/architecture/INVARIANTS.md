# INVARIANTS.md — règles critiques (bloquantes)

Format : Invariant → test → commande → emplacement.

## Architecture actuelle

- `android/` est l'appareil client ; seul `android/pronote/` parle à Pronote.
- `server/` sert uniquement le scraper de manuels. Le client Pronote TypeScript restant sert à la capture du corpus #199, hors processus.
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

## I2 — Un seul point d'accès réseau Pronote par runtime (ADR-003)
- Invariant : côté serveur il ne reste que le chemin legacy de l'outil de capture (#199) : toute requête Pronote y passe par l'unique `PronoteHttpClient`. Côté app, tout accès réseau Pronote passe par l'unique `Client` dans `android/pronote/` ; aucun autre module Android ne fait de réseau vers Pronote (pinné par I1).
- Test : `tests/architecture/invariants.test.ts` (I2 : 1 définition serveur legacy + 1 `Client` android) + `agents/runtime/check-architecture.ts` (I2).
- Commande : `make architecture-test`.
- Emplacement : `server/integrations/PronoteHttpClient.ts` (legacy #199) + `android/pronote/Client.kt`. Réf : `docs/adr/003-client-direct.md`.

## I3 — Domaine sans SQLite ni HTTP
- Invariant : `server/domain/` résiduel (capture #199 : ports/averages/capabilities) ne dépend ni de SQLite ni du framework HTTP. `android/core/` (port #203) suit la même règle : stdlib + plateforme seules, zéro dépendance.
- Test : `tests/architecture/invariants.test.ts` (I3, serveur résiduel + `android/core/`).
- Commande : `make architecture-test`.
- Emplacement : `server/domain/ports.ts` + `android/core/`.

## I4 — Pas de secrets dans prompts LLM
- Invariant : aucun secret/token/credential dans prompt LLM (`server/ai/` supprimé en #210, module porté dans `android/core/`, #204).
- Test : `tests/architecture/invariants.test.ts` (I4, module IA Kotlin) + `agents/runtime/check-secrets.ts`.
- Commande : `make check` (architecture-test + lint).
- Emplacement : `android/core/*Ai*.kt`, `android/core/AiPrompts.kt`.

## I5 — LLM sans outils/secrets dans le prompt
- Invariant : le prompt ne contient aucun secret ; sortie texte/JSON validée. L'app appelle OpenRouter directement en HTTPS et transmet la clé dans l'en-tête `Authorization`, jamais au serveur applicatif (voir I8).
- Test : `tests/architecture/invariants.test.ts` + `check-architecture.ts` (scan `android/core/`) + `tests/unit/android-homework.test.ts` (miroirs).
- Commande : `make check`.
- Emplacement : `android/core/` (IA) + `android/data/` (store de clé, dépôt devoirs). Réf : `docs/adr/003-client-direct.md`.

## I6 — Contenu externe = UNTRUSTED_DATA
- Invariant : tout contenu externe marqué `Untrusted` avant traitement IA, entre délimiteurs à nonce, déclaré données (`server/ai/` supprimé en #210 : le marquage vit dans `server/domain/ports.ts` pour la capture #199 et dans `android/core/Untrusted.kt` pour l'app).
- Test : `tests/architecture/invariants.test.ts` (I6) + `tests/unit/android-homework.test.ts` (miroirs).
- Commande : `make check`.
- Emplacement : `server/domain/ports.ts` (`untrusted()`), `android/core/Untrusted.kt`.

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
cookie jar local gitignoré (`playwright/.auth/manuals.json`). Toute personne
pouvant joindre ce serveur peut piloter une navigation Playwright (risque SSRF)
et consommer ce compte. Garder le serveur sur loopback/réseau de confiance ;
pour l'exposer, placer un proxy authentifié devant lui.

Piné par `tests/architecture/invariants.test.ts` (I8),
`tests/unit/android-homework.test.ts` et `tests/unit/scraper-only.test.ts`.
