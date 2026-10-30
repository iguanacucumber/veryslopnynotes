package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.Client
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDateTime

// Emploi du temps : payload `timetable`.

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

/** Semaine demandée ou -7/+7 jours (miroir `getTimetable`). */
internal fun timetablePayload(client: Client, query: Map<String, String>, now: LocalDateTime = LocalDateTime.now()): String {
    val win = weekWindow(query)
    val from = if (win != null) {
        Instant.ofEpochMilli(win.first).atZone(PARIS).toLocalDateTime()
    } else {
        now.minusDays(7)
    }
    val to = if (win != null) {
        Instant.ofEpochMilli(win.second).atZone(PARIS).toLocalDateTime()
    } else {
        now.plusDays(7)
    }
    val fromMs = from.atZone(PARIS).toInstant().toEpochMilli()
    val toMs = to.atZone(PARIS).toInstant().toEpochMilli()
    val arr = JSONArray()
    var seq = 0
    for (l in client.lessons(from, to)) {
        val startMs = l.start.atZone(PARIS).toInstant().toEpochMilli()
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
    return JSONObject().put("entries", arr).toString()
}

