# INVARIANTS.md — registre des règles vérifiées

Un invariant est une propriété du produit ou de la chaîne de build qui doit
rester vraie. Une régression est bloquante, même si la fonctionnalité marche.
Ce fichier est un **registre**, pas un journal d'incidents : le contexte
historique vit dans l'issue, le commit ou l'ADR.

Format d'une entrée : règle → test → commande → portée. Un identifiant est
unique et n'est jamais réutilisé. Une entrée tient en 120 mots ; au-delà, le
détail va dans un lien.

## Comment retirer un invariant

Une règle obsolète ou absorbée se **retire** sans renuméroter : supprimer son
entrée détaillée et sa ligne du registre, puis l'inscrire sous `## Retirés`
(ID, date, issue, remplacement éventuel). Retirer ≠ renuméroter — l'identifiant
n'est jamais réutilisé. Un trou entre I1 et la dernière entrée active n'est
toléré que si l'ID figure dans `## Retirés` ; un ID retiré qui réapparaît comme
entrée active échoue au gate.

## Comment ajouter ou réviser un invariant

1. Un incident réel ou une menace identifiée. Pas de règle spéculative.
2. Une règle en une phrase, vérifiable par un test qui échoue avant le
   correctif.
3. Comportement et types d'abord ; un scan de source est un dernier recours,
   avec sa raison et son chemin de remplacement.
4. Une ligne dans le registre ci-dessous, puis l'entrée détaillée.
5. Si la règle chevauche un invariant existant, réviser cet invariant au lieu
   d'en créer un second.

Une règle qui ne peut pas être testée est une convention, pas un invariant.
`tests/architecture/docs.test.ts` vérifie les identifiants, le format, les
références, l'existence des fichiers cités et les commandes citées.

## Architecture actuelle

- `android/` est l'appareil client ; seul `android/pronote/` parle à Pronote.
- Les arêtes de modules sont celles de Gradle : `core` et `pronote` sans
  dépendance, `data` → `core`+`pronote`, `app` → `core`+`data`.
- `web/` est l'interface React embarquée dans la WebView ; elle ne parle à
  aucun réseau et passe par le pont natif (`android/app/.../VsnBridge.kt`).
- `server/` sert uniquement le scraper de manuels, un sidecar optionnel.
- `shared/contracts/` décrit les routes du scraper et les validateurs partagés.

## Registre

| ID | Règle | Vérification principale |
|---|---|---|
| I1 | Seul `android/pronote/` (et le scraper) parle réseau ; frontière Gradle, un seul `Client`, serveur jamais Pronote. | `tests/architecture/invariants.test.ts` |
| I4 | Le prompt LLM est vérifié et borné : secret refusé, prompt vérifié = envoyé, budget déduit, sortie validée. | `tests/unit/kotlin-llm-guard.test.ts` |
| I6 | Tout contenu externe est marqué `Untrusted` ; aucun MIME exécutable. | `tests/unit/android-untrusted.test.ts` |
| I8 | Le scraper est un sidecar local, sans auth, borné et sans SSRF ; jar choisi par le serveur, login jamais ingéré. | `tests/unit/scraper-ssrf.test.ts` |
| I10 | WebView sans réseau ni secret ; pont borné, une réponse par entrée, jamais saturé. | `tests/architecture/web.test.ts` |
| I11 | `.agents/` est verrouillé, scanné et sans fuite. | `tests/architecture/skills-lock.test.ts` |
| I13 | Le pont factice n'existe qu'en dev ; absent en prod = échec. | `tests/architecture/web-mock.test.ts` |
| I14 | « Invalide » n'est jamais « vide » (fail-closed, sauf capabilities). | `tests/unit/kotlin-core-validation-parity.test.ts` |
| I15 | Export PDF = corps entier + sources canoniques ; troncature signalée. | `tests/unit/kotlin-revision-sheet.test.ts` |
| I16 | La donnée d'un compte n'est servie qu'à ce compte et purgée avec lui (cache, offline, téléchargements, session morte). | `tests/unit/kotlin-cache-scope.test.ts` |
| I17 | Un seul rafraîchissement de session à la fois ; rate-limit ≠ session morte. | `tests/unit/kotlin-refresh-gate.test.ts` |
| I18 | Keystore indisponible = état `UNAVAILABLE` signalé, jamais un secret en clair. | `tests/unit/kotlin-store-health.test.ts` |
| I19 | Le job et l'interface lisent par la même file ; session restaurée d'abord, résultat toujours livré. | `tests/architecture/shared-queue.test.ts` |
| I22 | Le gate ne peut pas être neutralisé par l'environnement. | `tests/unit/check-runner.test.ts` |
| I25 | Une réponse périmée n'écrit pas dans l'écran : payload lié à sa requête, réponse tardive ignorée. | `tests/web/grades.test.ts` |
| I31 | Un enregistrement publié = une ligne (clé kind + id). | `tests/unit/kotlin-payload-dedupe.test.ts` |
| I32 | Une photo ne part que sur geste explicite, ré-encodée et bornée. | `tests/unit/kotlin-vision.test.ts` |
| I33 | La sauvegarde Android n'emporte jamais les payloads en clair. | `tests/architecture/backup.test.ts` |
| I34 | Une seule version Kotlin : catalogue = classpath racine = CI. | `tests/architecture/gradle-versions.test.ts` |
| I35 | Cours complet et pièces jointes extraites localement, bornées, sans HTML rendu. | `tests/unit/attachment-text.test.ts` |

## Retirés

Une ligne par ID retiré : ID, date, issue, remplacement éventuel.

| ID | Date | Issue | Remplacement |
|---|---|---|---|
| I2 | 2026-10-29 | #649 | Fusionné dans I1 (frontière Gradle, un seul `Client`). |
| I5 | 2026-10-29 | #649 | Fusionné dans I4 (prompt borné, budget déduit, sortie validée). |
| I3 | 2026-10-29 | #649 | Fusionné dans I1 (frontière des modules : core pur, sans réseau ni SQLite/Room). |
| I7 | 2026-10-28 | #642 | Convention de revue : les jobs purs ne reçoivent que des données structurées Pronote. |
| I9 | 2026-10-28 | #638 | Android Lint (#627, dans le gate) et detekt — les appelants réels, pas le nom. Aucun retrait de code de production ici : les candidats morts partent dans une issue dédiée. |
| I12 | 2026-10-29 | #649 | Fusionné dans I19 (même file, session restaurée avant lecture). |
| I16 bis | 2026-10-29 | #649 | Fusionné dans I16 (donnée de compte purgée avec lui). |
| I20 | 2026-10-29 | #649 | Fusionné dans I10 (pont borné, jamais saturé). |
| I21 | 2026-10-29 | #649 | Fusionné dans I16 (session morte = purge, par type/code). |
| I23 | 2026-10-29 | #649 | Fusionné dans I8 (sidecar local : non-root, TLS). |
| I24 | 2026-10-29 | #649 | Fusionné dans I8 (jar choisi par le serveur). |
| I26 | 2026-10-29 | #649 | Fusionné dans I16 (téléchargements purgés avec le compte). |
| I27 | 2026-10-29 | #649 | Fusionné dans I25 (réponse périmée ignorée). |
| I28 | 2026-10-29 | #649 | Fusionné dans I19 (résultat toujours livré). |
| I29 | 2026-10-29 | #649 | Fusionné dans I8 (sans auth, page de login refusée). |
| I30 | 2026-10-29 | #649 | Fusionné dans I8 (plafond HTML avant matérialisation). |

## Détail

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

## I4 — Le prompt LLM est vérifié, borné, et c'est celui qui part (ADR-003)
- Invariant : aucun secret dans un prompt — garde sur des FORMES (clé, JWT,
  en-tête, cookie, clé privée, entropie) — et le prompt VÉRIFIÉ est celui
  ENVOYÉ (`SafePromptProvider`). Une sortie texte/JSON mal formée est refusée,
  jamais réinterprétée. Le budget de tokens est DÉDUIT du plafond de caractères
  (`MAX_OUTPUT_CHARS` ÷ `CHARS_PER_TOKEN`, une constante) : le fournisseur ne
  produit pas ce que la garde jetterait. L'app appelle OpenRouter en HTTPS, clé
  dans `Authorization`, jamais le serveur. Un refus nomme la limite réelle, sans
  le secret.
- Test : `tests/unit/kotlin-llm-guard.test.ts`,
  `tests/unit/kotlin-llm-budget.test.ts`,
  `tests/unit/check-architecture-scan.test.ts`,
  `tests/unit/android-llm-catalogue.test.ts`,
  `tests/unit/android-homework.test.ts`, `tests/unit/android-revision.test.ts`.
- Commande : `make check`.
- Emplacement : `android/core/LlmGuard.kt`, `android/data/OpenRouterLlm.kt`.

## I6 — Contenu externe = UNTRUSTED_DATA
- Invariant : tout contenu externe marqué `Untrusted` avant traitement IA, entre délimiteurs à nonce, déclaré donnée (`server/ai/` supprimé en #210 ; le marquage vit dans `android/core/Untrusted.kt`). Une pièce jointe nommée par le serveur ne sort jamais en type MIME **exécutable** (`text/html`, `image/svg+xml`, `application/xhtml+xml`…) : son type vient d'une table blanche bornée, le reste sort en `text/plain` ou `application/octet-stream` (#398).
- Test : `tests/architecture/invariants.test.ts` (I6) + `tests/unit/android-homework.test.ts` (miroirs) + `tests/unit/android-untrusted.test.ts` (Kotlin réel : marqueur non forgeable, #373) + `tests/unit/attachment-mime.test.ts` (Kotlin réel : type MIME d'une pièce jointe jamais exécutable, #398).
- Commande : `make check`.
- Emplacement : `android/core/Untrusted.kt`, `android/app/src/main/java/fr/veryslopnynotes/app/AttachmentMime.kt`.

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

## I11 — Contenu vendorisé `.agents/` : docs, pas de passoire
- Invariant : `.agents/` (skills tiers verrouillés par `skills-lock.json`) n'est
  jamais un vecteur de fuite : un VRAI secret y échoue au scan anti-secrets,
  seuls les exemples de documentation passent. Le jeu strict s'applique
  ailleurs ; aucun secret, domaine, IP ni donnée perso. Tous les matchs d'un
  motif sont inspectés, et le jeu vendorisé couvre toutes les formes du jeu du
  dépôt : plus STRICT (preuve plus forte), jamais plus LARGE. Le contenu est
  VERROUILLÉ : sha256 recalculé par ARBRE de skill, comparé à une
  table (une édition manuelle échoue le gate), et le lock doit porter les MÊMES
  skills que le disque ; `computedHash` amont n'est pas recalculable. Provenance
  non vérifiée : l'interroger demanderait le réseau, hors du gate.
- Test : `tests/architecture/secret-scan.test.ts` (carve-out étroit) +
  `tests/architecture/skills-lock.test.ts` (l'empreinte de chaque arbre
  vendorisé) +
  `make lint` (scan réel du dépôt, `.agents/` inclus une fois tracké).
- Commande : `make lint` (scan) et `make architecture-test` (m invariants).
- Emplacement : `.agents/**/*`, motifs dans `agents/runtime/secret-patterns.ts`.

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
  du bundle Vite RÉELLEMENT livré à l'APK — #654 : construit UNE fois par le
  gate, `make architecture` tire `web-build` avant le test, aucun second
  build jetable) + `tests/web/bridge.test.ts` (hors mode
  dev : le pont absent échoue ; en mode dev : le factice répond ; un pont
  natif présent ne retombe jamais sur le factice) +
  `tests/unit/build-web.test.ts` (le build Vite passe par
  `agents/runtime/build-web.ts` : plafond de durée par essai, UN réessai si le
  processus MORT — jamais s'il a échoué — et un diagnostic qui nomme la cause ;
  le build de l'APK passe par le même helper, donc la même protection —
  #516 : le binding natif de Vite peut mourir sans message et rougissait le
  gate pour un bundle intact).
- Commande : `make architecture-test` (ou `make check` ; #654 :
  `make architecture-test` tire `web-build` — un bundle absent est un ÉCHEC
  explicite, jamais un vert vacuement vrai).
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

## I16 — La donnée d'un compte n'est servie qu'à ce compte, et purgée avec lui
- Invariant : cache, téléchargements, fiches, préférences et photos sont la
  donnée d'UN compte. Purgés au changement de compte et à la session morte — par
  TYPE et code `G`, jamais un mot. Purge, invalidation et bascule
  sont atomiques et ORDONNÉES : la purge précède la publication, une écriture en
  vol est abandonnée. `offline/` ne contient que de la donnée de compte ; la
  déconnexion l'efface. Téléchargements : nom portant l'ID, bornés et purgés
  avec lui. Identité inconnue : purge (fail-closed).
- Test : `tests/unit/kotlin-cache-scope.test.ts`,
  `tests/unit/kotlin-cache-epoch.test.ts`,
  `tests/unit/kotlin-offline-artifacts.test.ts`,
  `tests/unit/kotlin-session-repair.test.ts`,
  `tests/architecture/session-repair.test.ts`,
  `tests/unit/kotlin-sync-worker.test.ts`,
  `tests/unit/downloaded-files.test.ts`.
- Commande : `make check`.
- Emplacement : `android/data/CacheScope.kt`,
  `android/data/OfflineArtifacts.kt`, `android/data/DownloadedFiles.kt`,
  `android/data/SessionRepair.kt`.

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
- Et un refus de DÉBIT (`G=25` ou HTTP 429) n'est jamais traité comme une
  session morte : `RateLimitedError` arme une `RateLimitGate` (2 min par
  défaut) et AUCUN refresh n'est tenté — un refresh = poignée de main +
  login supplémentaires, donc encore plus de limitation. Pendant la fenêtre,
  les envois échouent immédiatement (le cache reste servi) ; la porte se
  lève seule à l'échéance et le TYPE ne purge ni le cache ni la session.
- Test : `tests/unit/kotlin-refresh-gate.test.ts` (Kotlin EXÉCUTÉ : N threads
  lâchés en même temps → un seul gagnant ; la porte se rend après un échec) +
  `tests/unit/kotlin-pronote-client-parity.test.ts` (Kotlin EXÉCUTÉ contre le
  stub PRONOTE : deux requêtes concurrentes → un seul handshake de refresh,
  les deux fils réussissent, fil de requêtes identique à la référence TS) +
  `tests/unit/kotlin-rate-limit.test.ts` (Kotlin EXÉCUTÉ : la porte s'arme /
  expire, `G=25` ne déclenche aucun refresh, une erreur générique rafraîchit
  encore, le rate-limit n'est pas une session morte) +
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

## I19 — Le job et l'interface lisent par la même file, sans promesse pendante
- Invariant : les lectures de ressources cachées (écran, job) passent par LA
  MÊME file partagée (`ClientQueue`), jamais en direct sur le `Client` mutable ;
  les clés sont namespacées par producteur. Le job restaure la session AVANT de
  lire, avec le verrou de restauration unique, et attend sa lecture avec un
  délai borné (au-delà : `Result.retry()`). Un travail qui JETTE livre son échec
  à TOUS les callbacks (`QueueOutcome.Failed`) : l'échec est une valeur, jamais
  une promesse pendante. La décision session morte / réessai reste inchangée.
- Test : `tests/architecture/shared-queue.test.ts`,
  `tests/unit/kotlin-local-queue.test.ts`,
  `tests/unit/kotlin-sync-worker.test.ts`,
  `tests/architecture/sync-session.test.ts`.
- Commande : `make check`.
- Emplacement : `android/data/LocalRequestQueue.kt`,
  `android/data/ClientQueue.kt`, `android/data/PeriodicSyncWorker.kt`.

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

## I25 — Une réponse périmée n'écrit pas dans l'écran
- Invariant : le payload d'une ressource est rattaché à sa requête (clé +
  query) ; changer de requête ou échouer invalide le payload précédent, jamais
  affiché sous le nouveau sélecteur. Une réponse qui arrive après un changement
  d'écran est PÉRIMÉE et n'écrit rien : un envoi de message ne peut écrire que
  dans le fil ouvert au départ, et un rechargement dépassé est ignoré. Le
  brouillon tapé pendant l'attente reste ; seul le brouillon envoyé part.
  Rafraîchir la MÊME requête garde le cache affiché (offline-first).
- Test : `tests/web/grades.test.ts`, `tests/web/messages.test.ts`.
- Commande : `make check`.
- Emplacement : `web/src/lib/resource.ts`,
  `web/src/features/messages/reply.ts`, `web/src/lib/seq.ts`.

## I31 — Un enregistrement publié = UNE ligne
- Invariant : une absence, un retard, un devoir est publié UNE fois, et
  compté UNE fois. L'identité d'un événement de vie scolaire est le COUPLE
  (kind, id), JAMAIS l'identifiant seul : les absences et les retards sont
  numérotés par DEUX TABLEAS Pronote indépendantes (`listeAbsences`, filtrée
  sur `G` 13 ou 14) — une absence `N = 12` et un retard `N = 12` sont deux
  enregistrements DIFFÉRENTS, et les deux sont publiés et comptés. La
  déduplication ne se fait jamais par CONTENU (matière + titre + date) : deux
  enregistrements RÉELS qui se ressemblent ne sont jamais confondus. Un repli
  SYNTHÉTIQUE ne peut pas être partagé par deux enregistrements distincts (le
  repli d'absence porte la période, celui de devoir la fenêtre servie). Les
  compteurs de vie scolaire sont calculés depuis la liste DÉDUPLIQUÉE, jamais
  depuis la liste brute. Côté web, la défense est redondante : un lecteur
  écarte l'événement déjà vu, kind par kind (#570).
- Test : `tests/unit/kotlin-payload-dedupe.test.ts` (clé et fusion EXÉCUTÉES
  depuis le Kotlin pur `core/EventDedupe.kt` : même id avec des kinds
  DIFFÉRENTS = deux entrées ; doublon exact = une entrée ; compteurs calculés
  depuis la liste dédupliquée) + `tests/web/social.test.ts` (une absence
  parue deux fois = une ligne, comptée une fois ; une absence et un retard de
  MÊME identifiant = deux lignes, comptées deux fois ; une ligne hors contrat
  ne fait pas d'ombre à une ligne valide ; deux absences distinctes ne sont
  jamais confondues) + `tests/web/home.test.ts` (devoir et cours publiés deux
  fois = une ligne ; deux devoirs distincts ne sont jamais confondus) +
  `tests/web/tasks.test.ts` (la déduplication par id de l'écran Tâches tient,
  et ne confond pas deux devoirs distincts).
- Commande : `make check`.
- Emplacement : `android/core/EventDedupe.kt`,
  `android/data/PronotePayloads.kt`, `android/data/AssignmentsRepository.kt`,
  `android/app/VsnBridge.kt`, `web/src/features/attendance/model.ts`,
  `web/src/features/home/parse.ts`, `web/src/features/tasks/assignments.ts`.

## I32 — Une photo ne part que sur geste explicite, ré-encodée et bornée
- Invariant : aucune photo n'est capturée ni envoyée automatiquement. Une
  capture part d'un bouton (« Prendre une photo » ou « Choisir une image »),
  jamais d'un rafraîchissement, d'un job de fond ou d'une sortie LLM. L'image
  est ré-encodée en JPEG (métadonnées EXIF supprimées), bornée à 1600 px et
  2 Mo, puis elle seule est envoyée au modèle vision — le texte du prompt
  reste soumis à la garde I4. L'image est OPAQUE : elle n'est pas scannable
  pour des secrets, d'où le geste explicite et l'avertissement affiché. Aucun
  octet d'image ne traverse le pont JS, n'est journalisé ou recopié dans un
  message d'erreur. Le fichier temporaire est supprimé après usage et la purge
  de compte efface `cacheDir/photos/`.
- Test : `tests/unit/kotlin-vision.test.ts` (Kotlin EXÉCUTÉ : types bitmap
  bornés, taille décodée, schéma de transcription, prompt Untrusted) +
  `tests/web/course-notes.test.ts` (le pont ne renvoie que du texte, l'écran exige
  un geste explicite) + `tests/unit/kotlin-vision.test.ts` (source :
  `PhotoPrep` ré-encode/borne, `LocalDataStore` purge les photos).
- Commande : `make check`.
- Emplacement : `android/app/PhotoCapture.kt`, `android/app/PhotoPrep.kt`,
  `android/app/VsnBridge.kt`, `android/core/Vision.kt`,
  `android/core/LessonAi.kt`, `android/core/HomeworkAi.kt`,
  `android/data/OpenRouterLlm.kt`, `android/data/LocalDataStore.kt`,
  `web/src/features/course-notes/CourseNotesScreen.tsx`,
  `web/src/features/tasks/TasksScreen.tsx`.

## I33 — La sauvegarde Android n'emporte jamais les payloads en clair
- Invariant : les payloads Pronote écrits en clair dans `filesDir/offline/`
  (notes, absences, sanctions, messages) ne partent ni dans la sauvegarde cloud
  ni dans le transfert appareil-à-appareil. Le manifeste refuse la sauvegarde
  (`allowBackup="false"`) ou exclut `files/`, le variant debug ne la réactive
  pas, et l'app n'utilise aucune infrastructure de sauvegarde (ni `BackupAgent`,
  ni `BackupManager`, ni permission `BACKUP`). Une copie cloud échapperait à
  `AccountStore.logout()`.
- Test : `tests/architecture/backup.test.ts` (manifeste réel et règles XML
  réelles : exclusion `file`/`root` en cloud-backup et device-transfer, variant
  debug fermé, aucun usage de l'infrastructure de sauvegarde).
- Commande : `make check`.
- Emplacement : `android/app/src/main/AndroidManifest.xml`,
  `android/app/src/debug/AndroidManifest.xml`,
  `android/app/src/main/res/xml/`.

## I34 — Une seule version Kotlin, du catalogue à la CI
- Invariant : `android/gradle/libs.versions.toml` est la seule source des
  versions Gradle. Aucun `build.gradle.kts` ne déclare de version de dépendance
  en dur ; le classpath Kotlin lit l'entrée `kotlin` du catalogue ; la CI
  télécharge le `kotlinc` de cette même version. Une version changée à un seul
  endroit doit faire échouer le gate, pas compiler une parité contre un autre
  compilateur.
- Test : `tests/architecture/gradle-versions.test.ts` (catalogue analysé en
  TOML, build scripts et `ci.yml` réels : littéraux refusés, version Kotlin
  identique aux trois endroits).
- Commande : `make architecture`.
- Emplacement : `android/gradle/libs.versions.toml`, `android/build.gradle.kts`,
  `android/*/build.gradle.kts`, `.github/workflows/ci.yml`.

## I35 — Le cours complet et les pièces jointes arrivent à l'IA, bornés et sans HTML rendu
- Invariant : les sources IA d'un devoir sont la consigne, tous les cours de
  la même matière + jour (borne signalée) et les pièces jointes extraites
  localement. Une pièce est résolue par le client local (jamais
  une URL d'établissement côté web), téléchargée dans le cache du compte
  (borné, purgé avec lui), puis lue sans réseau : texte/markdown, HTML
  désinfecté (balises et blocs actifs retirés, aucun rendu), PDF texte, image
  via le chemin vision. Les bornes (octets, pages, caractères, nombre) sont
  déclarées et toute coupe est signalée. Un format illisible ou un MIME
  exécutable devient une source nommée « (illisible) » avec sa raison ; l'OCR
  d'un PDF scanné n'est pas disponible et le dit. Le texte reste Untrusted (I6).
- Test : `tests/unit/attachment-text.test.ts` (Kotlin EXÉCUTÉ sur fixtures
  synthétiques : texte, markdown, HTML désinfecté, PDF texte, PDF scanné, format
  inconnu, MIME exécutable, coupes de caractères et de pages ; un devoir avec un
  cours long et une PJ texte produit des sources > 500 caractères, la PJ y
  figure ; câblage du pont vérifié).
- Commande : `make check`.
- Emplacement : `android/data/AttachmentText.kt`,
  `android/core/AssignmentContext.kt`, `android/core/Assignment.kt`,
  `android/data/PronotePayloads.kt`, `android/data/AssignmentsRepository.kt`,
  `android/app/VsnBridge.kt`.
