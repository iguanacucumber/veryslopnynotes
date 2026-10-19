package fr.veryslopnynotes.data

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset

// Fenêtres de lecture (#369).
//
// L'écran Tâches affiche UNE semaine (le `weekStart` de la requête) ; le dépôt
// doit retrouver le MÊME devoir pour le basculer ou en ouvrir une pièce jointe.
// Deux fenêtres (affichage d'un côté, recherche de l'autre) divergent : le
// devoir est affiché mais « introuvable » (semaine +4, semaine -2). D'où UNE
// fonction pour les deux : l'affichage et la recherche partagent la borne.
//
// Fichier sans org.json ni Android : la fenêtre est rejouée par le harnais
// Kotlin (tests/unit/kotlin-cache-invalidation.test.ts), comme
// `LocalRequestQueue` (#310).

/** Fuseau de l'établissement (Europe/Paris) : les dates locales de l'app. */
internal val PARIS: ZoneId = ZoneId.of("Europe/Paris")

/** `weekStart=AAAA-MM-JJ` -> lundi 00:00 UTC + 7 jours (miroir `timetableWindow`). */
internal fun weekWindowUtc(query: Map<String, String>): Pair<Long, Long>? =
    weekWindowUtc(query["weekStart"])

/** Idem, depuis le `weekStart` brut : `null` ou illisible = pas de semaine demandée. */
internal fun weekWindowUtc(weekStart: String?): Pair<Long, Long>? {
    val raw = weekStart?.trim() ?: return null
    if (!Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(raw)) return null
    val day = runCatching { LocalDate.parse(raw) }.getOrNull() ?: return null
    val monday = day.minusDays(((day.dayOfWeek.value + 6) % 7).toLong())
    val from = monday.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
    return from to (from + 7 * 86_400_000L - 1)
}

/**
 * Fenêtre de lecture des devoirs : la semaine DEMANDÉE (`weekStart`) ou le
 * repli -7/+21 jours. Bornes en heure de Paris (comme le client local) ;
 * la semaine demandée est bornée en UTC, comme l'affichage web.
 */
internal fun assignmentWindow(
    weekStart: String?,
    now: LocalDateTime = LocalDateTime.now(),
): Pair<LocalDateTime, LocalDateTime> {
    val win = weekWindowUtc(weekStart) ?: return now.minusDays(7) to now.plusDays(21)
    return Instant.ofEpochMilli(win.first).atZone(PARIS).toLocalDateTime() to
        Instant.ofEpochMilli(win.second).atZone(PARIS).toLocalDateTime()
}
