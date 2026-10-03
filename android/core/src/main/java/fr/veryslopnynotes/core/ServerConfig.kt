package fr.veryslopnynotes.core

// Config allowlist serveur unique : injectée au build via
// BuildConfig (local.properties `server.host` ou env SERVER_HOST).
// HTTPS-only sauf hôtes émulateur (10.0.2.2/localhost).
// Aucun hôte tiers, aucune URL en dur ici.
object ServerConfig {
    const val SCHEME_PLACEHOLDER = "https"
    const val HOST_PLACEHOLDER = "server-host-configured-at-build"

    fun baseUrl(scheme: String = SCHEME_PLACEHOLDER, host: String = HOST_PLACEHOLDER): String =
        "$scheme://$host"

    fun isEmulatorHost(host: String): Boolean =
        host.startsWith("10.0.2.2") || host.startsWith("localhost")

    fun schemeFor(host: String): String =
        if (isEmulatorHost(host)) "http" else "https"

    fun gradesUrl(baseUrl: String): String = "$baseUrl/v1/grades"
    fun assignmentsUrl(baseUrl: String): String = "$baseUrl/v1/assignments"
    fun timetableUrl(baseUrl: String): String = "$baseUrl/v1/timetable"
    fun eventsUrl(baseUrl: String): String = "$baseUrl/v1/events"
    fun securityAlertsUrl(baseUrl: String): String = "$baseUrl/v1/security/alerts"
    fun pairingStartUrl(baseUrl: String): String = "$baseUrl/v1/pairing/start"
    fun pairingConfirmUrl(baseUrl: String): String = "$baseUrl/v1/pairing/confirm"
    fun revisionSheetsUrl(baseUrl: String): String = "$baseUrl/v1/revision-sheets"
    fun revisionSheetPdfUrl(baseUrl: String, id: String): String = "$baseUrl/v1/revision-sheets/pdf?id=$id"
    fun evaluationsUrl(baseUrl: String): String = "$baseUrl/v1/evaluations"

    // #79 : actualités établissement (parité Papillon, onglet Actualités).
    fun newsUrl(baseUrl: String): String = "$baseUrl/v1/news"
    // #81 : menus cantine de la fenêtre (semaine par défaut).
    fun menusUrl(baseUrl: String): String = "$baseUrl/v1/menus"

    // ponytail: allowlist = préfixe baseUrl seule. Upgrade: pinning cert phase 10.
    fun isAllowed(url: String, baseUrl: String): Boolean = url.startsWith(baseUrl)
}
