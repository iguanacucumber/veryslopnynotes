package fr.veryslopnynotes.ui

import org.json.JSONArray
import org.json.JSONObject

// Widgets de l'accueil #82 : les caches déjà présents (notes/devoirs/EDT) sont
// lus comme des DONNÉES structurées du contrat — champs lus, jamais de texte
// libre interprété (I6). Aucune requête supplémentaire, l'offline-first reste
// intact : cache absent/corrompu = état vide propre, pas de valeur inventée.
// ponytail: comparaison d'ISO par ordre lexicographique (format unique du
//   contrat, .000Z) — pas de lib date. Upgrade: parsing java.time si le contrat
//   accepte des fuseaux non UTC.

private const val HOME_MAX_ITEMS = 5

data class HomeLessonUi(val subject: String, val room: String, val start: String, val end: String)

data class HomeHomeworkUi(val subject: String, val title: String, val dueDate: String)

data class HomeGradeUi(val subject: String, val note: String, val date: String)

private fun iso(value: String): String = value.trim()

/**
 * Prochain cours = cours encore en cours ou à venir, trié par début croissant.
 * Aucun cours futur = liste vide (« Pas de cours à venir » côté UI).
 */
fun upcomingLessonsFrom(payload: String, nowIso: String, limit: Int = 3): List<HomeLessonUi> {
    return try {
        val entries: JSONArray = JSONObject(payload).optJSONArray("entries") ?: JSONArray()
        val now = iso(nowIso)
        val out = mutableListOf<HomeLessonUi>()
        for (i in 0 until entries.length()) {
            val o: JSONObject = entries.optJSONObject(i) ?: continue
            val subject = o.optString("subject", "").trim()
            val start = o.optString("start", "").trim()
            val end = o.optString("end", "").trim()
            // Entrée illisible (pas de matière, dates absentes) = ignorée.
            if (subject.isEmpty() || start.isEmpty() || end.isEmpty()) continue
            if (end < now) continue
            out.add(HomeLessonUi(subject, o.optString("room", "").trim(), start, end))
        }
        out.sortedBy { it.start }.take(if (limit > 0) limit else HOME_MAX_ITEMS)
    } catch (_: Exception) {
        emptyList()
    }
}

/** Devoirs à rendre, du plus proche au plus lointain (done ignoré). */
fun pendingHomeworkFrom(payload: String, nowIso: String, limit: Int = 3): List<HomeHomeworkUi> {
    return try {
        val arr: JSONArray = JSONObject(payload).optJSONArray("assignments") ?: JSONArray()
        val now = iso(nowIso)
        val out = mutableListOf<HomeHomeworkUi>()
        for (i in 0 until arr.length()) {
            val o: JSONObject = arr.optJSONObject(i) ?: continue
            val subject = o.optString("subject", "").trim()
            val title = o.optString("title", "").trim()
            val due = o.optString("dueDate", "").trim()
            if (subject.isEmpty() || title.isEmpty() || due.isEmpty()) continue
            if (o.optBoolean("done", false)) continue
            if (due < now) continue
            out.add(HomeHomeworkUi(subject, title, due))
        }
        out.sortedBy { it.dueDate }.take(if (limit > 0) limit else HOME_MAX_ITEMS)
    } catch (_: Exception) {
        emptyList()
    }
}

/** Dernières notes, de la plus récente à la plus ancienne. */
fun latestGradesFrom(payload: String, limit: Int = 3): List<HomeGradeUi> {
    return try {
        val arr: JSONArray = JSONObject(payload).optJSONArray("grades") ?: JSONArray()
        val out = mutableListOf<HomeGradeUi>()
        for (i in 0 until arr.length()) {
            val o: JSONObject = arr.optJSONObject(i) ?: continue
            val subject = o.optString("subject", "").trim()
            val date = o.optString("date", "").trim()
            if (subject.isEmpty() || date.isEmpty()) continue
            if (o.isNull("value")) continue
            val value = o.optDouble("value", Double.NaN)
            if (value.isNaN()) continue
            val scale = o.optDouble("scale", Double.NaN)
            out.add(HomeGradeUi(subject, gradeValueLabel(value, scale), date))
        }
        out.sortedByDescending { it.date }.take(if (limit > 0) limit else HOME_MAX_ITEMS)
    } catch (_: Exception) {
        emptyList()
    }
}

/** "15/20" ou "15" si l'échelle n'est pas exploitable (jamais de division par 0). */
fun gradeValueLabel(value: Double, scale: Double): String {
    val v = String.format(java.util.Locale.FRANCE, "%.2f", value).trimEnd('0').trimEnd(',')
    if (scale.isNaN() || scale <= 0.0) return v
    val s = String.format(java.util.Locale.FRANCE, "%.0f", scale)
    return "$v/$s"
}

/** "mardi 06/10 08:00" depuis l'ISO du contrat (libellé, pas d'exécution). */
fun homeTimeLabel(iso: String): String {
    if (iso.length < 16) return iso
    val days = listOf("dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi")
    val day = iso.substring(0, 10)
    val index = runCatching { java.time.LocalDate.parse(day).dayOfWeek.value % 7 }.getOrDefault(-1)
    val name = if (index < 0) "" else "${days[index]} "
    return "$name${day.substring(8, 10)}/${day.substring(5, 7)} ${iso.substring(11, 16)}"
}