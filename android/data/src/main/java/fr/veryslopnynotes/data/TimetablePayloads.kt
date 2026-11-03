package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.Client
import org.json.JSONArray
import org.json.JSONObject
import java.time.Clock
import java.time.Instant
import java.time.LocalDateTime

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
    val arr = JSONArray()
    var seq = 0
    val read = client.lessonsPartial(from, to)
    for (l in read.value) {
        val startMs = l.start.atZone(SCHOOL_ZONE).toInstant().toEpochMilli()
        if (startMs < fromMs || startMs > toMs) continue
        val subject = boundedCp(l.subject?.name, 100)
        if (subject.isEmpty()) continue
        arr.put(JSONObject().apply {
            put("id", l.id.ifBlank { "t-${seq++}" })
            put("subject", subject)
            putIf("room", boundedCp(l.classroom, 100).ifEmpty { null })
            put("start", l.start.parisIso())
            put("end", l.end.parisIso())
            lessonStatusOf(l)?.let { put("status", it) }
            putIf("teacher", boundedCp(l.teacherName, 100).ifEmpty { null })
        })
    }
    return JSONObject().put("entries", arr).apply { putFlag("partial", read.partial) }.toString()
}

