package fr.veryslopnynotes.core

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

private val PARIS_ZONE: ZoneId = ZoneId.of("Europe/Paris")
private val ISO_DAY_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")

/** Largeur d'un jour civil « AAAA-MM-JJ » (repli contrat, jamais une date affichée). */
private const val ISO_DAY_CHARS = 10

/**
 * Lecture d'une date ISO-8601, sémantique `Date.parse` TS.
 *
 * UN SEUL parseur pour tout le noyau (`isoMillis`, `isIsoDateLike`) : les deux
 * ne peuvent plus se contredire.
 *
 * Formes lues :
 * - horodaté AVEC décalage (`…Z`, `…+02:00`) : l'instant est absolu ;
 * - horodaté SANS décalage : heure LOCALE de l'appareil ;
 * - date seule : minuit UTC.
 *
 * ponytail: formes ISO seulement. `Date.parse` accepte en plus les formats
 * historiques ; l'écart joue dans le sens prudent.
 */
internal fun isoMillis(value: String?): Long? {
    val text = value?.trim().orEmpty()
    if (text.isEmpty()) return null
    return try {
        // Horodaté avec décalage : l'instant est absolu.
        OffsetDateTime.parse(text).toInstant().toEpochMilli()
    } catch (_: Exception) {
        try {
            // Horodaté SANS décalage : heure locale de l'appareil (comme `Date.parse` TS).
            LocalDateTime.parse(text).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        } catch (_: Exception) {
            try {
                // Date seule : minuit UTC (comme `Date.parse` TS).
                LocalDate.parse(text).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
            } catch (_: Exception) {
                null
            }
        }
    }
}

/** Date ISO lisible : le MÊME verdict que `isoMillis` (un seul parseur). */
internal fun isIsoDateLike(value: String?): Boolean = isoMillis(value) != null

/**
 * Jour civil d'un instant ISO, « AAAA-MM-JJ », vu par l'élève (Europe/Paris).
 * ponytail: un seul fuseau d'affichage. Upgrade: fuseau par établissement.
 */
fun localDay(iso: String): String {
    val millis = isoMillis(iso)
    if (millis == null) {
        // Instant illisible : repli contrat rejoué en parité, jamais une date affichée.
        return iso.take(ISO_DAY_CHARS)
    }
    return Instant.ofEpochMilli(millis).atZone(PARIS_ZONE).format(ISO_DAY_FORMAT)
}
