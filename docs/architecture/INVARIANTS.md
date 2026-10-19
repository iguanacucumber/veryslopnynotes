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
  des méthodes allowlistées, jamais un proxy d'URL. Le pont ne laisse JAMAIS
  une promesse sans réponse : tout échec natif — un `Error` compris, pas
  seulement une `Exception` — devient un rejet borné `{code,message}` (#394).
- Test : `tests/architecture/web.test.ts` (réseau, CSP, HTML injecté, hôte
  Pronote, secrets persistés, message d'appairage borné) +
  `tests/unit/android-pairing-message.test.ts` (table de messages du pont,
  Kotlin exécuté) + `tests/unit/android-homework-message.test.ts` (message de
  refus du devoir : le motif libre du modèle ne sort pas, Kotlin exécuté) +
  `tests/unit/android-bridge-error.test.ts` (un `Error` natif devient un rejet,
  pas une promesse pendante : Kotlin exécuté) +
  `tests/architecture/invariants.test.ts` (les blocs `catch` qui RÉPONDENT
  capturent `Throwable`) + `tests/web/bridge.test.ts` (un rejet natif règle
  toujours la promesse, message non vide).
- Commande : `make web` (ou `make architecture-test`).
- Emplacement : `web/**`, `android/app/src/main/java/fr/veryslopnynotes/app/VsnBridge.kt`,
  `android/app/src/main/java/fr/veryslopnynotes/app/HomeworkMessages.kt`,
  `android/app/src/main/java/fr/veryslopnynotes/app/BridgeErrors.kt`.

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
- Invariant : le prompt ne contient aucun secret ; sortie texte/JSON validée (une sortie MAL FORMÉE est refusée, jamais réinterprétée — voir I14). L'app appelle OpenRouter directement en HTTPS et transmet la clé dans l'en-tête `Authorization`, jamais au serveur applicatif (voir I8).
- Test : `tests/architecture/invariants.test.ts` + `check-architecture.ts` (scan `android/core/`) + `tests/unit/android-homework.test.ts` (miroirs) + `tests/unit/android-revision.test.ts` (Kotlin compilé : consigne JSON de la fiche + garde I5).
- Commande : `make check`.
- Emplacement : `android/core/` (IA) + `android/data/` (store de clé, dépôt devoirs). Réf : `docs/adr/003-client-direct.md`.

## I6 — Contenu externe = UNTRUSTED_DATA
- Invariant : tout contenu externe marqué `Untrusted` avant traitement IA, entre délimiteurs à nonce, déclaré donnée (`server/ai/` supprimé en #210 ; le marquage vit dans `android/core/Untrusted.kt`). Une pièce jointe nommée par le serveur ne sort jamais en type MIME **exécutable** (`text/html`, `image/svg+xml`, `application/xhtml+xml`…) : son type vient d'une table blanche bornée, le reste sort en `text/plain` ou `application/octet-stream` (#398).
- Test : `tests/architecture/invariants.test.ts` (I6) + `tests/unit/android-homework.test.ts` (miroirs) + `tests/unit/android-untrusted.test.ts` (Kotlin réel : marqueur non forgeable, #373) + `tests/unit/attachment-mime.test.ts` (Kotlin réel : type MIME d'une pièce jointe jamais exécutable, #398).
- Commande : `make check`.
- Emplacement : `android/core/Untrusted.kt`, `android/app/src/main/java/fr/veryslopnynotes/app/AttachmentMime.kt`.

## I7 — Pas d'effet bord via sortie libre LLM
- Invariant : aucun effet métier déclenché par sortie libre LLM. `server/jobs/` supprimé en #210 (jobs portés en Kotlin natif, #207) ; les jobs device ne touchent ni LLM ni réseau. Notifications/détection DS sur données structurées Pronote, sinon confirmation app.
- Test : `tests/architecture/invariants.test.ts` (I7 : pas de `server/jobs/`, jobs device sans LLM/réseau).
- Commande : `make architecture-test`.
- Emplacement : `android/core/GradeDiff.kt`, `ExamDetect.kt`, `NotifyFormat.kt`, `RevisionSheet.kt`.

## I8 — Session Pronote et clé LLM restent hors serveur

Le serveur ne lit que `PORT`, `HOST` et les chemins TLS `TLS_CERT_FILE` /
`TLS_KEY_FILE`. L'image Docker déclare en plus `PLAYWRIGHT_BROWSERS_PATH` :
c'est le chemin des navigateurs téléchargés au build (un chemin, pas un
credential — le paquet `playwright` n'a aucun script d'installation, le
navigateur ne vient donc pas de `bun install`). La session Pronote est ouverte
et stockée sur le téléphone ; la
clé OpenRouter reste chiffrée dans l'app et part directement au fournisseur dans
un en-tête HTTPS `Authorization`. Aucun `.env*`, jeton de session ou clé LLM dans
le dépôt, les variables serveur ou les logs.

**Exception de sécurité :** `POST /v1/manuals/scrape` est volontairement sans
authentification. Il reçoit les identifiants du portail de manuels et une URL
dans le corps de la requête, sans les journaliser ; Playwright réutilise un
cookie jar local gitignoré (`playwright/.auth/manuals.json`) dont le chemin
n'est **plus** choisi par l'appelant (seulement le nom du jar : le serveur
impose son répertoire, #362). La navigation est gardée (`shared/contracts/net.ts`
+ `server/infrastructure/ssrf.ts` + `server/infrastructure/manuals-scrape.ts`) :
hôte privé/interne refusé (IP littérale, entière, hexadécimale, IPv4-mapped
IPv6, ULA, link-local, métadonnées), **nom d'hôte RÉSOLU avant la navigation**
(chaque adresse obtenue est testée contre les plages privées : un nom public
qui pointe vers une IP interne — rebinding — est refusé, motif explicite
`403 private_host` ; un nom introuvable est refusé aussi, `502
unresolved_host` ; jamais un échec muet), **chaîne de redirections vérifiée
avant le navigateur** et **URL finale re-vérifiée après navigation**. Restent
résolus par le réseau : la fenêtre TOCTOU entre la résolution vérifiée et la
connexion (le navigateur résout de son côté, au moment de connecter) et
l'épuisement du compte. Toute personne pouvant joindre ce serveur peut donc
encore piloter une navigation Playwright (risque SSRF résiduel) et consommer ce
compte. Garder le serveur sur loopback/réseau de confiance ; pour l'exposer,
placer un proxy authentifié devant lui.

**Plafond de concurrence :** l'endpoint étant public, il borne les navigateurs
vivants : 2 scrapes simultanés (les autres = 503) et 30 s de délai — délai
auquel le Chromium est réellement fermé, pas seulement la promesse rejetée
(empilement de Chromium = épuisement mémoire, cf. #363). Le délai dépassé
répond **504** (le code exact), pas 502 : le portail n'est pas en cause.

**Volume lu :** le HTML récupéré est borné (1 Mo de caractères, plafond
appliqué AVANT le reparse) et sa lecture a son propre délai (10 s) : sans ça,
une page de 50 Mo est reparsée par cheerio (plusieurs fois sa taille) et une
page qui ne finit pas de streamer survit au délai HTTP en gardant le Chromium
vivant (cf. #422).

Piné par `tests/architecture/invariants.test.ts` (I8),
`tests/unit/android-homework.test.ts`, `tests/unit/scraper-only.test.ts` et
`tests/unit/scraper-concurrency.test.ts` ; garde SSRF (littérale + résolution
DNS) et jar : `tests/unit/scraper-ssrf.test.ts` ; bornes du HTML lu et délai
de lecture : `tests/unit/scraper-limits.test.ts`.

## I9 — Pas de code mort dans `android/`
- Invariant : aucun `fun`/`class` de premier niveau sans appelant dans le code
  Kotlin. Liste de tolérance = points d'entrée du port encore rejoués par les
  miroirs (`core/`, `data/`), surface `pronote/`, jobs et IA : c'est la liste
  qui est gardée, pas du code oublié. Les noms qui n'existaient que pour
  l'interface Compose ont disparu avec `android/ui/`.
- Test : `tests/architecture/invariants.test.ts` (I9).
- Commande : `make architecture-test`.
- Emplacement : `android/**/*`.

## I11 — Contenu vendorisé `.agents/` : docs, pas de passoire
- Invariant : `.agents/` (skills d'agents copiés depuis des dépôts tiers,
  verrouillés par `skills-lock.json`) n'est jamais un vecteur de fuite : un
  VRAI secret y échoue au scan anti-secrets, seuls les exemples de
  documentation passent. Le jeu de motifs strict du dépôt s'applique partout
  ailleurs. Aucun secret, domaine, IP ni donnée perso dans ce dossier.
- Test : `tests/architecture/secret-scan.test.ts` (carve-out étroit) +
  `make lint` (scan réel du dépôt, `.agents/` inclus une fois tracké).
- Commande : `make lint` (scan) et `make architecture-test` (m invariants).
- Emplacement : `.agents/**/*`, motifs dans `agents/runtime/secret-patterns.ts`.

## I12 — Le job de fond restore la session AVANT de lire
- Invariant : le job WorkManager restore la session par le MÊME chemin que le
  pont (`PairingRepository.restoreBlocking` : store chiffré -> `Client.tokenLogin`
  -> `PronoteSession`) AVANT toute lecture, et renvoie `Result.retry()` — jamais
  `Result.success()` — quand aucune session n'est lisible (un succès sans rien
  faire = un sync de fond no-op, sans réessai). Une restauration n'est jamais
  simultanée avec une autre dans le process (deux `tokenLogin` sur le même compte
  = erreur 25 « Exceeded max authorization requests », l'établissement limite
  le compte).
- Test : `tests/architecture/sync-session.test.ts` (ordre restauration -> lecture,
  réessai sans session, verrou de restauration partagé) +
  `tests/unit/kotlin-sync-worker.test.ts` (Kotlin réel : la décision
  réessai/lecture).
- Commande : `make check`.
- Emplacement : `android/data/src/main/java/fr/veryslopnynotes/data/PeriodicSyncWorker.kt`,
  `android/data/src/main/java/fr/veryslopnynotes/data/SyncJobOutcome.kt`,
  `android/data/src/main/java/fr/veryslopnynotes/data/PairingRepository.kt`.

## I13 — Le pont factice est un artefact de développement
- Invariant : le pont factice (`web/src/bridge/mock.ts`) n'existe qu'en
  développement. `client.ts` ne l'importe que dans une branche
  `import.meta.env.DEV` (jamais d'import statique) : le bundle livré à l'APK
  ne contient AUCUNE donnée scolaire fictive, et hors mode dev un pont natif
  absent ÉCHOUE (`BridgeCallError`) au lieu de servir une école fictive (faux
  profil, fausses notes, `session.restore` = « restored », donc jamais d'écran
  d'appairage). `web/vite.config.ts` force `NODE_ENV=production` pour le
  build : un `NODE_ENV=development` ambiant ne peut pas fabriquer un bundle de
  développement embarqué dans l'APK.
- Test : `tests/architecture/web-mock.test.ts` (pas d'import statique + analyse
  du bundle Vite réellement produit) + `tests/web/bridge.test.ts` (hors mode
  dev : le pont absent échoue ; en mode dev : le factice répond ; un pont
  natif présent ne retombe jamais sur le factice).
- Commande : `make architecture-test` (ou `make check`).
- Emplacement : `web/src/bridge/client.ts`, `web/src/bridge/mock.ts`,
  `web/vite.config.ts`.

## I14 — « Invalide » n'est jamais « vide » (fail-closed / fail-open)
- Invariant : une sortie mal formée est REFUSÉE, jamais réinterprétée en valeur
  vide. Un champ `sources` qui n'est pas une liste ne veut pas dire « aucune
  source » : le corrigé est refusé (fail-closed sur la validation), sinon le
  texte sort comme un corrigé validé, sans sources. Symétriquement, un contrat
  de capabilities INVALIDE vaut « rien n'est affirmé » (`null`), JAMAIS une
  liste d'onglets vide : une liste vide AFFIRME « tous les onglets
  désactivés » et blackoute la navigation sur une panne (fail-open attendu :
  les onglets restent accessibles). Les deux notions restent distinctes :
  `sources` ABSENT ou `[]` = corpus vide (autorisé) ; `capabilities: null` =
  inconnu ; `capabilities: {tabs: []}` = contrat affirmé qui désactive tout.
- Test : `tests/unit/kotlin-core-validation-parity.test.ts` (Kotlin EXÉCUTÉ :
  `sources: "abc"` refusé, contrat invalide → `null` et aucun onglet masqué) +
  `tests/web/home.test.ts` et `tests/web/social.test.ts` (web : `capabilities:
  null` = inconnu, la sanction reste visible).
- Commande : `make check`.
- Emplacement : `android/core/Humanize.kt`, `android/core/CapabilityProbe.kt`,
  `android/core/Capabilities.kt`, `android/core/CapabilitiesJson.kt`,
  `android/data/PronotePayloads.kt`, `web/src/features/attendance/model.ts`.

