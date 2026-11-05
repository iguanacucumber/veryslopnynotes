package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.dedupe
import fr.veryslopnynotes.core.eventKey
import fr.veryslopnynotes.pronote.Client
import fr.veryslopnynotes.pronote.ParsingError
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
    var partial = false
    var readSections = 0
    var firstFailure: Exception? = null
    // Une absence = UNE ligne publiée : la même absence est renvoyée par
    // CHAQUE période qui la recouvre. L'identité est (kind, id), JAMAIS id seul :
    // absences et retards sont numérotés par DEUX tables Pronote indépendantes,
    // donc une absence `N = 12` et un retard `N = 12` sont DIFFÉRENTS.
    val rows = mutableListOf<Pair<JSONObject, String?>>()
    for ((periodIndex, p) in client.periods.withIndex()) {
        val pid = p.id.ifBlank { null }
        if (pid != null) names[pid] = p.name
        val ab = try {
            val read = p.absencesPartial()
            readSections += 1
            partial = partial || read.partial
            read.value
        } catch (e: Exception) {
            if (mustPropagateReadFailure(e)) throw e
            partial = true
            if (firstFailure == null) firstFailure = e
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
            val read = p.delaysPartial()
            readSections += 1
            partial = partial || read.partial
            read.value
        } catch (e: Exception) {
            if (mustPropagateReadFailure(e)) throw e
            partial = true
            if (firstFailure == null) firstFailure = e
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
    if (client.periods.isNotEmpty() && readSections == 0) {
        throw firstFailure ?: ParsingError("Aucune période lisible")
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
    return JSONObject().put("absences", absences).put("periods", periods)
        .apply { putFlag("partial", partial) }.toString()
}

internal fun punishmentsPayload(client: Client): String {
    val arr = JSONArray()
    // Une sanction = UNE ligne publiée : la même revient dans CHAQUE période
    // qui la recouvre. L'identité est (kind, id) ; sans id stable, le repli
    // date+type+motif est complété par son rang DANS la période, donc deux
    // sanctions réellement distinctes ne fusionnent jamais (I31).
    val rows = mutableListOf<Pair<JSONObject, String>>()
    var seq = 0
    var partial = false
    var readPeriods = 0
    var firstFailure: Exception? = null
    for (p in client.periods) {
        val pid = p.id.ifBlank { null }
        val punishments = try {
            val read = p.punishmentsPartial()
            readPeriods += 1
            partial = partial || read.partial
            read.value
        } catch (e: Exception) {
            if (mustPropagateReadFailure(e)) throw e
            partial = true
            if (firstFailure == null) firstFailure = e
            continue
        }
        val fallbackRanks = HashMap<String, Int>()
        for (s in punishments) {
            val date = s.given.parisIso()
            val type = boundedCp(s.nature, 100).ifEmpty { "Sanction" }
            val motif = joinReasons(s.reasons, 500) ?: "Sanction"
            // Clé d'identité COMPLÈTE (date+type+motif+rang) ; l'id publié est
            // borné pour le contrat web, sans perdre cette identité.
            val stableId = s.id.ifBlank {
                val fallback = "$date|$type|$motif"
                val rank = fallbackRanks[fallback] ?: 0
                fallbackRanks[fallback] = rank + 1
                "$fallback|$rank"
            }
            val publishedId = s.id.ifBlank { "pun-${seq++}" }
            val obj = JSONObject().apply {
                put("id", publishedId)
                put("date", date)
                put("motif", motif)
                put("type", type)
                // Durée en MINUTES (`duree` Pronote, même unité que
                // `Delay.minutes`) : une retenue n'est pas un « niveau ».
                s.duration?.takeIf { it.isFinite() && it > 0 }?.let { put("durationMinutes", it) }
                putIf("periodId", pid?.take(64))
            }
            rows.add(obj to eventKey("punishment", stableId))
        }
    }
    if (client.periods.isNotEmpty() && readPeriods == 0) {
        throw firstFailure ?: ParsingError("Aucune période lisible")
    }
    for ((obj, _) in dedupe(rows) { it.second }) arr.put(obj)
    return JSONObject().put("punishments", arr).apply { putFlag("partial", partial) }.toString()
}

