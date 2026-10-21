# INVARIANTS.md — règles critiques (bloquantes)

Format : Invariant → test → commande → emplacement.

## Architecture actuelle

- `android/` est l'appareil client ; seul `android/pronote/` parle à Pronote.
- `web/` est l'interface React embarquée dans la WebView ; elle ne parle à
  aucun réseau et passe par le pont natif (`android/app/.../VsnBridge.kt`).
- `server/` sert uniquement le scraper de manuels.
- `shared/contracts/` décrit les deux routes du scraper et conserve des validateurs utilisés par les tests Android.

## I1 — Seuls `android/pronote/` et le scraper parlent réseau (ADR-003)
- Invariant : hors `android/pronote/`, `android/` ne contient aucune URL/référence hôte Pronote — **le mot du produit ET le domaine réel de l'éditeur** (`index-education.net`, cf. la référence `pronotets`) : `/pronote/i` seul laissait passer un hôte PRONOTE glissé dans `android/data/` (#489). Le module du port (zéro dépendance) est le seul à parler Pronote en direct ; la déclaration du module dans `settings.gradle.kts` est l'unique mention tolérée hors module. Côté app, PLUS AUCUN client HTTP vers un serveur applicatif (`ApiClient` supprimé en #206 : appairage, lectures et médias sont device-only) ; côté process, seul le scraper Playwright parle réseau (portail éditeur, `server/infrastructure/http.ts`).
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
  **Toute ENTRÉE du pont répond EXACTEMENT une fois** (#539) : un identifiant
  d'appel mal formé et un pont fermé (WebView détruite) sont REFUSÉS, jamais
  ignorés — sinon la promesse pendait, pour TOUJOURS sur `pairing.scanQr`
  dont le délai JS est 0.
  **Toute ENTRÉE du pont est BORNÉE, et le pont ne répond JAMAIS « ok » sans
  avoir écrit** (#395) : les préférences matière sont lues par les règles
  partagées (`data/SubjectPrefRules.kt` — la source UNIQUE, que le dépôt
  applique aussi), donc une couleur, un emoji ou un libellé hors contrat sont
  REFUSÉS avec une phrase bornée, au lieu d'un « enregistré » suivi d'une
  écriture abandonnée. Une fiche de révision suit la MÊME règle (#528) :
  l'enregistrement n'est « ok » que si la fiche ET son index (le journal qui
  la liste) ont été écrits — un index REFUSÉ (l'époque de session a basculé
  entre deux écritures) fait répondre `ok:false`, jamais « fiche enregistrée »
  pour une fiche que `revision.list` ne verra pas.
- Test : `tests/architecture/web.test.ts` (réseau, CSP, HTML injecté, hôte
  Pronote, secrets persistés, message d'appairage borné) +
  `tests/unit/android-pairing-message.test.ts` (table de messages du pont,
  Kotlin exécuté) + `tests/unit/android-homework-message.test.ts` (message de
  refus du devoir : le motif libre du modèle ne sort pas, Kotlin exécuté) +
  `tests/unit/android-bridge-error.test.ts` (un `Error` natif devient un rejet,
  pas une promesse pendante : Kotlin exécuté) +
  `tests/unit/android-subject-pref.test.ts` (matière hors contrat : refus
  `ok:false` AVANT toute écriture, entrées bornées, règles du dépôt et du
  pont partagées : Kotlin exécuté) +
  `tests/architecture/invariants.test.ts` (les blocs `catch` qui RÉPONDENT
  capturent `Throwable` ; aucune sortie de `runCall` sans réponse) +
  `tests/web/bridge.test.ts` (un rejet natif règle toujours la promesse,
  message non vide ; une méthode SANS timeout se règle quand le natif répond) +
  `tests/web/profile.test.ts` (un
  refus du natif est affiché, jamais avalé en « Matière enregistrée. ») +
  `tests/unit/kotlin-offline-artifacts.test.ts` (Kotlin EXÉCUTÉ : une fiche
  dont l'index est REFUSÉ fait ÉCHOUER l'enregistrement — aucun « ok » sans
  avoir écrit, #528).
- Commande : `make web` (ou `make architecture-test`).
- Emplacement : `web/**`, `android/app/src/main/java/fr/veryslopnynotes/app/VsnBridge.kt`,
  `android/app/src/main/java/fr/veryslopnynotes/app/HomeworkMessages.kt`,
  `android/app/src/main/java/fr/veryslopnynotes/app/BridgeErrors.kt`,
  `android/app/src/main/java/fr/veryslopnynotes/app/SubjectPrefMessages.kt`,
  `android/data/src/main/java/fr/veryslopnynotes/data/SubjectPrefRules.kt`,
  `android/core/src/main/java/fr/veryslopnynotes/core/RevisionSheet.kt`.

## I2 — Aucun accès Pronote côté serveur ; un seul client Android (ADR-003)
- Invariant : le serveur ne contacte jamais Pronote. Dans l'app, tout accès réseau Pronote passe par l'unique `Client` de `android/pronote/` ; aucun autre module Android (`app`, `core`, `data`) ne contacte Pronote (pinné par I1).
- **Le scan d'hôte ne se fie plus à un littéral COMPLET** (#535) : le mot `pronote`/`index-education` **et** un appel réseau dans le **même fichier** suffisent, quelle que soit la forme de l'URL (assemblée à l'exécution, sur une ou plusieurs lignes). Avant, il fallait le mot ET l'appel réseau sur la MÊME ligne, ou une URL littérale entière : `const h = "index-education" + ".net"; await fetch("https://" + h);` passait. Le signal est déjà là — le mot est interdit hors module (I1).
- Test : `tests/architecture/invariants.test.ts` (aucun accès réseau serveur + un `Client` Android + la surface importée hors `pronote/` : `Client` et les types protocoles, dont `ExpiredObject` — G=22 + l'hôte assemblé à l'exécution détecté) + `agents/runtime/check-architecture.ts`.
- Commande : `make architecture-test`.
- Emplacement : `android/pronote/Client.kt`. Réf : `docs/adr/003-client-direct.md`.

## I3 — Cœur Android sans SQLite ni HTTP
- Invariant : `android/core/` dépend seulement de la stdlib Kotlin et de la plateforme, sans SQLite ni framework HTTP.
- Test : `tests/architecture/invariants.test.ts` (I3, `android/core/`).
- Commande : `make architecture-test`.
- Emplacement : `android/core/`.

## I4 — Pas de secrets dans prompts LLM
- Invariant : aucun secret/token/credential dans prompt LLM (`server/ai/` supprimé en #210, module porté dans `android/core/`, #204). La garde porte sur des **FORMES** de secret (#409), pas sur des mots : préfixe de clé connu, en-tête d'autorisation, JWT, affectation d'une variable sensible (en début de ligne **ou en milieu de ligne**, #493), cookie de session, bloc de clé privée, chaîne à forte entropie. Un cours qui *mentionne* « BEGIN PRIVATE KEY » n'est pas un secret ; un vrai JWT, lui, est refusé. Le refus dit **pourquoi** (le type) et ne recopie **jamais** le secret : la cause remonte jusqu'à l'élève (`SecretDetectedException` + `secretRefusalMessage`), au lieu du « Échec de l'assistant. » avalé.
- **Le prompt VÉRIFIÉ est le prompt ENVOYÉ** (#493) : le fournisseur est un `SafePromptProvider` — le type porte la garantie. Avant, `callProvider` acceptait un `LlmProvider` et, pour un fournisseur qui ne l'était pas, **reconstruisait** le prompt (nouveau nonce) : le corps contrôlé par `assertNoSecretsInPrompt` n'était alors pas le corps transmis. Ce chemin de reconstruction n'existe plus.
- Test : `tests/architecture/invariants.test.ts` (I4, module IA Kotlin) + `agents/runtime/check-secrets.ts` + `tests/unit/kotlin-llm-guard.test.ts` (Kotlin **exécuté** : `assertNoSecretsInPrompt` / `validateTextOutput` — cours légitime accepté, JWT et `Bearer …` refusés, affectation sensible en milieu de ligne refusée, message de refus sans le secret) + `tests/unit/android-llm-catalogue.test.ts` (le refus de secret n'est plus avalé en « hors format »).
- Commande : `make check` (architecture-test + lint).
- Emplacement : `android/core/*Ai*.kt`, `android/core/AiPrompts.kt`, `android/core/LlmGuard.kt` (garde I4), `android/data/OpenRouterLlm.kt` + `android/app/VsnBridge.kt` (remontée de la cause).

## I5 — LLM sans outils/secrets dans le prompt
- Invariant : le prompt ne contient aucun secret ; sortie texte/JSON validée (une sortie MAL FORMÉE est refusée, jamais réinterprétée — voir I14). L'app appelle OpenRouter directement en HTTPS et transmet la clé dans l'en-tête `Authorization`, jamais au serveur applicatif (voir I8).
- **Les deux plafonds de sortie TENIR ENSEMBLE (#411)** : le fournisseur compte en tokens, la garde en caractères. Le budget de tokens est **déduit** du plafond de caractères de la garde (`MAX_OUTPUT_CHARS` 12 000 ÷ `CHARS_PER_TOKEN` 4 = 3 000 tokens, une seule constante dans `core`, importée par `data` — jamais recopiée) : le fournisseur ne peut pas produire une sortie que la garde jetterait. Avant, un budget de 4 000 tokens (justifié par un faux « ~2 caractères/token », alors que le français et le JSON sont à ~3-4) produisait ~12-16 k caractères pour une garde à 8 000 : une réponse **valide** de 9 000 caractères était payée au fournisseur puis jetée (« sortie LLM trop longue (I5) » → « Échec de l'assistant. »). Le corrigé maximal (`Homework.MAX_ANSWER_CHARS` 8 000) reste **atteignable** : il laisse la place de l'enveloppe JSON dans le plafond de sortie. Un refus de longueur nomme la **limite réelle**, jamais « hors format ».
- Test : `tests/architecture/invariants.test.ts` + `check-architecture.ts` (scan `android/core/`) + `tests/unit/android-homework.test.ts` (miroirs) + `tests/unit/android-revision.test.ts` (Kotlin compilé : consigne JSON de la fiche + garde I5) + `tests/unit/kotlin-llm-budget.test.ts` (Kotlin **exécuté** : la relation tokens/caractères, une réponse de 9 000 caractères acceptée, le refus qui nomme la limite, la chaîne complète fournisseur → garde → schéma).
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
authentification. Il reçoit une plateforme et une URL dans le corps de la
requête, sans les journaliser ; Playwright réutilise un cookie jar local
gitignoré (`playwright/.auth/manuals.json`) **choisi par le serveur** : le corps
ne peut plus en demander le nom — un nom de jar suffisait à appeler la
session d'un autre tenant (le répertoire était imposé, pas l'isolation, #538
et I24). Les identifiants de portail (`username`/`password`) sont **REFUSÉS**
(400, message dédié) : le scraper ne s'authentifie pas, la session est celle
du serveur — les exiger au contrat reviendrait à annoncer une authentification
qui n'existe pas (#526 et I28). La navigation est gardée
(`shared/contracts/net.ts` + `server/infrastructure/ssrf.ts` +
`server/infrastructure/manuals-scrape.ts`) :
hôte privé/interne refusé (IP littérale, entière, hexadécimale, IPv4-mapped
IPv6, ULA, link-local, métadonnées, **NAT64 local-use `64:ff9b:1::/48`
(RFC 8215) : préfixe non global, fail-closed — tout le préfixe est refusé**),
**nom d'hôte RÉSOLU avant la navigation**
(chaque adresse obtenue est testée contre les plages privées : un nom public
qui pointe vers une IP interne — rebinding — est refusé, motif explicite
`403 private_host` ; un nom introuvable est refusé aussi, `502
unresolved_host` ; jamais un échec muet), **chaîne de redirections vérifiée
avant le navigateur — autant de sauts que Chromium en suit (20)** : sous ce
plafond, le dernier saut partait vers une cible privée sans être vérifié ; au
delà, la chaîne est refusée (fail-closed) — et **URL finale re-vérifiée après
navigation**. Restent
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

**Page de connexion :** un portail qui ne reconnaît pas la session renvoie sa
page de login en **HTTP 200** — le test HTTP (`ok = status < 400`) la laissait
passer, et elle devenait un `ManualDoc` que l'assistant pouvait citer comme
source (« Se connecter »). Elle est maintenant refusée (motif `login_required`,
HTTP 502 `login_required`) AVANT extraction et AVANT écriture du jar : une
page de login n'écrase pas la session du serveur (#526 et I28).

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
- **Un scanner sans fichiers à scanner est un ÉCHEC, pas un « OK »** (#532) :
  les scanners passaient au VERT quand ils n'avaient rien à vérifier (un
  répertoire absent ou renommé rendait `listFiles` vide) — I1, I2, I3 et I9
  devenaient **vacuement vrais**, et chaque étape du gate annonçait « OK »
  sans avoir lu une seule ligne. `check-architecture.ts` exige `android/`,
  `android/core/` et `server/` présents ET peuplés ; `check-kotlin.ts` refuse
  un répertoire absent ou vide.
- Test : `tests/architecture/invariants.test.ts` (I9) +
  `tests/unit/check-architecture-scan.test.ts` (racine vide / répertoire
  renommé / répertoire vide = ÉCHEC) +
  `tests/architecture/kotlin-check.test.ts` (répertoire absent ou vide = FAIL).
- Commande : `make architecture-test`.
- Emplacement : `android/**/*`.

## I11 — Contenu vendorisé `.agents/` : docs, pas de passoire
- Invariant : `.agents/` (skills d'agents copiés depuis des dépôts tiers,
  verrouillés par `skills-lock.json`) n'est jamais un vecteur de fuite : un
  VRAI secret y échoue au scan anti-secrets, seuls les exemples de
  documentation passent. Le jeu de motifs strict du dépôt s'applique partout
  ailleurs. Aucun secret, domaine, IP ni donnée perso dans ce dossier.
  **Tous les matchs d'un motif sont inspectés** (#521) : le motif ne passe que
  si AUCUN match n'est un secret réel. Avant, seul le PREMIER match était
  inspecté — un placeholder en tête de fichier excusait le fichier **entier**,
  secret compris.
  **Le jeu de motifs VENDORED COUVRE toutes les formes du jeu du dépôt**
  (#522) : le carve-out peut être plus STRICT (exiger une preuve plus
  forte), jamais plus LARGE. Le jeu vendorisé ne couvrait ni le JWT ni les
  identifiants dans une URL, le jeu du dépôt si — le dossier tiers, le moins
  contrôlé, était donc le moins surveillé sur les deux formes les plus
  répandues. La preuve exigée par I11 s'applique : pour le JWT, les trois
  segments de longueur plausible ; pour une URL à identifiants, un mot de
  passe de 12 caractères ou plus.
  Le contenu vendorisé est VERROUILLÉ de façon vérifiable
  (#505) : le
  `computedHash` de `skills-lock.json` vient de l'outil `npx skills`, dont
  l'algorithme n'est pas documenté dans le dépôt — il n'est donc pas
  recalculable ici, et le lock amont ne prouve rien tout seul. Le test
  `skills-lock.test.ts` recalcule un sha256 de chaque ARBRE de skill
  (chemins + contenu) et le compare à une table : une édition manuelle d'une
  skill échoue le gate.
  **La PROVENANCE du lock amont est ÉPINGLÉE** (#534) : le test comparait les
  NOMS du lock au disque, sans `source`, `sourceType`, `skillPath` ni
  `computedHash` — éditer `source` vers un autre dépôt laissait le test VERT
  (le lock était décoratif côté provenance, et `npx skills update` irait
  chercher le contenu ailleurs). Le verrou vérifiable protège le CONTENU sur
  disque ; il ne dit pas d'où il vient. Une seule table porte les deux
  (empreinte + provenance), mise à jour dans la MÊME PR que le lock amont.
- Test : `tests/architecture/secret-scan.test.ts` (carve-out étroit) +
  `tests/architecture/skills-lock.test.ts` (l'empreinte de chaque arbre
  vendorisé) +
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
  natif présent ne retombe jamais sur le factice) +
  `tests/unit/build-web.test.ts` (le build Vite passe par
  `agents/runtime/build-web.ts` : plafond de durée par essai, UN réessai si le
  processus MORT — jamais s'il a échoué — et un diagnostic qui nomme la cause ;
  le build de l'APK passe par le même helper, donc la même protection —
  #516 : le binding natif de Vite peut mourir sans message et rougissait le
  gate pour un bundle intact).
- Commande : `make architecture-test` (ou `make check`).
- Emplacement : `web/src/bridge/client.ts`, `web/src/bridge/mock.ts`,
  `web/vite.config.ts`, `agents/runtime/build-web.ts`.

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
  Même règle dans l'INTERFACE (#537) : un payload CORROMPU (JSON illisible)
  n'est pas une absence de donnée — l'écran Notes affiche une erreur (« cache
  illisible »), jamais « aucune note en cache », et un fil de messagerie
  illisible n'est jamais présenté comme « un fil vide ». Les parseurs
  restent TOLÉRANTS (aucun crash) : c'est l'écran qui distingue « illisible »
  de « vide ».
- Test : `tests/unit/kotlin-core-validation-parity.test.ts` (Kotlin EXÉCUTÉ :
  `sources: "abc"` refusé, contrat invalide → `null` et aucun onglet masqué) +
  `tests/web/home.test.ts` et `tests/web/social.test.ts` (web : `capabilities:
  null` = inconnu, la sanction reste visible) + `tests/web/grades.test.ts` et
  `tests/web/messages.test.ts` (écrans RENDUS : cache illisible = erreur, pas
  un état vide).
- Commande : `make check`.
- Emplacement : `android/core/Humanize.kt`, `android/core/CapabilityProbe.kt`,
  `android/core/Capabilities.kt`, `android/core/CapabilitiesJson.kt`,
  `android/data/PronotePayloads.kt`, `web/src/features/attendance/model.ts`,
  `web/src/features/grades/model.ts`, `web/src/features/messages/model.ts`.

## I15 — L'export PDF d'une fiche garde le corps entier et ses sources
- Invariant : l'export PDF d'une fiche de révision rend le corps ENTIER
  (`RevisionPdf` pagine) et la liste CANONIQUE des sources (`sheet.sources`),
  jamais un bloc « Sources : » recopié du texte libre du modèle : une
  citation écrite par le modèle ne peut ni remplacer l'attribution ni
  introduire une source absente du corpus (citations validées comme le chemin
  devoirs, `HomeworkAi.parseHomeworkResponse`). Le bloc « Sources : » du modèle
  n'est retiré que s'il est le **dernier** bloc du corps : un « Sources : » au
  milieu (le cours en contient un, ou le modèle en cite un) ne mange plus le
  contenu qui suit — les puces qui ne sont pas des sources canoniques sont du
  CONTENU, elles restent (#499) ; une citation libre, elle, n'entre jamais dans
  la liste des sources. Une troncature — au-delà de
  la garde I5 (12 000 caractères) ou du filet de sécurité du rendu — est
  SIGNALÉE (« suite tronquée »), jamais silencieuse.
- Test : `tests/unit/kotlin-revision-sheet.test.ts` (Kotlin compilé : corps
  entier + bloc « Sources : » pour une fiche de 6 000 caractères, corps à
  « Sources : » qui ne remplace pas la liste canonique, troncature signalée).
- Commande : `make check`.
- Emplacement : `android/core/src/main/java/fr/veryslopnynotes/core/RevisionSheet.kt`,
  `android/core/src/main/java/fr/veryslopnynotes/core/RevisionPdf.kt`.

## I16 — Le cache ne sert jamais les données d'un autre compte
- Invariant : le cache est la DONNÉE D'UN COMPTE. Les clés de cache sont
  globales (`cache_grades_<empreinte de la requête>.txt`, sans compte — une
  entrée par requête depuis #477) et les TTL vont jusqu'à 24 h
  (capacités) : le cache est donc PURGÉ quand le compte change (appairage d'un
  autre compte) et quand la session est déclarée MORTE (jeton tourné). Purge et
  invalidation d'époque sont dans la MÊME section critique (#364) : une lecture
  en vol abandonne son payload, donc un cache purgé ne ressuscite pas. Une
  identité de compte INCONNUE purge aussi (fail-closed) ; l'identité vient de
  la session PERSISTÉE (endpoint + login), jamais de `AccountStore.current()`
  (qui vaut `null` tant que #397 est ouvert). Le login ne sort jamais (ni log,
  ni rapport de crash).
- Test : `tests/unit/kotlin-cache-scope.test.ts` (Kotlin EXÉCUTÉ : appairage
  d'un autre compte → le cache du précédent n'est plus servi ; appairage du
  MÊME compte → le cache est conservé ; session morte → purge ; lecture en vol
  → écriture refusée ; + le câblage `PairingRepository` / pont / job de fond) +
  `tests/unit/kotlin-cache-epoch.test.ts` (la purge reste sous la garde
  d'époque).
- Commande : `make check`.
- Emplacement : `android/data/CacheScope.kt`, `android/data/PairingRepository.kt`,
  `android/data/AccountStore.kt`, `android/data/PeriodicSyncWorker.kt`,
  `android/app/VsnBridge.kt`.

## I16 — Toute écriture dans `filesDir/offline/` respecte la purge de déconnexion
- Invariant : `filesDir/offline/` ne contient QUE de la donnée de compte, donc
  la purge de déconnexion l'efface EN TOUT (#404). Le cache n'est pas le seul
  à y écrire : les fiches de révision (`revisions/`) et les préférences
  matière (`subject_prefs.json`) y écrivent aussi — sous la MÊME garde
  d'époque que le cache (#364), donc une écriture EN VOL (une fiche générée
  pendant la déconnexion, une préférence enregistrée) est ABANDONNÉE : elle ne
  ressuscite pas le dossier purgé et n'y laisse pas le contenu scolaire ni les
  préférences du compte déconnecté. L'époque est capturée au DÉBUT de
  l'opération (une fiche passe par un appel LLM de plusieurs secondes) ; hors
  déconnexion, les écritures se font normalement. Les écritures d'UNE fiche
  (la fiche, son index, son journal) forment UNE tentative : si l'index ou le
  journal est REFUSÉ (l'époque a basculé entre deux écritures),
  l'enregistrement ÉCHOUE — le pont ne répond JAMAIS « ok » sans avoir écrit
  (I10, #528). L'état partiel ne laisse rien derrière : l'invalidation
  d'époque et la purge sont dans la MÊME section critique, donc le
  basculement qui refuse l'index a déjà purgé la fiche.
- Test : `tests/unit/kotlin-offline-artifacts.test.ts` (Kotlin EXÉCUTÉ : une
  écriture de fiche ou de préférences pendant un logout ne laisse AUCUN
  fichier ; hors déconnexion, les deux s'écrivent ; une écriture qui précède la
  purge est effacée par elle ; une déconnexion ENTRE la fiche et son index fait
  ÉCHOUER l'enregistrement ; + le câblage du pont et des stores).
- Commande : `make check`.
- Emplacement : `android/data/OfflineArtifacts.kt`, `android/data/SubjectPrefs.kt`,
  `android/core/RevisionSheet.kt`, `android/app/VsnBridge.kt`.

## I17 — Le rafraîchissement de session est atomique
- Invariant : le client PRONOTE ne fait JAMAIS deux rafraîchissements en même
  temps, et les champs partagés (`communication`, attributs, clé AES) ne sont
  jamais permutés pendant qu'une requête est en vol. `Client.post` et
  `Client.refresh` partagent le moniteur du client ; la porte `RefreshGate`
  (un CAS) n'admet qu'UN rafraîchissement à la fois et est relâchée même
  quand le rafraîchissement ÉCHOUE (le `finally`). Avant #405, `_refreshing`
  était un `var Boolean` nu : le job de fond et la lecture de l'interface
  lisaient `false` en même temps et déclenchaient deux `refresh()` — donc deux
  `Communication` (deux cookies, deux compteurs de requêtes), le champ
  finissant sur celle qui avait fini la dernière et les requêtes
  entrelacées (clé AES mélangée) : le serveur répondait `G=25` (« Exceeded
  max authorization requests ») ou la session restait à moitié initialisée.
  Le perdant de la course ATTEND le rafraîchissement et rejoue sa requête sur
  la session neuve (aucune erreur ne remonte à l'appelant).
- Test : `tests/unit/kotlin-refresh-gate.test.ts` (Kotlin EXÉCUTÉ : N threads
  lâchés en même temps → un seul gagnant ; la porte se rend après un échec) +
  `tests/unit/kotlin-pronote-client-parity.test.ts` (Kotlin EXÉCUTÉ contre le
  stub PRONOTE : deux requêtes concurrentes → un seul handshake de refresh,
  les deux fils réussissent, fil de requêtes identique à la référence TS) +
  `tests/architecture/pronote-refresh.test.ts` (garde de source : plus de
  drapeau non atomique, `post`/`refresh` synchronisés, porte relâchée dans
  le `finally`).
- Commande : `make check`.
- Emplacement : `android/pronote/src/main/java/fr/veryslopnynotes/pronote/Client.kt`,
  `android/pronote/src/main/java/fr/veryslopnynotes/pronote/RefreshGate.kt`.

## I18 — L'échec du Keystore est un ÉTAT, pas un silence
- Invariant : un Keystore indisponible (écran de verrouillage changé, appareil
  verrouillé depuis le démarrage) fait basculer les stores sur le repli
  MÉMOIRE — jamais un secret en clair — mais ce repli est **SIGNALÉ** :
  l'état `UNAVAILABLE` est marqué (`SecureStorage`), publié par le pont
  (`session.status` / `session.restore`, champ `storage`) et AFFICHÉ par
  l'interface (écran d'appairage, réglages). Sans cela, l'app croyait en
  silence ne pas être appairée et la clé de l'assistant disparaissait sans
  explication. Les stores ne journalisent JAMAIS (ils tiennent le jeton et la
  clé) : le journal est dans le pont, borné, sans secret ni chemin.
- Test : `tests/unit/kotlin-store-health.test.ts` (Kotlin EXÉCUTÉ : la décision
  « Keystore KO → `UNAVAILABLE` », l'état qui RESTE dégradé, les deux `catch`
  qui marquent l'échec, le journal borné et sans secret) +
  `tests/web/session.test.ts` (l'état est lu, propagé à l'interface et
  affiché).
- Commande : `make check`.
- Emplacement : `android/data/StoreHealth.kt`, `android/data/SessionStore.kt`,
  `android/data/LlmKeyStore.kt`, `android/app/VsnBridge.kt`,
  `web/src/lib/session.ts`, `web/src/ui/AppContext.tsx`.

## I19 — Le job de fond lit par la file PARTAGÉE
- Invariant : toute lecture de l'interface (ressources cachées) ET toute lecture
  du job de fond passent par LA MÊME file partagée (`ClientQueue`), jamais en
  direct sur le client. Le `Client` est MUTABLE (`refresh()` réassigne
  `communication`, `attributes` et la clé AES) : une lecture de l'écran et une
  du job en parallèle = deux authentifications sur le même compte = « Exceeded
  max authorization requests » (erreur 25) → l'établissement LIMITE le compte.
  UNE SEULE instance de file (une file par dépôt ne partagerait pas les
  requêtes EN VOL, donc le dédoublonnage ne vaudrait pas pour tous) ; les clés
  sont NAMESPACÉES par producteur (`ressource|query` pour les écrans,
  `job|ressource|` pour le job) : un résultat n'est jamais livré à un
  producteur d'un autre type. Le job de fond est BLOQUANT (`Worker.doWork`) : il
  pose sa lecture dans la file et ATTEND, avec un délai BORNÉ (au-delà :
  `Result.retry()` — il ne bloque jamais WorkManager indéfiniment). La
  sémantique de résultat est INCHANGÉE : session MORTE = appairage
  (`DeviceAuth.reject()` + succès), autre échec = réessai, absence de session =
  réessai. Un travail qui JETTE est un ÉCHEC LIVRÉ (I28), pas une attente.
- Périmètre : les lectures de RESSOURCES CACHÉES (celles que le job relit). Les
  dépôts à usage ponctuel (profil, bascule de devoir, messagerie) gardent leur
  propre `Thread` : hors périmètre ici (le verrou de session atomique, I17,
  borne déjà leur impact).
- Test : `tests/architecture/shared-queue.test.ts` (une file pour tous ; le job
  ne lit plus le client en direct ; les ressources du job n'ont qu'une porte
  d'entrée) + `tests/unit/kotlin-local-queue.test.ts` (Kotlin EXÉCUTÉ :
  l'interface et le job ne se croisent pas, l'attente du job est bornée, une
  seule instance, un travail qui jette livre son échec à tous les callbacks —
  I28) + `tests/unit/kotlin-sync-worker.test.ts` (Kotlin EXÉCUTÉ :
  la décision session morte / réessai, la lecture qui jette devient un
  résultat).
- Commande : `make check`.
- Emplacement : `android/data/ClientQueue.kt`, `android/data/CachedReads.kt`,
  `android/data/SyncedRepository.kt`, `android/data/PeriodicSyncWorker.kt`,
  `android/data/SyncJobOutcome.kt`, `android/data/SessionFailure.kt`.

## I20 — Le pont ne sature pas : un fil par appel, le LLM à part
- Invariant : le pont natif ne fait JAMAIS la queue. Un appel JS repart sur son
  PROPRE fil (`BridgeExecutors.calls()`, pool non borné) : `app.back` (le bouton
  retour) répond même avec cinq lectures de l'accueil et deux appels LLM en
  vol. Avant #393, un pool fixe de DEUX fils était immobilisé par l'attente de
  chaque lecture (le `await` du pont bloque jusqu'à 20 s, 45 s pour le LLM) :
  le retour était mort 20 s, et deux appels LLM gelaient le pont. Les
  opérations LLM ont leur PROPRE file, bornée à deux fils
  (`BridgeExecutors.llm()`) : elles ne prennent plus les fils des appels
  ordinaires.
  Côté interface, les LECTURES sont sérialisées (`MAX_PARALLEL_READS = 1` dans
  `web/src/bridge/types.ts`) : le natif les sérialise déjà (une file locale
  partagée avec le job de fond, #403) et son délai d'appel ne couvre QUE le
  travail — en parallèle, la N-ième lecture attend son tour et son délai expire
  AVANT lui (« Lecture indisponible. », puis « le téléphone n'a pas répondu »
  côté JS). Une lecture en vol = le budget d'une lecture (délai HTTP de
  l'établissement) tient dans le délai natif d'un appel.
  Les délais restent HIÉRARCHISÉS : le plafond natif (20 s + 45 s) reste sous
  le délai JS (90 s) — inégalité inchangée, miroir TS ↔ Kotlin compris.
- Test : `tests/unit/kotlin-bridge-executors.test.ts` (Kotlin EXÉCUTÉ : cinq
  appels longs en vol n'immobilisent pas un appel court ; la file LLM est à part
  et bornée à deux fils ; plus de pool fixe dans le pont) +
  `tests/web/bridge.test.ts` (les cinq lectures de l'accueil : une seule en
  vol, les cinq aboutissent ; le bouton retour ne fait pas la queue ; le
  nombre de lectures en vol tient dans le délai natif, relation vérifiée sur
  le Kotlin de production).
- Commande : `make check`.
- Emplacement : `android/app/src/main/java/fr/veryslopnynotes/app/BridgeExecutors.kt`,
  `android/app/src/main/java/fr/veryslopnynotes/app/VsnBridge.kt`,
  `web/src/bridge/client.ts`, `web/src/bridge/types.ts`.
## I21 — Une session morte purge la session ET le cache
- Invariant : le signal « session morte » (`DeviceAuth.reject()`) a UN abonné —
  l'app (le pont). Le rejet invalide la session PERSISTÉE, abandonne la session
  en mémoire et PURGE le cache, par le chemin EXISTANT (`AccountStore.logout()`
  -> `SessionRepair.purge` -> `CacheScope.purge`, donc sous la garde d'époque).
  Sans ça, le natif gardait le jeton mort et servait un cache périmé comme
  frais. La purge ne lève jamais le signal (pas de boucle) et n'échoue jamais
  celui qui le lève. Le compte appairé est ENREGISTRÉ à l'appairage
  (`accounts.add`) : le magasin multi-compte n'est plus vide.
  **Un objet d'une session PRÉCÉDENTE n'est pas une session morte** (G=22,
  `ExpiredObject`) : son message contient le mot « session », donc la décision
  tranche par TYPE, pas par motif (#485) — sinon un simple objet périmé
  déconnectait l'élève ET purgeait le cache hors ligne.
- Test : `tests/unit/kotlin-sync-worker.test.ts` (Kotlin réel : G=22 = réessai,
  pas « session morte » ; le vrai message de production est utilisé) +
  `tests/unit/kotlin-session-repair.test.ts` (Kotlin réel : le rejet
  purge la session et le cache) + `tests/architecture/session-repair.test.ts`
  (câblage : l'abonné, le chemin de purge, l'enregistrement du compte).
- Commande : `make check`.
- Emplacement : `android/data/src/main/java/fr/veryslopnynotes/data/DeviceAuth.kt`,
  `android/data/src/main/java/fr/veryslopnynotes/data/SessionRepair.kt`,
  `android/data/src/main/java/fr/veryslopnynotes/data/AccountStore.kt`,
  `android/data/src/main/java/fr/veryslopnynotes/data/PairingRepository.kt`,
  `android/app/src/main/java/fr/veryslopnynotes/app/VsnBridge.kt`.

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

## I23 — L'image du scraper n'est ni root ni en clair
- Invariant : l'image Docker du scraper tourne sous un utilisateur NON
  PRIVILÉGIÉ (le jar de session lui appartient, pas à root) et REFUSE de
  démarrer sans `TLS_CERT_FILE`/`TLS_KEY_FILE` : le service est sans
  authentification (I8), il ne doit jamais être joignable en CLAIR. Elle ne
  force pas `HOST` : l'exposition hors du conteneur est une décision EXPLICITE
  de l'opérateur, comme pour `make runServer` (boucle locale par défaut).
  L'image est donc alignée sur `make runServer` : TLS obligatoire, exposition
  décidée, jamais de repli silencieux en clair (#533).
- Test : `tests/unit/server-image-playwright.test.ts` (USER non root, jar
  appartenant à cet utilisateur, TLS obligatoire dans le CMD, pas de `HOST`
  forcé, `HOME` de l'utilisateur).
- Commande : `make check`.
- Emplacement : `Dockerfile.server`, `server/README.md`, `docs/RELEASE.md`.

## I24 — Le jar de session est choisi par le serveur
- Invariant : le cookie jar Playwright monté par le navigateur est celui du
  SERVEUR. Le corps de la requête ne peut plus en demander le NOM : le
  répertoire était imposé (#362), mais pas l'isolation — un nom de jar
  suffisait à appeler la session d'un AUTRE tenant (le nom ne se déduisait pas
  du contenu de la session, il l'appelait). Le champ `authFile` a donc
  disparu du contrat, et un corps qui le porte est REFUSÉ (400, message
  dédié) : le jar n'est pas un paramètre de requête.
- Test : `tests/unit/scraper-ssrf.test.ts` (un corps qui demande un jar est
  refusé — ni navigateur, ni jar monté, rien d'écrit ; le seul jar monté est
  celui du serveur) + `tests/unit/scraper-only.test.ts` (le scrape part avec
  le jar du serveur) + `tests/contracts/contracts.test.ts` (le contrat ne
  déclare plus le champ).
- Commande : `make check`.
- Emplacement : `shared/contracts/api.ts`, `shared/contracts/api.openapi.yaml`,
  `server/infrastructure/http.ts`, `server/infrastructure/manuals-scrape.ts`.


## I25 — Un payload n'est affiché que pour SA requête
- Invariant : le payload d'une ressource est RATTACHÉ à sa requête (clé +
  query). Changer de requête (période, algorithme, semaine) INVALIDE le
  payload précédent : l'écran montre un chargement, JAMAIS les chiffres d'une
  autre requête. Un chargement en échec n'affiche JAMAIS le payload d'une
  autre requête non plus (l'ancien rapport resterait affiché indéfiniment
  sous le nouveau sélecteur, avec la ligne d'erreur en dessous) — #527. Même
  esprit que I14 : une donnée qui ne vaut pas pour ce qu'on demande n'est
  jamais présentée comme si elle valait. Le rafraîchissement d'une MÊME
  requête (geste « Actualiser ») garde le cache affiché : c'est le
  offline-first, pas une invalidation.
- Test : `tests/web/grades.test.ts` (écran RENDU : changer de période → le
  héros ne montre plus la moyenne de la période précédente ; le chargement en
  échec n'affiche aucun payload ; le rafraîchissement de la même requête garde
  le cache) + le câblage vérifié dans le même fichier.
- Commande : `make check`.
- Emplacement : `web/src/lib/resource.ts` (règles pures), `web/src/ui/AppContext.tsx`
  (`useResource`), `web/src/features/grades/components.tsx` (écran pur
  `GradesScreen`), `web/src/routes/grades.tsx`.

## I26 — Les fichiers téléchargés ne se chevauchent pas et ne s'accumulent pas
- Invariant : une pièce jointe téléchargée est écrite dans le cache sous un nom
  qui porte son IDENTIFIANT (`42-consigne.pdf`), jamais son seul LIBELLÉ :
  deux pièces distinctes du même devoir ne peuvent donc pas viser le même
  chemin (la seconde n'écrase plus la première, le viewer n'ouvre plus le
  mauvais document). Le cache des téléchargements est BORNÉ (24 fichiers, les
  plus anciens partent) et PURGÉ avec le cache du compte (déconnexion,
  changement de compte, session morte) : un fichier téléchargé est la DONNÉE
  DU COMPTE, comme le cache. L'écriture passe par la garde d'époque : une
  pièce téléchargée pendant une déconnexion n'est PAS écrite, donc le cache
  purgé ne ressuscite pas.
- Test : `tests/unit/downloaded-files.test.ts` (Kotlin EXÉCUTÉ : deux pièces du
  même devoir portant le même libellé donnent deux fichiers distincts, chacun
  avec son contenu ; le nom porte l'identifiant ; le cache est borné ; la purge
  de déconnexion ET le changement de compte effacent les pièces jointes ; une
  écriture pendant une déconnexion est refusée ; + le câblage du pont et du
  job de fond).
- Commande : `make check`.
- Emplacement : `android/data/DownloadedFiles.kt`, `android/data/LocalDataStore.kt`,
  `android/app/Attachments.kt`, `android/app/VsnBridge.kt`,
  `android/data/PeriodicSyncWorker.kt`.


## I27 — Une réponse tardive n'écrit que dans le fil qui l'attend
- Invariant : une réponse qui arrive APRÈS un changement d'écran est
  PÉRIMÉE : elle n'écrit rien dans l'écran. Dans la messagerie (#524), la
  réponse d'un ENVOI ne peut écrire que dans le fil qui était OUVERT au
  moment de l'envoi : sinon les messages du fil A s'affichaient sous
  l'en-tête du fil B, et le brouillon tapé dans B disparaissait. Pendant un
  envoi, le fil ne change pas (bouton Retour désactivé) ; seul le brouillon
  ENVOYÉ est effacé (un brouillon tapé pendant l'attente reste). Le
  rechargement d'un fil suit la même règle depuis #501 : une réponse de
  chargement dépassée n'écrit pas dans l'écran.
- Test : `tests/web/messages.test.ts` (garde PURE
  `web/src/features/messages/reply.ts` : la réponse d'un envoi est ignorée
  dès que le fil affiché a changé — le fil B garde SES messages et SON
  brouillon ; la réponse d'un envoi s'applique à son propre fil ; revenir au
  fil d'origine ne ressuscite pas une réponse périmée ; le bouton Retour est
  désactivé pendant l'envoi) + `tests/web/messages.test.ts` (#501 : la
  séquence ignore la réponse d'une demande dépassée).
- Commande : `make check`.
- Emplacement : `web/src/features/messages/reply.ts`,
  `web/src/routes/messages.tsx`, `web/src/features/messages/MessagesScreen.tsx`,
  `web/src/lib/seq.ts`.



## I28 — La file locale livre TOUJOURS un résultat (jamais de promesse pendante)
- Invariant : un travail de la file locale (`LocalRequestQueue`, partagée par
  `ClientQueue`) qui JETTE livre son ÉCHEC à TOUS les callbacks de la clé
  (`QueueOutcome.Failed`) : l'échec est une VALEUR, pas une exception. Avant,
  l'exception était RELANCÉE : les callbacks n'étaient jamais appelés — la
  promesse JS attendait le délai natif complet (20 s), le job de fond brûlait
  ses 120 s, et les co-demandeurs de la même clé n'étaient jamais servis.
  `Throwable` et non `Exception` : un `Error` (OOM) est un échec comme un
  autre, il ne laisse pas les callbacks en attente non plus. Le cast interne de
  `ClientQueue` est VÉRIFIÉ (`reified`) : une collision de clés (deux types
  pour une même clé) livre l'échec au callback fautif au lieu de l'avaler en
  silence. Un callback qui JETTE n'affame pas les autres de la volée — il est
  SIGNALÉ, jamais avalé en silence.
- Test : `tests/unit/kotlin-local-queue.test.ts` (Kotlin EXÉCUTÉ : une
  exception → tous les callbacks de la clé reçoivent l'échec ; un `Error`
  aussi ; la file PARTAGÉE réveille l'attente du job de fond ; une collision de
  clés livre l'échec du cast) + `tests/architecture/shared-queue.test.ts` (le
  câblage de la file partagée).
- Commande : `make check`.
- Emplacement : `android/data/LocalRequestQueue.kt`, `android/data/ClientQueue.kt`,
  `android/data/SyncedRepository.kt`, `android/data/PeriodicSyncWorker.kt`.
 (data: la file locale livre l'échec à tous les callbacks de la clé)
 (data: la file locale livre l'échec à tous les callbacks de la clé)

## I29 — Le scraper ne s'authentifie pas, une page de connexion n'est pas un manuel
- Invariant : deux promesses que le contrat faisait mais que le code ne
  tenait pas.
  1. **Aucun identifiant n'est collecté pour rien.** Le contrat exigeait
     `username`/`password`, le serveur les recevait et les transmettait — mais
     AUCUN chemin de code ne les lisait : le navigateur monte le jar de
     session du SERVEUR (I24). Les deux champs ne sont donc PLUS REQUIS par le
     contrat (optionnels, pour que les appelants existants compilent), et le
     serveur REFUSE un corps qui les porte (400, message dédié qui NOMME les
     champs). Le scraper ne reçoit que la plateforme.
  2. **Une page de connexion n'est jamais ingérée.** Un portail qui ne
     reconnaît pas la session renvoie sa page de login en HTTP 200 : le test
     HTTP (`ok = status < 400`) la laissait passer, et elle devenait un
     `ManualDoc` — donc une SOURCE que l'assistant pouvait citer (« Se
     connecter »). Elle est refusée (motif `login_required`, HTTP 502
     `login_required`) AVANT extraction et AVANT écriture du jar (une page de
     login n'écrase pas la session du serveur). Le signal : un champ MOT DE
     PASSE (le formulaire d'authentification en a toujours un, une page de
     manuel jamais).
- Test : `tests/unit/scraper-only.test.ts` (le contrat n'exige plus
  d'identifiants ; un corps qui les porte = 400 dédié, aucun scrape, aucun
  log ; une page de login en 200 = refus, jamais un `ManualDoc` ; une vraie
  page de manuel reste ingérée) + `tests/contracts/contracts.test.ts` (le
  contrat reflète l'usage réel : `required: [platform, startUrl]`).
- Commande : `make check`.
- Emplacement : `shared/contracts/api.ts`, `shared/contracts/api.openapi.yaml`,
  `server/infrastructure/http.ts`, `server/infrastructure/manuals-scrape.ts`.
