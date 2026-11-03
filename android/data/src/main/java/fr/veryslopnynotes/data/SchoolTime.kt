package fr.veryslopnynotes.data

import java.time.Clock
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * Fuseau de l'établissement : les heures murales Pronote sont lues et écrites
 * à Paris, jamais dans le fuseau de l'appareil (un téléphone à l'étranger ne
 * décale ni les cours ni les devoirs).
 */
internal val SCHOOL_ZONE: ZoneId = ZoneId.of("Europe/Paris")

/** Horloge système LUE À PARIS ; les tests injectent une `Clock` fixe. */
internal fun schoolClock(): Clock = Clock.system(SCHOOL_ZONE)

internal fun schoolNow(clock: Clock = schoolClock()): LocalDateTime = LocalDateTime.now(clock)

internal fun schoolToday(clock: Clock = schoolClock()): LocalDate = LocalDate.now(clock)

internal fun parisNowIso(clock: Clock = schoolClock()): String =
    clock.instant().atZone(SCHOOL_ZONE).toOffsetDateTime().toString()

/** Lundi 00:00 local de la semaine courante (défaut cantine). */
internal fun currentWeekLocal(clock: Clock = schoolClock()): Pair<LocalDateTime, LocalDateTime> {
    val today = schoolToday(clock)
    val monday = today.minusDays(((today.dayOfWeek.value + 6) % 7).toLong())
    val from = monday.atStartOfDay()
    return from to from.plusDays(6).withHour(23).withMinute(59).withSecond(59)
}

internal fun LocalDateTime.parisIso(): String = atZone(SCHOOL_ZONE).toOffsetDateTime().toString()
