package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.dedupe
import fr.veryslopnynotes.core.eventKey
import fr.veryslopnynotes.pronote.Client
import org.json.JSONArray
import org.json.JSONObject

private val HOURS_MIN_RE = Regex("(\\d{1,2})\\s*h(?:(\\d{1,2}))?", RegexOption.IGNORE_CASE)

internal fun hoursToMinutes(raw: String?): Double? {
    if (raw == null) return null
    val m = HOURS_MIN_RE.find(raw.trim()) ?: return null
    val total = (m.groupValues[1].toIntOrNull() ?: return null) * 60 + (m.groupValues[2].ifEmpty { "0" }.toIntOrNull() ?: 0)
    return total.toDouble()
}

private fun joinReasons(reasons: List<String?>, max: Int): String? {
    val parts = mutableListOf<String>()
    for (r in reasons) {
        if (r == null) continue
        val t = boundedCp(r, max)
        if (t.isNotEmpty() && t !in parts) parts.add(t)
    }
    if (parts.isEmpty()) return null
    return boundedCp(parts.joinToString(" ; "), max)
}

internal fun attendancePayload(client: Client): String {
    val absences = JSONArray()
    val counters = LinkedHashMap<String, JSONObject>()
    val names = mutableMapOf<String, String>()
    // Une absence = UNE ligne publiée : la même absence est renvoyée par
    // CHAQUE période qui la recouvre. L'identité est (kind, id), JAMAIS id seul :
    // absences et retards sont numérotés par DEUX tables Pronote indépendantes,
    // donc une absence `N = 12` et un retard `N = 12` sont DIFFÉRENTS.
    val rows = mutableListOf<Pair<JSONObject, String?>>()
    for ((periodIndex, p) in client.periods.withIndex()) {
        val pid = p.id.ifBlank { null }
        if (pid != null) names[pid] = p.name
        val ab = try {
            p.absences()
        } catch (e: Exception) {
            if (mustPropagateReadFailure(e)) throw e
            emptyList()
        }
        for ((i, a) in ab.withIndex()) {
            // Repli UNIQUE dans le payload : deux périodes ne forgent jamais
            // le même identifiant pour deux absences différentes.
            val id = a.id.ifBlank { "abs-$periodIndex-$i" }
            rows.add(JSONObject().apply {
                put("id", id)
                put("kind", "absence")
                put("date", a.fromDate.parisIso())
                val to = a.toDate.parisIso()
                if (to != a.fromDate.parisIso()) put("dateEnd", to)
                putIf("motif", joinReasons(a.reasons, 500))
                putIf("periodId", pid?.take(64))
                hoursToMinutes(a.hours)?.let { put("durationMinutes", it) }
                if (a.justified) put("justified", true)
            } to pid)
        }
        val dl = try {
            p.delays()
        } catch (e: Exception) {
            if (mustPropagateReadFailure(e)) throw e
            emptyList()
        }
        for ((i, d) in dl.withIndex()) {
            val id = d.id.ifBlank { "late-$periodIndex-$i" }
            rows.add(JSONObject().apply {
                put("id", id)
                put("kind", "late")
                put("date", d.date.parisIso())
                putIf("motif", joinReasons(d.reasons, 500))
                putIf("periodId", pid?.take(64))
                if (d.minutes.isFinite() && d.minutes >= 0) put("durationMinutes", d.minutes)
                if (d.justified) put("justified", true)
            } to pid)
        }
    }
    // Compteurs calculés depuis les lignes DÉDUPLIQUÉES : une absence parue
    // dans deux périodes ne compte qu'une fois.
    for ((obj, id) in dedupe(rows) { eventKey(it.first.optString("kind"), it.first.optString("id")) }) {
        absences.put(obj)
        if (id != null) {
            val cur = counters.getOrPut(id) {
                JSONObject().put("periodId", id).put("absences", 0).put("late", 0).put("missingMinutes", 0)
            }
            if (obj.optString("kind") == "late") cur.put("late", cur.optInt("late") + 1)
            else cur.put("absences", cur.optInt("absences") + 1)
            val mins = if (obj.isNull("durationMinutes")) 0 else obj.optDouble("durationMinutes", 0.0).toInt()
            cur.put("missingMinutes", cur.optInt("missingMinutes") + mins)
        }
    }
    val periods = JSONArray()
    for ((id, cur) in counters.entries.sortedBy { it.key }) {
        names[id]?.let { cur.put("name", boundedCp(it, 100)) }
        periods.put(cur)
    }
    return JSONObject().put("absences", absences).put("periods", periods).toString()
}

internal fun punishmentsPayload(client: Client): String {
    val arr = JSONArray()
    var seq = 0
    for (p in client.periods) {
        val pid = p.id.ifBlank { null }
        val rows = try {
            p.punishments()
        } catch (e: Exception) {
            if (mustPropagateReadFailure(e)) throw e
            continue
        }
        for (s in rows) {
            val motif = joinReasons(s.reasons, 500) ?: "Sanction"
            arr.put(JSONObject().apply {
                put("id", s.id.ifBlank { "pun-${seq++}" })
                put("date", s.given.parisIso())
                put("motif", motif)
                put("type", boundedCp(s.nature, 100).ifEmpty { "Sanction" })
                // Durée en MINUTES (`duree` Pronote, même unité que
                // `Delay.minutes`) : une retenue n'est pas un « niveau ».
                s.duration?.takeIf { it.isFinite() && it > 0 }?.let { put("durationMinutes", it) }
                putIf("periodId", pid?.take(64))
            })
        }
    }
    return JSONObject().put("punishments", arr).toString()
}

