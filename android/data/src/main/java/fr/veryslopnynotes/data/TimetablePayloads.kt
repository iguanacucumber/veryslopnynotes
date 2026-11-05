package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.Client
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import java.time.Clock
import java.time.Instant

private fun lessonStatusOf(l: fr.veryslopnynotes.pronote.Lesson): String? {
    if (l.canceled) return "cancelled"
    val raw = (l.status ?: "").trim().take(40)
    if (raw.isNotEmpty()) {
        if (Regex("cancel|annul", RegexOption.IGNORE_CASE).containsMatchIn(raw)) return "cancelled"
        if (Regex("moved|deplac|déplac", RegexOption.IGNORE_CASE).containsMatchIn(raw)) return "moved"
        if (Regex("^(normal|normalise|normalisé|ok)$", RegexOption.IGNORE_CASE).matches(raw)) return "normal"
    }
    return null
}

@Serializable
private data class TimetableEntry(
    val id: String,
    val subject: String,
    val room: String? = null,
    val start: String,
    val end: String,
    val status: String? = null,
    val teacher: String? = null,
)

@Serializable
private data class TimetablePayload(
    val entries: List<TimetableEntry>,
    val partial: Boolean = false,
)

/** Semaine demandée, sinon -7/+7 jours. */
internal fun timetablePayload(client: Client, query: Map<String, String>, clock: Clock = schoolClock()): String {
    val win = weekWindow(query)
    val now = schoolNow(clock)
    val from = if (win != null) {
        Instant.ofEpochMilli(win.first).atZone(SCHOOL_ZONE).toLocalDateTime()
    } else {
        now.minusDays(7)
    }
    val to = if (win != null) {
        Instant.ofEpochMilli(win.second).atZone(SCHOOL_ZONE).toLocalDateTime()
    } else {
        now.plusDays(7)
    }
    val fromMs = from.atZone(SCHOOL_ZONE).toInstant().toEpochMilli()
    val toMs = to.atZone(SCHOOL_ZONE).toInstant().toEpochMilli()
    var seq = 0
    val read = client.lessonsPartial(from, to)
    val entries = read.value.mapNotNull { l ->
        val startMs = l.start.atZone(SCHOOL_ZONE).toInstant().toEpochMilli()
        if (startMs < fromMs || startMs > toMs) return@mapNotNull null
        val subject = boundedCp(l.subject?.name, 100)
        if (subject.isEmpty()) return@mapNotNull null
        TimetableEntry(
            id = l.id.ifBlank { "t-${seq++}" },
            subject = subject,
            room = boundedCp(l.classroom, 100).ifEmpty { null },
            start = l.start.parisIso(),
            end = l.end.parisIso(),
            status = lessonStatusOf(l),
            teacher = boundedCp(l.teacherName, 100).ifEmpty { null },
        )
    }
    return payloadJson.encodeToString(TimetablePayload(entries, read.partial))
}
