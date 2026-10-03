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
    fun assignmentsUrl(baseUrl: String, from: String? = null, to: String? = null, weekStart: String? = null): String =
        withQuery(assignmentsUrl(baseUrl), from, to, weekStart)
    fun assignmentsUrl(baseUrl: String): String = "$baseUrl/v1/assignments"

    // #75 : toggle "fait" = écriture confirmée par l'app (I7), jamais par le LLM.
    fun assignmentsToggleUrl(baseUrl: String): String = "$baseUrl/v1/assignments/toggle"

    // #75 : proxy des pièces jointes. L'app passe une `ref` opaque, jamais une
    // URL de l'ENT : le serveur résout et stream les octets (règle d'or média).
    fun mediaUrl(baseUrl: String, accountId: String, ref: String): String =
        "$baseUrl/v1/media?accountId=${urlEncode(accountId)}&ref=${urlEncode(ref)}"

    fun timetableUrl(baseUrl: String): String = "$baseUrl/v1/timetable"
    fun eventsUrl(baseUrl: String): String = "$baseUrl/v1/events"
    fun securityAlertsUrl(baseUrl: String): String = "$baseUrl/v1/security/alerts"
    fun pairingStartUrl(baseUrl: String): String = "$baseUrl/v1/pairing/start"
    fun pairingConfirmUrl(baseUrl: String): String = "$baseUrl/v1/pairing/confirm"
    fun revisionSheetsUrl(baseUrl: String): String = "$baseUrl/v1/revision-sheets"
    fun revisionSheetPdfUrl(baseUrl: String, id: String): String = "$baseUrl/v1/revision-sheets/pdf?id=$id"
    // #83 préférences matière : GET liste, PUT upsert.
    fun subjectPrefsUrl(baseUrl: String): String = "$baseUrl/v1/subjects/prefs"

    fun evaluationsUrl(baseUrl: String): String = "$baseUrl/v1/evaluations"

    // #79 : actualités établissement (parité Papillon, onglet Actualités).
    fun newsUrl(baseUrl: String): String = "$baseUrl/v1/news"
    // #81 : menus cantine de la fenêtre (semaine par défaut).
    fun menusUrl(baseUrl: String): String = "$baseUrl/v1/menus"

    // #77 : vie scolaire — absences/retards (compteurs par période) + sanctions.
    fun attendanceUrl(baseUrl: String): String = "$baseUrl/v1/attendance"
    fun punishmentsUrl(baseUrl: String): String = "$baseUrl/v1/punishments"


    // #82 : profil du compte appairé (onglet Profil) + périodes de l'année.
    fun meUrl(baseUrl: String): String = "$baseUrl/v1/me"
    fun periodsUrl(baseUrl: String): String = "$baseUrl/v1/periods"

    // #82 : proxy média. La photo n'arrive JAMAIS par une adresse Pronote/ENT :
    // on passe la réF opaque au serveur, qui résout et stream les octets (I1).
    fun mediaPath(ref: String, accountId: String): String =
        "/v1/media?ref=" + urlEncode(ref) + "&accountId=" + urlEncode(accountId)

    private fun urlEncode(value: String): String =
        java.net.URLEncoder.encode(value, "UTF-8")

    // ponytail: allowlist = préfixe baseUrl seule. Upgrade: pinning cert phase 10.
    fun isAllowed(url: String, baseUrl: String): Boolean = url.startsWith(baseUrl)

    // ponytail: encodage minimal (espace, &, =, ?, #, %, /). Upgrade:
    // java.net.URLEncoder quand une donnée réelle à encoder apparaîtra.
    private fun urlEncode(value: String): String {
        val out = StringBuilder()
        for (c in value.trim().take(200)) {
            when {
                c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c == '-' || c == '_' || c == '.' -> out.append(c)
                else -> out.append('%').append("%02X".format(c.code))
            }
        }
        return out.toString()
    }

    private fun withQuery(base: String, from: String?, to: String?, weekStart: String?): String {
        val parts = mutableListOf<String>()
        if (!from.isNullOrBlank()) parts.add("from=${urlEncode(from)}")
        if (!to.isNullOrBlank()) parts.add("to=${urlEncode(to)}")
        if (!weekStart.isNullOrBlank()) parts.add("weekStart=${urlEncode(weekStart)}")
        return if (parts.isEmpty()) base else base + "?" + parts.joinToString("&")
    }
}
