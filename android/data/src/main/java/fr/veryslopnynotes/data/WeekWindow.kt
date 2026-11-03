package fr.veryslopnynotes.data

import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime

// UNE fonction pour l'affichage et la recherche : deux fenêtres divergentes
// rendraient le devoir affiché « introuvable ».
//
// Fichier sans org.json ni Android : la fenêtre est rejouée par le harnais
// Kotlin (tests/unit/kotlin-cache-invalidation.test.ts).

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
    val from = monday.atStartOfDay(SCHOOL_ZONE).toInstant().toEpochMilli()
    val to = monday.plusDays(7).atStartOfDay(SCHOOL_ZONE).toInstant().toEpochMilli() - 1
    return from to to
}

/**
 * Semaines lundi→dimanche qui portent au moins un des jours, triées et sans
 * doublon. Sert à ne pas relire des semaines sans cours utile.
 */
internal fun weeksCovering(days: Iterable<LocalDate>): List<Pair<LocalDate, LocalDate>> =
    days.map { it.minusDays(((it.dayOfWeek.value + 6) % 7).toLong()) }
        .distinct()
        .sorted()
        .map { monday -> monday to monday.plusDays(6) }

/** Semaine demandée, sinon repli -7/+21 jours, bornes en heure de Paris. */
internal fun assignmentWindow(
    weekStart: String?,
    clock: Clock = schoolClock(),
): Pair<LocalDateTime, LocalDateTime> {
    val win = weekWindow(weekStart)
    if (win == null) {
        val now = schoolNow(clock)
        return now.minusDays(7) to now.plusDays(21)
    }
    return Instant.ofEpochMilli(win.first).atZone(SCHOOL_ZONE).toLocalDateTime() to
        Instant.ofEpochMilli(win.second).atZone(SCHOOL_ZONE).toLocalDateTime()
}
