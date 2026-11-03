package fr.veryslopnynotes.pronote

import java.security.cert.CertificateException

/**
 * Réessai BORNÉ des lectures idempotentes : 5xx et pannes de transport
 * transitoires seulement. Un 4xx (dont 401/403/429), une panne TLS, une
 * annulation ou un `G` typé ne se réessaient jamais ; une écriture non
 * idempotente non plus (l'appelant ne l'emploie que pour [ReadMemo.READ_FUNCTIONS]).
 *
 * Attente exponentielle PLEINEMENT jitterée (moitié basse du palier, tirée au
 * hasard) : deux appareils qui reprennent ensemble ne retapent pas ensemble.
 * `Retry-After` est un PLANCHER ; l'échéance totale ([budgetMs]) est un plafond.
 *
 * `sleep`/`nowMs`/`random` sont injectés par les tests (pilote JVM) : le
 * décompte des tentatives et l'échéance sont alors déterministes.
 */
class RetryPolicy(
    val maxAttempts: Int = DEFAULT_MAX_ATTEMPTS,
    private val baseDelayMs: Long = DEFAULT_BASE_DELAY_MS,
    private val maxDelayMs: Long = DEFAULT_MAX_DELAY_MS,
    val budgetMs: Long = DEFAULT_BUDGET_MS,
    private val random: () -> Double = { Math.random() },
    private val sleep: (Long) -> Unit = { Thread.sleep(it) },
    private val nowMs: () -> Long = { System.nanoTime() / 1_000_000L },
) {
    companion object {
        const val DEFAULT_MAX_ATTEMPTS = 3
        const val DEFAULT_BASE_DELAY_MS = 250L
        const val DEFAULT_MAX_DELAY_MS = 2_000L
        /** Budget des ATTENTES entre tentatives (chaque requête garde son échéance). */
        const val DEFAULT_BUDGET_MS = 20_000L

        /** Uniquement le transitoire : jamais 4xx, TLS, auth ni annulation. */
        fun isTransient(error: Throwable): Boolean = when (error) {
            is RateLimitedError -> false
            is RequestCancelled -> false
            is CertificateException -> false
            is javax.net.ssl.SSLException -> false
            is PronoteAPIError -> (error.httpStatus ?: 0) in 500..599
            else -> error is java.io.IOException
        }

        fun retryAfterOf(error: Throwable): Long? = (error as? PronoteAPIError)?.retryAfterMs

        /**
         * `Retry-After` en secondes or RFC 1123 ; forme illisible = `null`.
         * Une date passée vaut 0 (le serveur ne demande aucune attente).
         */
        fun parseRetryAfterMs(value: String, nowMs: Long = System.currentTimeMillis()): Long? {
            val trimmed = value.trim()
            if (trimmed.isEmpty()) return null
            trimmed.toLongOrNull()?.let { seconds ->
                if (seconds < 0L) return null
                return seconds.coerceAtMost(Long.MAX_VALUE / 1_000L) * 1_000L
            }
            return try {
                val at = java.time.ZonedDateTime
                    .parse(trimmed, java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME)
                    .toInstant()
                    .toEpochMilli()
                (at - nowMs).coerceAtLeast(0L)
            } catch (_: Exception) {
                null
            }
        }
    }

    fun now(): Long = nowMs()

    /**
     * Délai avant la tentative suivante, ou `null` pour ARRÊTER.
     * [retryIndex] = 1 pour le premier réessai. [remainingMs] <= 0 ou un délai
     * qui le dépasse : pas de réessai (l'échéance totale prime).
     */
    fun retryDelayMs(retryIndex: Int, retryAfterMs: Long?, remainingMs: Long): Long? {
        if (remainingMs <= 0L) return null
        val index = retryIndex.coerceIn(1, 32)
        val cap = maxDelayMs.coerceAtLeast(1L)
        var backoff = baseDelayMs.coerceAtLeast(1L).coerceAtMost(cap)
        repeat(index - 1) {
            backoff = (backoff * 2L).coerceAtMost(cap)
        }
        // Plein jitter : un tirage uniforme dans [palier/2, palier].
        val r = random().coerceIn(0.0, 1.0)
        val jittered = backoff / 2L + ((backoff / 2L) * r).toLong()
        val delay = maxOf(jittered.coerceAtLeast(1L), retryAfterMs ?: 0L)
        return if (delay <= remainingMs) delay else null
    }

    /** Une interruption ne doit ni être avalée ni perdre l'erreur d'origine. */
    fun sleepBeforeRetry(delayMs: Long) {
        try {
            sleep(delayMs)
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            throw e
        }
    }
}
