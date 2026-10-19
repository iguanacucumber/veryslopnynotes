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
  join(PRONOTE, "Errors.kt"),
  join(PRONOTE, "HttpSession.kt"),
  join(PRONOTE, "Json.kt"),
  join(PRONOTE, "Resolver.kt"),
  // `core` — les règles métier pures (dates, notes, IA, garde-fous).
  //
  // `core/CapabilitiesJson.kt` n'est PAS listé : il lit le contrat avec
  // `org.json` (API Android, absente hors Gradle). Le MODÈLE pur
  // (`core/Capabilities.kt`) et la SONDE (`core/CapabilityProbe.kt`) sont,
  // eux, compilés ici : le verdict « contrat invalide = inconnu » est donc
  // testé sur le VRAI code exécuté (#413).
  join(CORE, "AiPrompts.kt"),
  join(CORE, "Assignment.kt"),
  join(CORE, "Attendance.kt"),
  join(CORE, "Averages.kt"),
  join(CORE, "Capabilities.kt"),
  join(CORE, "CapabilityProbe.kt"),
  join(CORE, "ExamDetect.kt"),
  join(CORE, "GradeDiff.kt"),
  join(CORE, "Humanize.kt"),
  join(CORE, "IsoDates.kt"),
  join(CORE, "LlmGuard.kt"),
  join(CORE, "NotifyFormat.kt"),
  join(CORE, "RevisionAi.kt"),
  join(CORE, "RevisionSheet.kt"),
  join(CORE, "SecurityAlert.kt"),
  join(CORE, "Untrusted.kt"),
  join(CORE, "UserProfile.kt"),
  // `data` — cache, file d'attente locale, issue de synchronisation.
  join(DATA, "CachePolicy.kt"),
  join(DATA, "LocalRequestQueue.kt"),
  join(DATA, "OfflineCache.kt"),
  join(DATA, "SyncJobOutcome.kt"),
  join(DATA, "WeekWindow.kt"),
  // `app` — les messages d'appairage, le message de refus du devoir, le type
  // MIME des pièces jointes et la traduction d'un échec natif en rejet.
  join(APP, "AttachmentMime.kt"),
  join(APP, "BridgeErrors.kt"),
  join(APP, "HomeworkMessages.kt"),
  join(APP, "PairingMessages.kt"),
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
