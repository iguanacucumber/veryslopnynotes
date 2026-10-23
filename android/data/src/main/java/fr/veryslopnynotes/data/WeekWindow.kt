package fr.veryslopnynotes.data

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

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

/** `weekStart=AAAA-MM-JJ` -> lundi 00:00 Paris, jusqu'au lundi suivant 00:00 − 1 ms. */
internal fun weekWindow(query: Map<String, String>): Pair<Long, Long>? =
    weekWindow(query["weekStart"])

/** Idem, depuis le `weekStart` brut : `null` ou illisible = pas de semaine demandée. */
internal fun weekWindow(weekStart: String?): Pair<Long, Long>? {
    val raw = weekStart?.trim() ?: return null
    if (!Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(raw)) return null
    val day = runCatching { LocalDate.parse(raw) }.getOrNull() ?: return null
    val monday = day.minusDays(((day.dayOfWeek.value + 6) % 7).toLong())
    // Deux lundis 00:00 LOCAUX, jamais 7 × 24 h : la semaine qui traverse un
    // changement d'heure dure 167 h ou 169 h. Et la borne est celle de
    // l'établissement, pas UTC (01:00/02:00 Paris laissait perdre les cours
    // du lundi matin que le web, lui, filtre par jour local).
    val from = monday.atStartOfDay(PARIS).toInstant().toEpochMilli()
    val to = monday.plusDays(7).atStartOfDay(PARIS).toInstant().toEpochMilli() - 1
    return from to to
}

/**
 * Fenêtre de lecture des devoirs : la semaine DEMANDÉE (`weekStart`) ou le
 * repli -7/+21 jours. Bornes en heure de Paris (comme le client local et
 * l'affichage web).
 */
internal fun assignmentWindow(
    weekStart: String?,
    now: LocalDateTime = LocalDateTime.now(),
): Pair<LocalDateTime, LocalDateTime> {
    val win = weekWindow(weekStart) ?: return now.minusDays(7) to now.plusDays(21)
    return Instant.ofEpochMilli(win.first).atZone(PARIS).toLocalDateTime() to
        Instant.ofEpochMilli(win.second).atZone(PARIS).toLocalDateTime()
}
