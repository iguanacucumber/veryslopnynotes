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

<a id="i17"></a>

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

<a id="i18"></a>

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

<a id="i33"></a>

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
