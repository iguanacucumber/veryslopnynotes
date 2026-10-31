package fr.veryslopnynotes.data

import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime

// Fuseau de l'établissement : Europe/Paris. Les instants sortent en ISO avec
// offset, que les parseurs UI (`OffsetDateTime.parse`) lisent directement.
internal fun LocalDateTime.parisIso(): String = atZone(PARIS).toOffsetDateTime().toString()

internal fun parisNowIso(): String = Instant.now().atZone(PARIS).toOffsetDateTime().toString()

/** Borne en POINTS DE CODE (miroir de `bounded` serveur). */
internal fun boundedCp(raw: String?, max: Int): String {
    val t = (raw ?: "").trim()
    if (t.isEmpty()) return ""
    val points = t.codePointCount(0, t.length)
    if (points <= max) return t
    val end = t.offsetByCodePoints(0, max)
    return t.substring(0, end)
}

/** Chaîne vide/espaces = absent (jamais 0), virgule = point (miroir `toNumber`). */
internal fun toNum(raw: String?, fallback: Double): Double {
    if (raw == null) return fallback
    val t = raw.trim()
    if (t.isEmpty()) return fallback
    return t.replace(",", ".").toDoubleOrNull()?.takeIf { it.isFinite() } ?: fallback
}

internal fun toNumOrNull(raw: String?): Double? {
    if (raw == null) return null
    val t = raw.trim()
    if (t.isEmpty()) return null
    return t.replace(",", ".").toDoubleOrNull()?.takeIf { it.isFinite() }
}

/** Listes fermées côté app, jamais de saisie libre. */
internal fun parseQuery(query: String): Map<String, String> {
    val out = LinkedHashMap<String, String>()
    for (part in query.split("&")) {
        val cut = part.indexOf('=')
        if (cut <= 0) continue
        out[part.substring(0, cut).trim()] = part.substring(cut + 1).trim().take(200)
    }
    return out
}

/** Lundi 00:00 local de la semaine courante (défaut cantine). */
internal fun currentWeekLocal(): Pair<LocalDateTime, LocalDateTime> {
    val today = LocalDate.now(PARIS)
    val monday = today.minusDays(((today.dayOfWeek.value + 6) % 7).toLong())
    val from = monday.atStartOfDay()
    return from to from.plusDays(6).withHour(23).withMinute(59).withSecond(59)
}

/** Jour local Paris `AAAA-MM-JJ` (recoupement devoirs/séances). */
internal fun parisDay(dt: LocalDateTime): String = dt.atZone(PARIS).toLocalDate().toString()

internal fun JSONObject.putIf(key: String, value: String?) {
    if (!value.isNullOrEmpty()) put(key, value)
}

internal fun JSONObject.putIf(key: String, value: Double?) {
    if (value != null && value.isFinite()) put(key, value)
}

internal fun JSONObject.putFlag(key: String, value: Boolean) {
    if (value) put(key, true)
}

