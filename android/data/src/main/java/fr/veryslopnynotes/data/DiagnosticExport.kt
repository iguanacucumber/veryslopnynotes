package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json

/**
 * Diagnostic de support : une liste FERMÉE de champs d'état, partageable par
 * l'utilisateur. Aucun payload, nom, URL, identifiant, jeton, QR, PIN ni
 * journal libre n'entre ici — chaque valeur est soit un nombre, soit validée
 * contre une allowlist, sinon « unknown ». Le fichier est produit localement
 * puis remis au sélecteur Android : aucun envoi automatique.
 *
 * Fichier PUR (`pronote.Json` seul) : le harnais de parité l'EXÉCUTE.
 */
object DiagnosticExport {
    const val FORMAT = "veryslopnynotes.diagnostic"
    const val SCHEMA_VERSION = 1

    /** Familles absentes du fichier, nommées pour que le format le dise. */
    val WITHHELD: List<String> = listOf(
        "payloads",
        "names",
        "urls",
        "credentials",
        "tokens",
        "qr",
        "pin",
        "schoolData",
        "logs",
    )

    internal val ERROR_CODES = setOf(
        "auth_required",
        "bad_request",
        "unavailable",
        "unknown",
        "stale_session",
        "demo_failed",
        "internal",
        "cache_not_cleared",
        "session_changed",
        "session_incomplete",
        "storage_unavailable",
        "network",
        "offline",
        "other",
        "none",
    )

    internal val AUTH_STATES = setOf("restored", "offline", "no_session", "dead", "unknown")

    internal val CLASS_LEVELS = setOf(
        "6e",
        "5e",
        "4e",
        "3e",
        "2de",
        "1re",
        "Terminale",
        "unknown",
    )

    /**
     * Domaines du pont et clés de ressources connues. Le diagnostic ne peut
     * pas nommer un écran, une matière ou un fichier : hors liste = inconnu.
     */
    internal val RESOURCES = setOf(
        "app",
        "session",
        "privacy",
        "pairing",
        "resources",
        "capabilities",
        "news",
        "assignments",
        "messages",
        "settings",
        "lessons",
        "data",
        "llm",
        "exercises",
        "teacher",
        "revision",
        "profile",
        "periods",
        "grades",
        "timetable",
        "discussions",
        "canteen",
        "attendance",
        "punishments",
        "alerts",
        "none",
    )

    private val VERSION = Regex("""^\d+(\.\d+){0,3}([-+][0-9A-Za-z.-]{1,20})?$""")
    private val ISO_INSTANT = Regex("""^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$""")

    internal fun version(value: String): String =
        value.trim().takeIf { it.length <= 32 && VERSION.matches(it) } ?: "unknown"

    internal fun isoInstant(value: String): Boolean = ISO_INSTANT.matches(value)

    internal fun allowed(value: String, allowed: Set<String>): String =
        value.trim().takeIf { it in allowed } ?: "unknown"
}

data class DiagnosticInput(
    val generatedAt: String,
    val appVersion: String,
    val androidVersion: String,
    val androidApi: Int,
    val webViewVersion: String,
    val errorCode: String,
    val resource: String,
    val classLevel: String,
    val authState: String,
)

/** Construit le JSON stable ; toute valeur hors allowlist devient « unknown ». */
fun buildDiagnostic(input: DiagnosticInput): String {
    val root = LinkedHashMap<String, JVal>()
    root["format"] = JVal.Str(DiagnosticExport.FORMAT)
    root["schemaVersion"] = JVal.Num(DiagnosticExport.SCHEMA_VERSION.toDouble())
    root["generatedAt"] = JVal.Str(
        input.generatedAt.trim().takeIf {
            it.length <= 40 && DiagnosticExport.isoInstant(it)
        } ?: "unknown",
    )
    root["appVersion"] = JVal.Str(DiagnosticExport.version(input.appVersion))
    root["androidVersion"] = JVal.Str(DiagnosticExport.version(input.androidVersion))
    root["androidApi"] = JVal.Num(if (input.androidApi in 1..999) input.androidApi.toDouble() else 0.0)
    root["webViewVersion"] = JVal.Str(DiagnosticExport.version(input.webViewVersion))
    root["errorCode"] = JVal.Str(DiagnosticExport.allowed(input.errorCode, DiagnosticExport.ERROR_CODES))
    root["resource"] = JVal.Str(DiagnosticExport.allowed(input.resource, DiagnosticExport.RESOURCES))
    root["classLevel"] = JVal.Str(
        DiagnosticExport.allowed(input.classLevel, DiagnosticExport.CLASS_LEVELS),
    )
    root["authState"] = JVal.Str(DiagnosticExport.allowed(input.authState, DiagnosticExport.AUTH_STATES))
    root["withheld"] = JVal.Arr(DiagnosticExport.WITHHELD.map { JVal.Str(it) })
    return Json.stringify(JVal.Obj(root))
}
