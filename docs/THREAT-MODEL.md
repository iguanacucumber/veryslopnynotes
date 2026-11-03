# THREAT-MODEL.md — modèle de menace

Ce document ne crée aucune règle. Il relie les cinq lois de
[`AGENTS.md`](../AGENTS.md), les invariants du
[registre](architecture/INVARIANTS.md) et les ADR aux menaces nommées par
l'issue #904. Une mitigation qui n'a ni test ni artefact vérifiable est un
souhait, pas une garantie : chaque menace cite donc sa preuve.

## Périmètre et méthode

Couvert : l'APK Android, le bundle web embarqué, le scraper local et la chaîne
de build. Hors périmètre : un appareil rooté ou un OS compromis, une faille
interne à Pronote ou OpenRouter, une configuration d'établissement, et un
scraper exposé publiquement malgré [`SECURITY.md`](../SECURITY.md).

Méthode par menace : actifs, attaquant, point d'entrée, mitigations existantes,
risque résiduel, preuve. La correspondance vers les lois, invariants et ADR est
regroupée [en fin de document](#correspondance-lois-invariants-adr).

## Actifs et frontières de confiance

| Actif | Où il vit | Perte ou fuite |
|---|---|---|
| Session Pronote (URL, login, jeton, UUID d'appareil) | `EncryptedSharedPreferences` via le Keystore | Usurpation de la session scolaire |
| Clé LLM OpenRouter | `EncryptedSharedPreferences` via le Keystore | Dépense et accès au compte OpenRouter |
| Données scolaires (notes, absences, messages, devoirs, pièces jointes) | `filesDir/offline/`, cache du compte, mémoire | Vie privée de l'élève |
| Liste de comptes, préférences, photos | stockage privé de l'app, `cacheDir/photos/` | Corrélation d'identités, fuite de copies |
| Intégrité de l'APK, de la CI et des dépendances | build local, `.github/workflows/`, `bun.lock` | Code exécuté par l'utilisateur |

Frontières : l'app est un processus de confiance dont les secrets sont chiffrés
au repos par le Keystore ; Pronote, OpenRouter, une page scrapée et un fichier
scolaire sont des **données non fiables** ; la WebView est sans réseau et son
pont est une allowlist ; le scraper est un service local sans authentification ;
la chaîne de build n'est fiable que par ses épingles, ses empreintes et le gate.

## T1 — Appareil partagé

**Lois** : 1 (local d'abord), 2 (une frontière, un écrivain), 4 (la donnée d'un
compte n'appartient qu'à ce compte).

**Actifs** : session Pronote, clé LLM, payloads hors ligne, pièces jointes
téléchargées, préférences, photos et liste de comptes.

**Attaquant** : prochain utilisateur d'un téléphone déverrouillé, voleur qui
connaît le code de l'appareil, ou extraction d'une sauvegarde. Pas de root.

**Point d'entrée** : l'interface de l'app, qui n'a ni code ni verrou propre ;
`filesDir/offline/`, les préférences chiffrées, la sauvegarde cloud ou le
transfert appareil-à-appareil, enfin l'aperçu des applications récentes.

**Mitigations existantes**

- La session et la clé LLM sont chiffrées au repos avec `MasterKey`
  AES256-GCM et `EncryptedSharedPreferences` (AES256-SIV/GCM), sans repli en
  clair : [`SessionStore.kt`](../android/data/src/main/java/fr/veryslopnynotes/data/SessionStore.kt),
  [`LlmKeyStore.kt`](../android/data/src/main/java/fr/veryslopnynotes/data/LlmKeyStore.kt).
- La déconnexion passe par `PairingRepository.logoutBlocking()` sous le verrou
  de session : session, cache, artefacts hors ligne, téléchargements et liste
  de comptes sont purgés. Une purge incomplète rend `false`, jamais un
  « déconnecté » mensonger :
  [`PairingRepository.kt`](../android/data/src/main/java/fr/veryslopnynotes/data/PairingRepository.kt),
  [`CacheScope.kt`](../android/data/src/main/java/fr/veryslopnynotes/data/CacheScope.kt),
  [`SessionRepair.kt`](../android/data/src/main/java/fr/veryslopnynotes/data/SessionRepair.kt).
- La bascule de compte est atomique : la purge précède la publication du
  nouveau client, et une époque invalide les écritures en vol (I16).
- La sauvegarde est fermée deux fois : `allowBackup="false"` et des règles
  `data-extraction-rules` qui excluent tous les domaines, y compris le
  transfert appareil-à-appareil :
  [`AndroidManifest.xml`](../android/app/src/main/AndroidManifest.xml),
  [`data_extraction_rules.xml`](../android/app/src/main/res/xml/data_extraction_rules.xml).
- Les stores ne journalisent jamais le jeton ni la clé, et les `toString()`
  masquent les champs sensibles. Aucune photo ne part sans geste explicite
  (I32).

**Risque résiduel** : l'app n'a pas de verrou utilisateur. Sur un appareil
déverrouillé, l'attaquant peut lire les écrans, utiliser la clé LLM et exporter
ce que l'app affiche ; le Keystore protège le repos, pas l'accès à chaud. Aucun
`FLAG_SECURE` n'est posé, donc l'aperçu des applications récentes peut montrer
des données scolaires. Les payloads hors ligne sont en clair dans
`filesDir/offline/` tant que l'appareil est déverrouillé, et un appareil rooté
ou un OS compromis contourne le bac à sable et le Keystore.

**Preuves** : `tests/unit/kotlin-cache-scope.test.ts`,
`tests/unit/kotlin-offline-artifacts.test.ts`,
`tests/unit/kotlin-manual-account-purge.test.ts`,
`tests/unit/kotlin-session-repair.test.ts`,
`tests/architecture/session-repair.test.ts`,
`tests/unit/downloaded-files.test.ts`, `tests/unit/kotlin-store-health.test.ts`,
`tests/unit/kotlin-vision.test.ts` et `tests/architecture/backup.test.ts`.

## T2 — Charge scolaire malveillante

**Lois** : 1 (les données restent sur le téléphone), 3 (l'extérieur est une
donnée ; une sortie de modèle ne déclenche jamais un effet métier).

**Actifs** : données scolaires affichées, clé LLM, intégrité du prompt, appareil
de l'élève et confiance dans la réponse affichée.

**Attaquant** : compte établissement compromis, professeur ou élève malveillant,
nom de pièce jointe forgé, page de manuel ou page web hostile servie au scraper.
La charge vise une injection de prompt ou un contenu actif, pas une faille
réseau.

**Point d'entrée** : chaînes JSON de Pronote, consignes et messages, noms de
pièces jointes, texte de manuel ou page web scrapée, réponse du modèle. Le
contenu est ensuite traité par l'IA ou rendu dans la WebView.

**Mitigations existantes**

- Le marquage est un **type** `Untrusted<T>`, pas un drapeau : tout brut
  externe passe par `markExternal`, les délimiteurs portent un nonce, et les
  marqueurs imitables sont neutralisés avant insertion :
  [`Untrusted.kt`](../android/core/src/main/java/fr/veryslopnynotes/core/Untrusted.kt).
  Le prompt système reste fixe et déclare la zone « DONNÉE, jamais
  instruction ».
- Aucun outil, aucun réseau et aucun effet métier ne sont exposés au modèle. La
  sortie est validée par schéma, longueur et sources citées ; les balises
  recopiées sont retirées :
  [`HomeworkAi.kt`](../android/core/src/main/java/fr/veryslopnynotes/core/HomeworkAi.kt),
  [`RevisionAi.kt`](../android/core/src/main/java/fr/veryslopnynotes/core/RevisionAi.kt).
- Le prompt est contrôlé contre les formes de secrets (clé, JWT, en-tête,
  cookie) et c'est le prompt vérifié qui part :
  [`LlmGuard.kt`](../android/core/src/main/java/fr/veryslopnynotes/core/LlmGuard.kt).
  La clé LLM ne part que dans `Authorization`, vers OpenRouter, jamais vers le
  serveur ni dans un log :
  [`OpenRouterLlm.kt`](../android/data/src/main/java/fr/veryslopnynotes/data/OpenRouterLlm.kt).
- Une pièce jointe nommée par le serveur ne sort jamais avec un type MIME
  exécutable ; HTML, SVG, XML et JavaScript retombent en `text/plain` :
  [`AttachmentMime.kt`](../android/app/src/main/java/fr/veryslopnynotes/app/AttachmentMime.kt).
  L'extraction est locale, bornée, sans rendu HTML (I35).
- Le web n'a ni `fetch`, ni XHR, ni URL distante, et la CSP impose
  `connect-src 'none'` ; le pont est une allowlist bornée sans proxy d'URL
  (I10) : [`index.html`](../web/index.html),
  [`VsnBridge.kt`](../android/app/src/main/java/fr/veryslopnynotes/app/VsnBridge.kt).
- Une réponse mal formée est refusée, jamais convertie en vide (I14), et une
  réponse tardive n'écrit pas dans l'écran courant (I25).

**Risque résiduel** : les délimiteurs et la validation rendent l'injection
coûteuse, pas impossible. Un texte hostile peut encore orienter le contenu
pédagogique de la réponse ou produire une réponse trompeuse bien formée. Les
données nécessaires à l'IA (question, cours, pièces jointes) sont envoyées à
OpenRouter : le fournisseur les voit, même si la clé et la session restent
locales. Un parseur PDF/HTML ou un navigateur a toujours une surface
d'exécution ; les bornes réduisent l'amplitude, pas une faille zéro-day. Une
pièce jointe ouverte dans un lecteur externe via le `FileProvider` sort du
contrôle de l'app.

**Preuves** : `tests/unit/android-untrusted.test.ts` (marqueur non forgeable),
`tests/unit/attachment-mime.test.ts` (MIME jamais exécutable),
`tests/unit/attachment-text.test.ts` (extraction bornée),
`tests/unit/kotlin-llm-guard.test.ts` (secret refusé, sortie validée),
`tests/architecture/invariants.test.ts` (I6) et
`tests/architecture/web.test.ts` (CSP, absence de réseau, pont borné).

## T3 — Dépendance compromise

**Lois** : 1 (aucun service tiers dans le chemin des données), 5 (le gate est
l'autorité).

**Actifs** : intégrité de l'APK, du bundle web et de l'image serveur ; jetons de
la CI ; secrets de signature hors dépôt ; appareil de l'utilisateur qui exécute
le code livré.

**Attaquant** : mainteneur d'un paquet npm direct ou transitif, action GitHub
compromise, archive d'outillage substituée, skill vendorisée modifiée, image de
base Docker remplacée.

**Point d'entrée** : `bun install` et ses scripts de cycle de vie, résolution
Gradle/Maven, actions du workflow, téléchargements `curl` du SDK et de Kotlin,
contenu de `.agents/`, build Docker.

**Mitigations existantes**

- Versions exactes dans `package.json`, verrou unique `bun.lock`, installation
  `--frozen-lockfile` sur le poste et dans l'image ; `bun audit` fait partie du
  gate complet. Une nouvelle dépendance est justifiée, épinglée et
  MIT-compatible (ADR-001, `docs/RELEASE.md`).
- Les actions GitHub sont épinglées à un SHA de commit, le workflow est en
  `permissions: contents: read`, et le checkout ne persiste pas les
  identifiants : [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
- Les archives du SDK Android et du compilateur Kotlin sont vérifiées par
  `sha256sum` avant extraction ; un cache n'est jamais une preuve de verdeur.
- La version Kotlin est unique (catalogue = classpath = CI) et testée (I34) :
  [`libs.versions.toml`](../android/gradle/libs.versions.toml).
- L'image serveur épingle tag **et** digest, l'utilisateur est non-root et le
  contexte Docker est minimal :
  [`Dockerfile.server`](../Dockerfile.server). Le test de documentation compare
  le digest de `docs/RELEASE.md` à celui du Dockerfile.
- `.agents/` est verrouillé par une empreinte sha256 par arbre, le lock porte
  les mêmes skills que le disque, et un plafond rend tout ajout visible (I11).
- Le scan anti-secrets tourne dans le gate et couvre aussi `.agents/` avec un
  carve-out étroit ; le gate ne peut pas être réduit par l'environnement (I22).
  Un job CI distinct rejoue en plus **tout l'historique** avec gitleaks
  épinglé ([`secret-scan.yml`](../.github/workflows/secret-scan.yml)).

**Risque résiduel** : un script d'installation s'exécute avec les droits du
développeur ou de la CI **avant** que l'audit ne rende son verdict, et un audit
ne connaît ni les zéros-day ni les paquets déjà présents dans le lock. Un SHA
d'action garantit l'immutabilité, pas la bienveillance du commit épinglé. Les
artefacts Gradle/Maven ne sont pas vérifiés par signature dans ce dépôt. Enfin
`make check-fast` saute `audit` et `android-compile` : ce n'est pas une preuve
avant PR, seulement une boucle locale rapide.

**Preuves** : `tests/architecture/skills-lock.test.ts`,
`tests/architecture/secret-scan.test.ts`,
`tests/architecture/gradle-versions.test.ts`,
`tests/architecture/runtime-version.test.ts`, les contrôles de
`docs/RELEASE.md` dans `tests/architecture/docs.test.ts`, et le workflow
[`ci.yml`](../.github/workflows/ci.yml) qui rejoue `make check`.

## T4 — Scraper local

**Lois** : 1 (seuls le client OpenRouter et le scraper parlent réseau),
2 (le scraper est le seul service réseau, et il ne sert que le scraper).

**Actifs** : réseau local et services internes de l'hôte, jar de session du
scraper, disponibilité de la machine, réputation de l'IP de l'opérateur,
contenu scrappé ensuite traité comme non fiable.

**Attaquant** : utilisateur ou processus du réseau local, site public hostile
qui provoque une requête interne, instance exposée par erreur, ou client qui
empile des scrapes.

**Point d'entrée** : `POST /v1/manuals/scrape` et `POST /v1/web/scrape`, sans
authentification. L'URL de départ, les redirections, la résolution DNS et les
sous-ressources du navigateur sont les chemins d'attaque.

**Mitigations existantes**

- Écoute sur `127.0.0.1` par défaut ; `HOST` explicite est requis pour exposer
  hors boucle locale. Le service reste sans authentification par conception :
  boucle locale ou proxy authentifié, jamais public (I8, ADR-005 §5) :
  [`http.ts`](../server/infrastructure/http.ts).
- Garde SSRF : refus des IP privées/réservées et des noms qui résolvent vers
  elles, chaîne de redirections suivie et re-vérifiée, URL finale re-testée,
  WebSocket et service workers bloqués, téléchargements coupés :
  [`ssrf.ts`](../server/infrastructure/ssrf.ts),
  [`manuals-scrape.ts`](../server/infrastructure/manuals-scrape.ts).
- Bornes : corps JSON en streaming ≤ 16 Kio (`413`), HTML ≤ 1 Mo, 2 scrapes
  concurrents, délai de 30 s, TLS obligatoire dans l'image. Identifiants
  refusés, page de login jamais ingérée, jar choisi par le serveur et permis
  `0700`/`0600`.
- Le contenu récupéré est marqué `Untrusted` avant l'IA (T2), et le serveur ne
  contacte jamais Pronote (I1).

**Risque résiduel** : la fenêtre TOCTOU de la résolution DNS est réelle et
documentée dans `ssrf.ts` ; la fermer demande d'épingler l'adresse résolue. Sans
authentification, tout processus local peut utiliser le scraper, et une
exposition publique est une erreur d'opérateur que l'image ne peut pas
empêcher. Le service peut servir de proxy pour atteindre des sites publics
depuis l'IP de l'opérateur (attribution, conditions d'utilisation), et il n'a
pas de quota par client au-delà de deux scrapes simultanés. Chromium et
Playwright restent une surface d'exécution. Le jar de session est en clair sur
l'hôte (protégé par les permissions, pas par le Keystore) : une compromission
de l'hôte le lit.

**Preuves** : `tests/unit/scraper-ssrf.test.ts`,
`tests/unit/scraper-limits.test.ts`, `tests/unit/scraper-jar.test.ts`,
`tests/unit/scraper-only.test.ts`, `tests/unit/scraper-concurrency.test.ts`,
`tests/unit/server-image-playwright.test.ts` et
`tests/contracts/contracts.test.ts`.

## T5 — Clé perdue

Deux pertes distinctes, traitées ensemble parce qu'elles partagent le même
stockage : la **clé LLM** perdue ou volée, et la **clé du Keystore** qui rend
les secrets locaux illisibles.

**Lois** : 1 (la clé LLM reste sur le téléphone), 2 (le store est le seul
écrivain), 4 (la donnée suit le compte).

**Actifs** : clé OpenRouter (dépense, quota, réputation du compte), session
Pronote, données scolaires chiffrées.

**Attaquant** : voleur d'un appareil déverrouillé, processus local avec root ou
instrumentation, lecteur d'un log ou d'une sauvegarde. La perte peut aussi être
accidentelle : réinitialisation du Keystore, désinstallation, changement
d'appareil.

**Point d'entrée** : préférences chiffrées, mémoire du processus, journal de
crash, prompt envoyé au modèle, en-tête `Authorization`, tableau de bord
OpenRouter (hors dépôt).

**Mitigations existantes**

- La clé est chiffrée au repos par le Keystore, jamais écrite en clair, jamais
  journalisée, jamais dans un `toString()` ni un message d'erreur, et relue à
  chaque requête :
  [`LlmKeyFallback.kt`](../android/data/src/main/java/fr/veryslopnynotes/data/LlmKeyFallback.kt),
  [`LlmKeyStore.kt`](../android/data/src/main/java/fr/veryslopnynotes/data/LlmKeyStore.kt).
- Un Keystore indisponible ne provoque **aucun** repli en clair : l'état passe
  à `UNAVAILABLE`, publié par le pont et affiché. Le secours est mémoire seule,
  donc perdu au redémarrage (I18).
- « Oublier » efface durablement le chiffré, même quand le Keystore ne répond
  plus (`deleteSharedPreferences`) : une clé oubliée ne ressuscite pas au
  lancement suivant.
- La clé ne part que dans `Authorization`, en HTTPS, vers OpenRouter ; aucun
  secret côté serveur, et le garde de prompt refuse les formes de clé (I4).
  Le scan anti-secrets empêche un commit de clé.
- Perte de la clé Keystore : les données chiffrées deviennent illisibles, l'app
  échoue fermée et redemande un appairage ou une clé ; elle ne déchiffre jamais
  en clair.

**Risque résiduel** : il n'y a ni rotation automatique ni révocation depuis
l'app. Une clé volée reste utilisable tant que l'utilisateur ne la révoque pas
dans OpenRouter ; l'app peut seulement l'oublier localement. L'app n'a pas de
verrou utilisateur : un appareil déverrouillé permet d'utiliser la clé, et il
n'existe pas de plafond de dépense côté client — seules les limites du compte
OpenRouter bornent l'abus. La clé est en mémoire pendant un appel ; root,
débogage ou instrumentation peuvent la lire. La perte du Keystore est
irréversible par conception : la session et les données chiffrées ne sont pas
récupérables, seule la ré-appairage les remplace.

**Preuves** : `tests/unit/kotlin-store-health.test.ts`,
`tests/unit/kotlin-llm-key-fallback.test.ts`,
`tests/unit/kotlin-llm-guard.test.ts`, `tests/web/session.test.ts` et
`tests/architecture/secret-scan.test.ts`.

## Correspondance lois, invariants, ADR

| Menace | Lois | Invariants | ADR | Preuve principale |
|---|---|---|---|---|
| T1 Appareil partagé | 1, 2, 4 | I16, I18, I32, I33 | [ADR-003](adr/003-client-direct.md), [ADR-005 §4](adr/005-rules-and-architecture.md) | `tests/architecture/backup.test.ts`, `tests/unit/kotlin-cache-scope.test.ts` |
| T2 Charge scolaire malveillante | 1, 3 | I4, I6, I10, I14, I15, I25, I32, I35 | [ADR-003](adr/003-client-direct.md), [ADR-004](adr/004-webview.md) | `tests/unit/android-untrusted.test.ts`, `tests/unit/attachment-mime.test.ts` |
| T3 Dépendance compromise | 1, 5 | I11, I13, I22, I34 | [ADR-001](adr/001-stack.md), [ADR-005 §6–9](adr/005-rules-and-architecture.md) | `tests/architecture/skills-lock.test.ts`, `.github/workflows/ci.yml` |
| T4 Scraper local | 1, 2 | I8 | [ADR-003](adr/003-client-direct.md), [ADR-005 §5](adr/005-rules-and-architecture.md) | `tests/unit/scraper-ssrf.test.ts`, `server/infrastructure/ssrf.ts` |
| T5 Clé perdue | 1, 2, 4 | I4, I18 | [ADR-003](adr/003-client-direct.md) | `tests/unit/kotlin-llm-key-fallback.test.ts`, `tests/unit/kotlin-store-health.test.ts` |

## Limites du modèle

Ce document n'est ni un test d'intrusion ni une preuve formelle. Il décrit les
défenses du code à la date de la branche et nomme ce qui reste ouvert. Il ne
couvre pas un appareil rooté, un OS ou un navigateur compromis, l'ingénierie
sociale, la coercition physique, une faille interne à Pronote ou OpenRouter, ni
un opérateur qui expose le scraper hors des règles ci-dessus.

Toute nouvelle frontière réseau, tout invariant ou ADR qui change une de ces
défenses doit mettre ce fichier à jour dans la même PR. Le test
`tests/architecture/docs.test.ts` vérifie l'existence du fichier, la présence
des cinq menaces, leurs sections obligatoires et la résolution des liens.
