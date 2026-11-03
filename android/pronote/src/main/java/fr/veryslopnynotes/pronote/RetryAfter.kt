package fr.veryslopnynotes.pronote

import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * Plafond d'un `Retry-After` : une réponse hostile ne doit pas immobiliser
 * l'application pendant des jours. Au-delà, la fenêtre reste longue mais bornée.
 */
internal const val MAX_RETRY_AFTER_MS = 24L * 60L * 60L * 1000L

/**
 * `Retry-After` en millisecondes : delta-seconds ou date HTTP (RFC 9110).
 * `null` = absent ou illisible ; une valeur passée vaut `0`.
 */
internal fun parseRetryAfterMs(value: String?, nowMs: Long = System.currentTimeMillis()): Long? {
    val raw = value?.trim().orEmpty()
    if (raw.isEmpty()) return null
    raw.toLongOrNull()?.let { seconds ->
        return (seconds.coerceAtLeast(0L) * 1000L).coerceAtMost(MAX_RETRY_AFTER_MS)
    }
    for (pattern in RETRY_AFTER_FORMATS) {
        try {
            val format = SimpleDateFormat(pattern, Locale.US)
            format.timeZone = TimeZone.getTimeZone("GMT")
            format.isLenient = false
            val at = format.parse(raw)?.time ?: continue
            return (at - nowMs).coerceIn(0L, MAX_RETRY_AFTER_MS)
        } catch (_: Exception) {
            continue
        }
    }
    return null
}

/** Première valeur `Retry-After`, quel que soit l'habillage de la clé. */
internal fun retryAfterMs(
    headers: Map<String, List<String>>,
    nowMs: Long = System.currentTimeMillis(),
): Long? {
    val raw = headers.entries
        .firstOrNull { it.key.equals("Retry-After", ignoreCase = true) }
        ?.value
        ?.firstOrNull()
    return parseRetryAfterMs(raw, nowMs)
}

private val RETRY_AFTER_FORMATS = listOf(
    "EEE, dd MMM yyyy HH:mm:ss z",
    "EEEE, dd-MMM-yy HH:mm:ss z",
    "EEE MMM d HH:mm:ss yyyy",
)
