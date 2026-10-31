package fr.veryslopnynotes.data

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

// UNE fonction pour l'affichage et la recherche : deux fenêtres divergentes
// rendraient le devoir affiché « introuvable ».
//
// Fichier sans org.json ni Android : la fenêtre est rejouée par le harnais
// Kotlin (tests/unit/kotlin-cache-invalidation.test.ts).

internal val PARIS: ZoneId = ZoneId.of("Europe/Paris")

/** `weekStart` -> [lundi 00:00 Paris, lundi suivant 00:00 − 1 ms]. */
internal fun weekWindow(query: Map<String, String>): Pair<Long, Long>? =
    weekWindow(query["weekStart"])

internal fun weekWindow(weekStart: String?): Pair<Long, Long>? {
    val raw = weekStart?.trim() ?: return null
    if (!Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(raw)) return null
    val day = runCatching { LocalDate.parse(raw) }.getOrNull() ?: return null
    val monday = day.minusDays(((day.dayOfWeek.value + 6) % 7).toLong())
    // Deux lundis 00:00 LOCAUX, jamais 7 × 24 h : la semaine qui traverse un
    // changement d'heure dure 167 h ou 169 h. Borne de l'établissement, pas UTC.
    val from = monday.atStartOfDay(PARIS).toInstant().toEpochMilli()
    val to = monday.plusDays(7).atStartOfDay(PARIS).toInstant().toEpochMilli() - 1
    return from to to
}

/** Semaine demandée, sinon repli -7/+21 jours, bornes en heure de Paris. */
internal fun assignmentWindow(
    weekStart: String?,
    now: LocalDateTime = LocalDateTime.now(),
): Pair<LocalDateTime, LocalDateTime> {
    val win = weekWindow(weekStart) ?: return now.minusDays(7) to now.plusDays(21)
    return Instant.ofEpochMilli(win.first).atZone(PARIS).toLocalDateTime() to
        Instant.ofEpochMilli(win.second).atZone(PARIS).toLocalDateTime()
}
