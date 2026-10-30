# Invariants — Données et compte

> Détail du registre [`INVARIANTS.md`](../INVARIANTS.md). Une entrée par ID,
> dans l'ordre du registre ; ne lire que le fichier du thème concerné.

<a id="i16"></a>

## I16 — La donnée d'un compte n'est servie qu'à ce compte, et purgée avec lui
- Invariant : cache, téléchargements, fiches, préférences et photos sont la
  donnée d'UN compte. Purgés au changement de compte et à la session morte — par
  TYPE et code `G`, jamais un mot. Purge, invalidation et bascule
  sont atomiques et ORDONNÉES : la purge précède la publication, une écriture en
  vol est abandonnée. `offline/` ne contient que de la donnée de compte ; la
  déconnexion l'efface. Téléchargements : nom portant l'ID, bornés, purgés
  avec lui. Identité inconnue : purge.
- Test : `tests/unit/kotlin-cache-scope.test.ts`,
  `tests/unit/kotlin-cache-epoch.test.ts`,
  `tests/unit/kotlin-offline-artifacts.test.ts`,
  `tests/unit/kotlin-manual-account-purge.test.ts`,
  `tests/unit/kotlin-session-repair.test.ts`,
  `tests/architecture/session-repair.test.ts`,
  `tests/unit/kotlin-sync-worker.test.ts`,
  `tests/unit/downloaded-files.test.ts`.
- Commande : `make check`.
- Emplacement : `android/data/CacheScope.kt`,
  `android/data/OfflineArtifacts.kt`, `android/data/DownloadedFiles.kt`,
  `android/data/SessionRepair.kt`.

<a id="i17"></a>

## I17 — Le rafraîchissement de session est atomique
- Invariant : le client PRONOTE ne fait JAMAIS deux rafraîchissements à la fois. `post` et `refresh` partagent le moniteur ; `RefreshGate` (CAS) n'admet qu'un rafraîchissement et le relâche même en cas d'échec (`finally`). Le perdant attend et rejoue sur la session neuve.
- Un refus de débit (`G=25` ou 429) n'est jamais une session morte : `RateLimitedError` arme `RateLimitGate` (2 min), aucun refresh n'est tenté. La porte se lève seule à l'échéance.
- Test : `tests/unit/kotlin-refresh-gate.test.ts`, `tests/unit/kotlin-pronote-client-parity.test.ts`, `tests/unit/kotlin-rate-limit.test.ts`, `tests/architecture/pronote-refresh.test.ts`.
- Commande : `make check`.
- Emplacement : `android/pronote/src/main/java/fr/veryslopnynotes/pronote/Client.kt`,
  `android/pronote/src/main/java/fr/veryslopnynotes/pronote/RefreshGate.kt`.

<a id="i18"></a>

## I18 — L'échec du Keystore est un ÉTAT, pas un silence
- Invariant : Keystore indisponible → repli MÉMOIRE, jamais de secret en clair, mais le repli est SIGNALÉ : état `UNAVAILABLE` marqué (`SecureStorage`), publié par le pont (`session.status` / `session.restore`, champ `storage`), affiché par l'interface. Les stores ne journalisent jamais (jeton et clé) : le journal est dans le pont, borné, sans secret ni chemin.
- Test : `tests/unit/kotlin-store-health.test.ts`,
  `tests/unit/kotlin-llm-key-fallback.test.ts` + `tests/web/session.test.ts`.
- Commande : `make check`.
- Emplacement : `android/data/StoreHealth.kt`, `android/data/SessionStore.kt`,
  `android/data/LlmKeyStore.kt`, `android/data/LlmKeyFallback.kt`,
  `android/app/VsnBridge.kt`,
  `web/src/lib/session.ts`, `web/src/ui/AppContext.tsx`.

<a id="i19"></a>

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

<a id="i31"></a>

## I31 — Un enregistrement publié = UNE ligne
- Invariant : une absence, un retard, un devoir est publié et compté UNE fois. Identité = COUPLE (kind, id), jamais l'id seul ; pas de déduplication par contenu. Un repli synthétique n'est jamais partagé. Compteurs depuis la liste dédupliquée, jamais la brute. Côté web : le lecteur écarte l'événement déjà vu, kind par kind.
- Test : `tests/unit/kotlin-payload-dedupe.test.ts`, `tests/web/social.test.ts`, `tests/web/home.test.ts`, `tests/web/tasks.test.ts`.
- Commande : `make check`.
- Emplacement : `android/core/EventDedupe.kt`,
  `android/data/PronotePayloads.kt`, `android/data/AssignmentsRepository.kt`,
  `android/app/VsnBridge.kt`, `web/src/features/attendance/model.ts`,
  `web/src/features/home/parse.ts`, `web/src/features/tasks/assignments.ts`.

<a id="i33"></a>

## I33 — La sauvegarde Android n'emporte jamais les payloads en clair
- Invariant : les payloads Pronote en clair dans `filesDir/offline/` ne partent ni dans la sauvegarde cloud ni dans le transfert appareil-à-appareil. Le manifeste refuse la sauvegarde (`allowBackup="false"` ou exclut `files/`), le variant debug ne la réactive pas, et aucune infrastructure de sauvegarde n'est utilisée. Une copie cloud échapperait à `AccountStore.logout()`.
- Test : `tests/architecture/backup.test.ts`.
- Commande : `make check`.
- Emplacement : `android/app/src/main/AndroidManifest.xml`, `android/app/src/debug/AndroidManifest.xml`.
