// Les SOURCES du port Kotlin de parité : UN SEUL ensemble pour tous les
// pilotes (#444).
//
// POURQUOI UN SEUL ENSEMBLE. Chaque test de parité compilait son propre
// programme Kotlin : 15 `kotlinc` pour UN seul port, donc 15 JVM neuves et
// ~400 s de CPU pour la suite. Or 15 de ces 15 programmes incluaient
// `Json.kt` : on recompilait le même code 15 fois, et le cache n'aidait pas
// (une source partagée = 14 caches invalidés = 14 recompilations).
//
// Le port est UN : un seul jar le contient, un seul `kotlinc` le compile.
//
// CE QUE ÇA CHANGE. Le jar porte 17 `main()` (un par pilote) : `java -jar`
// ne suffit plus, le harnais lance la CLASSE du pilote (`mainClassOf`).
//
// CE QUE ÇA NE CHANGE PAS. Les assertions portent toujours sur le VRAI code
// compilé : on compile les MÊMES sources de production, en plus. Aucun
// miroir, aucune source de moins.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

export const ROOT = join(import.meta.dir, "..", "..", "..");

const PRONOTE = join(ROOT, "android", "pronote", "src", "main", "java", "fr", "veryslopnynotes", "pronote");
const CORE = join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core");
const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");

/** Dossier des pilotes (un `main()` par protocole de test). */
export const DRIVER_DIR = join(ROOT, "agents", "runtime", "kotlin-parity");

/**
 * Les sources de PRODUCTION portées par la parité.
 *
 * Liste EXPLICITE, et non un glob sur `android/` : le port Android ne se
 * compile pas hors Gradle (les sources `app/` et `data/` tirent `android.*`).
 * Chaque fichier listé ici est du Kotlin pur — il se compile seul, sans SDK.
 */
export const PRODUCTION_SOURCES: string[] = [
  // `pronote` — le client, le transport, le JSON embarqué.
  join(PRONOTE, "Bytes.kt"),
  join(PRONOTE, "Client.kt"),
  join(PRONOTE, "ClientLike.kt"),
  join(PRONOTE, "Communication.kt"),
  join(PRONOTE, "Crypto.kt"),
  join(PRONOTE, "DataClasses.kt"),
  // `pronote/DemoSchool.kt` : l'établissement de DÉMONSTRATION public de
  // l'éditeur (adresse et identifiants PUBLICS). Le module est le seul qui
  // parle à un établissement : cet hôte n'existe que là.
  join(PRONOTE, "DemoSchool.kt"),
  join(PRONOTE, "Errors.kt"),
  join(PRONOTE, "HttpSession.kt"),
  join(PRONOTE, "Json.kt"),
  join(PRONOTE, "RateLimitGate.kt"),
  join(PRONOTE, "ReadMemo.kt"),
  join(PRONOTE, "RefreshGate.kt"),
  join(PRONOTE, "Resolver.kt"),
  // `core` — les règles métier pures (dates, notes, IA, garde-fous).
  //
  // `core/CapabilitiesJson.kt` n'est PAS listé : il lit le contrat avec
  // `org.json` (API Android, absente hors Gradle). Le MODÈLE pur
  // (`core/Capabilities.kt`) et la SONDE (`core/CapabilityProbe.kt`) sont,
  // eux, compilés ici : le verdict « contrat invalide = inconnu » est donc
  // testé sur le VRAI code exécuté (#413).
  // #628 : l'assembleur de contexte unique (priorité, budgets, dédup,
  // troncature signalée, refus vide). Fichier PUR : le harnais l'EXÉCUTE.
  join(CORE, "AiContext.kt"),
  join(CORE, "AiPrompts.kt"),
  join(CORE, "Assignment.kt"),
  join(CORE, "Attendance.kt"),
  join(CORE, "Averages.kt"),
  join(CORE, "Capabilities.kt"),
  join(CORE, "CapabilityProbe.kt"),
  join(CORE, "ExamDetect.kt"),
  // #645 : la clé de déduplication (kind, id) et la fusion, PURES. Le harnais
  // les EXÉCUTE au lieu de lire la forme de `PronotePayloads.kt` (`org.json`).
  join(CORE, "EventDedupe.kt"),
  join(CORE, "GradeDiff.kt"),
  // `core/Homework.kt` + `core/HomeworkAi.kt` : le contrat du corrige et son
  // schema. Ils sont ici depuis #411 : la CHAINE COMPLETE (JSON du
  // fournisseur → `parseJsonOutput` → `parseHomeworkResponse`) est rejouee
  // sur du code execute, pour prouver que le corrige maximal reste
  // productible et accepte (le plafond de sortie I5 et le plafond de
  // caracteres du corrige doivent tenir ensemble).
  join(CORE, "Homework.kt"),
  join(CORE, "HomeworkAi.kt"),
  join(CORE, "Humanize.kt"),
  join(CORE, "IsoDates.kt"),
  // #586 : les règles du cahier de cours, exécutées par le pilote
  // `LessonNotesMain` (validation, sélection par matière, sources citables).
  join(CORE, "LessonNote.kt"),
  // #587 : le prompt vision et la transcription d'un cours. Fichiers PURS :
  // le harnais exécute la garde d'image, le schéma et la citation.
  join(CORE, "LessonAi.kt"),
  join(CORE, "Vision.kt"),
  join(CORE, "LlmGuard.kt"),
  join(CORE, "ManualUrl.kt"),
  join(CORE, "ManualCatalog.kt"),
  join(CORE, "NotifyFormat.kt"),
  join(CORE, "RevisionAi.kt"),
  join(CORE, "RevisionSheet.kt"),
  join(CORE, "SecurityAlert.kt"),
  // #633 : professeur IA contextualisé (prompt + validation + historique
  // borné). Fichier PUR : le harnais l'EXÉCUTE au lieu d'un miroir TS.
  join(CORE, "TeacherChat.kt"),
  // `core/ServerConfig.kt` : validation de l'adresse du serveur choisie à
  // l'exécution. Fichier PUR (aucun import) : le harnais EXÉCUTE ses verdicts
  // (#655), au lieu d'un miroir TS.
  join(CORE, "ServerConfig.kt"),
  join(CORE, "Untrusted.kt"),
  join(CORE, "UserProfile.kt"),
  // #634 : validation de l'URL d'une page web + source citable « Web : titre ».
  // Fichier PUR : le harnais EXÉCUTE les verdicts et le libellé, au lieu d'un
  // miroir TS.
  join(CORE, "WebPage.kt"),
  // `data` — cache, file d'attente locale, issue de synchronisation.
  join(DATA, "CachePolicy.kt"),
  join(DATA, "CacheScope.kt"),
  // `data/DownloadedFiles.kt` + `data/LocalDataStore.kt` (#540) : les pièces
  // jointes téléchargées (nom, cache borné, purge). Fichiers PURS : le
  // harnais les compile et les REJOUE, donc le test porte sur du code
  // exécuté (deux pièces du même libellé -> deux fichiers distincts).
  join(DATA, "DownloadedFiles.kt"),
  join(DATA, "LocalDataStore.kt"),
  // `ClientQueue.kt` : LA file PARTAGÉE du client local (#403) — c'est elle
  // qui sérialise les lectures de l'interface ET celles du job de fond.
  join(DATA, "ClientQueue.kt"),
  // `data` — le signal « session morte » et sa RÉPARATION (#397) : le rejet
  // invalide la session ET purge le cache. Fichiers PURS (aucun import
  // Android) : le harnais les compile et les REJOUE (un rejet de session
  // purge vraiment le cache, sur le code de production).
  join(DATA, "DeviceAuth.kt"),
  join(DATA, "LocalRequestQueue.kt"),
  join(DATA, "OfflineArtifacts.kt"),
  join(DATA, "OfflineCache.kt"),
  join(DATA, "PronoteSession.kt"),
  join(DATA, "SessionRepair.kt"),
  // `data` — les règles des préférences matière (#395) : le contrat (couleur
  // #RRGGBB, emoji court, libellé) et ses bornes, en un fichier PUR pour que
  // le harnais les EXÉCUTE. Le pont et le dépôt s'appuient dessus.
  join(DATA, "SubjectPrefRules.kt"),
  // `data/StoreHealth.kt` : l'état du stockage chiffré (#401). La DÉCISION
  // (« le Keystore a échoué -> dégradation signalée ») est pure et se compile
  // hors Gradle ; l'appel Keystore lui-même ne l'est pas, il reste dans le
  // `catch` des stores (un source guard le vérifie).
  join(DATA, "StoreHealth.kt"),
  // `SessionFailure.kt` : la décision « session morte » du job de fond, Pure
  // (déménagée de `PronotePayloads.kt`, qui lit `org.json` et ne compile
  // donc pas hors Gradle).
  join(DATA, "SessionFailure.kt"),
  // `data/SessionMode.kt` : le mode de réouverture d'une session persistée
  // (jeton pour un appairage QR, identifiant pour l'établissement de
  // démonstration). Fichier PUR : le harnais le compile et le REJOUE.
  join(DATA, "SessionMode.kt"),
  join(DATA, "SyncJobOutcome.kt"),
  join(DATA, "WeekWindow.kt"),
  // `app` — les messages d'appairage, le message de refus du devoir, le type
  // MIME des pièces jointes, la traduction d'un échec natif en rejet et la
  // route de l'interface web (le chemin porté par le HASH de l'URL, #400).
  join(APP, "AttachmentMime.kt"),
  join(APP, "BridgeErrors.kt"),
  // #646 : l'admission d'un appel AVANT tout fil (#539) — identifiant mal
  // formé, méthode inconnue, requête trop volumineuse, abandon et pont fermé.
  // Fichier PUR : le harnais l'EXÉCUTE, donc chaque sortie précoce répond
  // exactement une fois (aucun parseur d'accolades dans le gate).
  join(APP, "BridgeCall.kt"),
  // `app` — les EXÉCUTEURS du pont (#393) : un fil par appel et une file LLM
  // à part. Logique pure (`java.util.concurrent` seul) : le harnais les
  // EXÉCUTE, donc le test porte sur du code de production, pas sur un miroir.
  join(APP, "BridgeExecutors.kt"),
  join(APP, "HomeworkMessages.kt"),
  join(APP, "PairingMessages.kt"),
  // `app` — la phrase de refus d'une matière hors contrat (#395).
  join(APP, "SubjectPrefMessages.kt"),
  // `app` — la ROUTE de l'interface web (#400) : le chemin porté par le HASH
  // de l'URL. Fichier PUR (aucun import `android.*`) : le harnais le compile
  // et le REJOUE, donc le test porte sur du code de production.
  join(APP, "WebRouteState.kt"),
];

/** Les pilotes du dossier `kotlin-parity` (tous, triés : parcours déterministe). */
export function driverSources(): string[] {
  return readdirSync(DRIVER_DIR)
    .filter((f) => f.endsWith(".kt"))
    .sort()
    .map((f) => join(DRIVER_DIR, f));
}

/**
 * L'UNION : tout ce que la parité compile, en une seule fois.
 *
 * L'ordre est FIXE (sources de production, puis pilotes triés) : le digest du
 * cache est un sha256 du contenu des fichiers, donc l'ordre décide de la
 * clé de cache. Un ordre instable invaliderait le cache sans raison.
 */
export const PARITY_SOURCES: string[] = [...PRODUCTION_SOURCES, ...driverSources()];

/**
 * Empreinte du CONTENU d'un ensemble de sources : sha256 des contenus
 * concaténés, ramené à 16 hex.
 *
 * UNE SEULE SOURCE DE VÉRITÉ. C'est ce calcul qui nomme le dossier de cache
 * du harnais (`node_modules/.cache/<nom>/<empreinte>/`) ET la clé du cache CI
 * du jar de parité : deux calculs, deux clés, un cache mort. La CI lit donc
 * CETTE fonction (`agents/runtime/parity-digest.ts`).
 *
 * 16 hex (64 bits) : assez court pour une clé de cache, assez long pour
 * qu'une collision soit invraisemblable — et une collision nuirait au
 * VERDICT (un jar compilé pour d'autres sources), pas seulement au cache.
 */
export function digestOf(sources: string[]): string {
  const h = createHash("sha256");
  for (const f of sources) h.update(readFileSync(f));
  return h.digest("hex").slice(0, 16);
}

/**
 * L'empreinte DU PORT de parité (le jar unique que le harnais compile).
 *
 * Change dès qu'un octet d'une source de production ou d'un pilote change :
 * c'est ce qui rend le cache du jar sûr — un jar restauré a été compilé
 * EXACTEMENT à partir de ces sources.
 */
export function parityDigest(): string {
  return digestOf(PARITY_SOURCES);
}

/**
 * Classe principale d'un pilote : `<package>.<Fichier>Kt`.
 *
 * Un `fun main()` de niveau fichier devient la classe `<Fichier>Kt` (convention
 * Kotlin). On lit donc la déclaration `package` du pilote au lieu de la
 * recopier dans chaque test — une seule source de vérité, et un test qui
 * échoue bruyamment si un pilote n'a plus de `main` de niveau fichier.
 */
export function mainClassOf(driverPath: string): string {
  const src = readFileSync(driverPath, "utf8");
  const pkg = /^package\s+([A-Za-z_][\w.]*)/m.exec(src)?.[1];
  if (!pkg) {
    throw new Error(
      `le pilote ${driverPath} n'a pas de déclaration « package » : sa classe principale est indéchiffrable`,
    );
  }
  if (!/^fun\s+main\s*\(/m.test(src)) {
    throw new Error(
      `le pilote ${driverPath} n'a pas de « fun main() » de niveau fichier : sa classe principale est indéchiffrable`,
    );
  }
  return `${pkg}.${basename(driverPath, ".kt")}Kt`;
}
