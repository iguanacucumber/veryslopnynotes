package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.ALGORITHM_SUBJECT
import fr.veryslopnynotes.core.AVERAGE_ALGORITHMS
import fr.veryslopnynotes.core.AveragesReport
import fr.veryslopnynotes.core.Capabilities
import fr.veryslopnynotes.core.CapabilityProbe
import fr.veryslopnynotes.core.ComputeAveragesOptions
import fr.veryslopnynotes.core.Grade
import fr.veryslopnynotes.core.ProvidedAverages
import fr.veryslopnynotes.core.SecurityAlert
import fr.veryslopnynotes.core.computeAverages
import fr.veryslopnynotes.core.subjectKey
import fr.veryslopnynotes.pronote.Client
import fr.veryslopnynotes.pronote.JVal
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset

// Passerelle locale (#205, ADR-003) : construit les payloads JSON que les
// écrans savent déjà lire, depuis le client du téléphone au lieu du serveur.
// Mêmes formes que les anciens payloads (`{"grades"}`, `{"entries"}`…), mêmes
// bornes que les parseurs UI : seule la source des données est locale.
//
// Tout est PUR sauf l'appel au client (bloquant, jamais sur le thread UI —
// c'est `SyncedRepository` qui file en tâche de fond). Une écriture ne part
// que d'un geste (toggle, messagerie : I7 inchangé).
//
// Fuseau : l'établissement vit en Europe/Paris (comme `APP_TIME_ZONE` côté
// serveur) ; les instants sortent en ISO avec offset, que les parseurs UI
// (`OffsetDateTime.parse`) lisent comme l'UTC d'avant.
private val PARIS: ZoneId = ZoneId.of("Europe/Paris")

internal fun LocalDateTime.parisIso(): String = atZone(PARIS).toOffsetDateTime().toString()

internal fun parisNowIso(): String = Instant.now().atZone(PARIS).toOffsetDateTime().toString()

/** Trim + borne en POINTS DE CODE (miroir de `bounded` serveur). */
internal fun boundedCp(raw: String?, max: Int): String {
    val t = (raw ?: "").trim()
    if (t.isEmpty()) return ""
    val points = t.codePointCount(0, t.length)
    if (points <= max) return t
    val end = t.offsetByCodePoints(0, max)
    return t.substring(0, end)
}

/** Chaîne vide/espaces = absent (jamais 0), virgule = point (miroir `toNumber`). */
internal fun toNum(raw: String?, fallback: Double): Double {
    if (raw == null) return fallback
    val t = raw.trim()
    if (t.isEmpty()) return fallback
    return t.replace(",", ".").toDoubleOrNull()?.takeIf { it.isFinite() } ?: fallback
}

internal fun toNumOrNull(raw: String?): Double? {
    if (raw == null) return null
    val t = raw.trim()
    if (t.isEmpty()) return null
    return t.replace(",", ".").toDoubleOrNull()?.takeIf { it.isFinite() }
}

/** Query `k=v&k2=v2` d'app (listes fermées, jamais de saisie libre). */
internal fun parseQuery(query: String): Map<String, String> {
    val out = LinkedHashMap<String, String>()
    for (part in query.split("&")) {
        val cut = part.indexOf('=')
        if (cut <= 0) continue
        out[part.substring(0, cut).trim()] = part.substring(cut + 1).trim().take(200)
    }
    return out
}

/** `weekStart=AAAA-MM-JJ` -> lundi 00:00 UTC + 7 jours (miroir `timetableWindow`). */
internal fun weekWindowUtc(query: Map<String, String>): Pair<Long, Long>? {
    val raw = query["weekStart"] ?: return null
    if (!Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(raw)) return null
    val day = runCatching { LocalDate.parse(raw) }.getOrNull() ?: return null
    val monday = day.minusDays(((day.dayOfWeek.value + 6) % 7).toLong())
    val from = monday.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
    return from to (from + 7 * 86_400_000L - 1)
}

/** Lundi 00:00 local de la semaine courante (défaut cantine, miroir `getMenus`). */
internal fun currentWeekLocal(): Pair<LocalDateTime, LocalDateTime> {
    val today = LocalDate.now(PARIS)
    val monday = today.minusDays(((today.dayOfWeek.value + 6) % 7).toLong())
    val from = monday.atStartOfDay()
    return from to from.plusDays(6).withHour(23).withMinute(59).withSecond(59)
}

/** Jour local Paris `AAAA-MM-JJ` (recoupement devoirs/séances, miroir `lessonKey`). */
internal fun parisDay(dt: LocalDateTime): String = dt.atZone(PARIS).toLocalDate().toString()

/** Échec de session : l'app doit se ré-appairer, pas afficher un état vide. */
internal fun isSessionFailure(e: Throwable): Boolean {
    val raw = (e.message ?: "")
    // ponytail: G=25 rate-limit contient "authorization" mais n'est pas un logout.
    if (raw.contains("Exceeded max authorization", ignoreCase = true)) return false
    val msg = (raw + " " + e.javaClass.simpleName)
    return Regex("session|expir|login|auth|credential|unauthorized|\\b401\\b|mfa|\\.pin|jeton|confirmation", RegexOption.IGNORE_CASE)
        .containsMatchIn(msg)
}

private fun JSONObject.putIf(key: String, value: String?) {
    if (!value.isNullOrEmpty()) put(key, value)
}

private fun JSONObject.putIf(key: String, value: Double?) {
    if (value != null && value.isFinite()) put(key, value)
}

private fun JSONObject.putFlag(key: String, value: Boolean) {
    if (value) put(key, true)
}

// --- Notes ---------------------------------------------------------------

private const val GRADE_SUBJECT_FALLBACK = "Matière"

private fun mapCoreGrade(g: fr.veryslopnynotes.pronote.Grade, index: Int, periodId: String?): Grade? {
    val value = toNumOrNull(g.grade) ?: return null
    val scale = toNum(g.outOf ?: g.defaultOutOf, 20.0)
    val coefficient = g.coefficient?.let { toNum(it, 1.0) }
    return Grade(
        id = g.id.ifBlank { "g-$index" },
        accountId = "",
        subject = g.subject.name.ifBlank { GRADE_SUBJECT_FALLBACK },
        value = value,
        scale = scale,
        coefficient = coefficient,
        date = g.date.parisIso(),
        classAverage = toNumOrNull(g.average),
        classMin = toNumOrNull(g.min),
        classMax = toNumOrNull(g.max),
        periodId = periodId,
        bonus = if (g.isBonus) true else null,
        optional = if (g.isOptionnal) true else null,
        label = boundedCp(g.comment, 200).ifEmpty { null },
        teacher = null,
    )
}

private fun mapProvided(client: Client, period: fr.veryslopnynotes.pronote.Period): ProvidedAverages? {
    val subjects = LinkedHashMap<String, Double>()
    try {
        for (a in period.averages()) {
            val name = a.subject.name
            if (name.isBlank() || name.length > 100) continue
            val value = toNumOrNull(a.student) ?: continue
            val outOf = toNum(a.outOf ?: a.defaultOutOf, 20.0)
            val sur20 = if (outOf.isFinite() && outOf > 0 && outOf != 20.0) (value / outOf) * 20 else value
            if (sur20.isFinite()) subjects[subjectKey(name)] = sur20
        }
    } catch (e: Exception) {
        if (isSessionFailure(e)) throw e
    }
    var general: Double? = null
    try {
        general = when (val v = period.overallAverage()) {
            is JVal.Str -> toNumOrNull(v.value)
            is JVal.Num -> v.value.takeIf { it.isFinite() }
            else -> null
        }
    } catch (e: Exception) {
        if (isSessionFailure(e)) throw e
    }
    if (subjects.isEmpty() && general == null) return null
    return ProvidedAverages(periodId = period.id, general = general, subjects = subjects.ifEmpty { null })
}

private fun gradeJson(g: Grade): JSONObject = JSONObject().apply {
    put("id", g.id)
    put("subject", g.subject)
    put("value", g.value)
    put("scale", g.scale)
    putIf("coefficient", g.coefficient)
    put("date", g.date)
    putIf("classAverage", g.classAverage)
    putIf("classMin", g.classMin)
    putIf("classMax", g.classMax)
    putIf("periodId", g.periodId)
    putFlag("bonus", g.bonus == true)
    putFlag("optional", g.optional == true)
    putIf("label", g.label)
}

private fun reportJson(report: AveragesReport): JSONObject = JSONObject().apply {
    put("algorithm", report.algorithm)
    put("general", JSONObject().apply {
        report.general.value?.let { put("value", it) } ?: put("value", JSONObject.NULL)
        put("origin", report.general.origin)
        put("subjectCount", report.general.subjectCount)
    })
    put("subjects", JSONArray().apply {
        for (s in report.subjects) {
            put(JSONObject().apply {
                put("subject", s.subject)
                s.value?.let { put("value", it) } ?: put("value", JSONObject.NULL)
                put("origin", s.origin)
                put("gradeCount", s.gradeCount)
            })
        }
    })
    put("history", JSONArray().apply {
        for (h in report.history) {
            put(JSONObject().apply {
                put("date", h.date)
                h.value?.let { put("value", it) } ?: put("value", JSONObject.NULL)
            })
        }
    })
    put("influences", JSONArray().apply {
        for (i in report.influences) {
            put(JSONObject().apply {
                put("gradeId", i.gradeId)
                put("subject", i.subject)
                put("impact", i.impact)
            })
        }
    })
}

/** Toutes les périodes, rapport cadré sur la `periodId` demandée (miroir `/v1/grades`). */
internal fun gradesPayload(client: Client, query: Map<String, String>): String {
    val algorithm = query["algorithm"]?.takeIf { it in AVERAGE_ALGORITHMS } ?: ALGORITHM_SUBJECT
    val periodId = query["periodId"]?.trim()?.take(64)?.ifEmpty { null }
    val periods = client.periods
    val all = mutableListOf<Grade>()
    var seq = 0
    for (p in periods) {
        val pid = p.id.ifBlank { null }
        val rows = try {
            p.grades()
        } catch (e: Exception) {
            if (isSessionFailure(e)) throw e
            continue
        }
        for (g in rows) {
            mapCoreGrade(g, seq++, pid)?.let { all.add(it) }
        }
    }
    val provided = periodId?.let { id -> periods.find { it.id == id }?.let { mapProvided(client, it) } }
    val report = computeAverages(
        all,
        ComputeAveragesOptions(algorithm = algorithm, periodId = periodId, provided = provided),
    )
    return JSONObject().apply {
        put("averages", reportJson(report))
        put("grades", JSONArray().apply { for (g in all) put(gradeJson(g)) })
    }.toString()
}

/** Tranches de l'établissement (miroir `/v1/periods`, hors cache). */
internal fun periodsPayload(client: Client): String {
    val arr = JSONArray()
    client.periods.forEachIndexed { i, p ->
        val start = runCatching { p.start.parisIso() }.getOrNull() ?: return@forEachIndexed
        val end = runCatching { p.end.parisIso() }.getOrNull() ?: return@forEachIndexed
        arr.put(JSONObject().apply {
            put("id", p.id.ifBlank { "period-$i" })
            put("name", boundedCp(p.name.ifBlank { "Période ${i + 1}" }, 100))
            put("start", start)
            put("end", end)
        })
    }
    return JSONObject().put("periods", arr).toString()
}

// --- Devoirs ---------------------------------------------------------------

private const val LESSON_FETCH_LIMIT = 10

private fun lessonKeyOf(subject: String, day: String?): String? {
    if (subject.isEmpty() || day == null) return null
    return "$subject|$day"
}

/** Contenus de cours rattachés aux devoirs (matière + jour, plafond 10, miroir serveur). */
private fun lessonContents(client: Client, from: LocalDateTime, to: LocalDateTime, wanted: Set<String>): Map<String, Pair<String, String>> {
    if (wanted.isEmpty()) return emptyMap()
    val out = LinkedHashMap<String, Pair<String, String>>()
    val lessons = try {
        client.lessons(from, to)
    } catch (e: Exception) {
        if (isSessionFailure(e)) throw e
        return emptyMap()
    }
    var fetched = 0
    for (l in lessons) {
        if (fetched >= LESSON_FETCH_LIMIT) break
        val key = lessonKeyOf(l.subject?.name ?: "", parisDay(l.start))
        if (key == null || key !in wanted || key in out) continue
        fetched += 1
        try {
            val c = l.content() ?: continue
            val title = boundedCp(c.title, 200)
            val excerpt = boundedCp(c.description, 500)
            if (title.isEmpty() && excerpt.isEmpty()) continue
            out[key] = (if (title.isEmpty()) "Contenu de cours" else title) to excerpt
        } catch (e: Exception) {
            if (isSessionFailure(e)) throw e
        }
    }
    return out
}

internal fun assignmentJson(
    hw: fr.veryslopnynotes.pronote.Homework,
    index: Int,
    lesson: Pair<String, String>?,
): JSONObject? {
    val description = boundedCp(hw.description, 2000)
    val files = try {
        hw.files()
    } catch (e: Exception) {
        if (isSessionFailure(e)) throw e
        emptyList()
    }
    val atts = JSONArray()
    var kept = 0
    files.forEachIndexed { di, f ->
        if (kept >= 10) return@forEachIndexed
        val label = boundedCp(f.name, 200)
        val fileId = boundedCp(f.id, 200)
        if (label.isEmpty() || fileId.isEmpty()) return@forEachIndexed
        atts.put(JSONObject().apply {
            put("id", fileId)
            put("label", label)
            put("ref", "homework:$index:file:$di:$fileId")
        })
        kept += 1
    }
    val subject = hw.subject.name.ifBlank { GRADE_SUBJECT_FALLBACK }
    return JSONObject().apply {
        put("id", hw.id.ifBlank { "a-$index" })
        put("subject", subject)
        put("title", (if (description.isEmpty()) "Devoir" else description.take(200)))
        put("dueDate", hw.date.parisIso())
        put("done", hw.done)
        putIf("description", description.ifEmpty { null })
        if (lesson != null) {
            put("lessonContent", JSONObject().apply {
                put("title", lesson.first)
                put("excerpt", lesson.second)
            })
        }
        if (atts.length() > 0) put("attachments", atts)
    }
}

/**
 * Fenêtre demandée (`weekStart` lundi→dimanche, comme le routeur) ou repli
 * -7/+21 jours (miroir `getAssignments`).
 */
internal fun assignmentsPayload(client: Client, query: Map<String, String>, now: LocalDateTime = LocalDateTime.now()): String {
    val win = weekWindowUtc(query)
    val from = if (win != null) {
        Instant.ofEpochMilli(win.first).atZone(PARIS).toLocalDateTime()
    } else {
        now.minusDays(7)
    }
    val to = if (win != null) {
        Instant.ofEpochMilli(win.second).atZone(PARIS).toLocalDateTime()
    } else {
        now.plusDays(21)
    }
    val raws = client.homework(from, to)
    val wanted = raws.mapNotNullTo(LinkedHashSet()) {
        lessonKeyOf(it.subject.name, parisDay(it.date))
    }
    val lessons = lessonContents(client, from, to, wanted)
    val arr = JSONArray()
    val fromMs = from.atZone(PARIS).toInstant().toEpochMilli()
    val toMs = to.atZone(PARIS).toInstant().toEpochMilli()
    raws.forEachIndexed { i, hw ->
        val dueMs = hw.date.atZone(PARIS).toInstant().toEpochMilli()
        if (win != null && (dueMs < fromMs || dueMs > toMs)) return@forEachIndexed
        val key = lessonKeyOf(hw.subject.name, parisDay(hw.date))
        assignmentJson(hw, i, key?.let { lessons[it] })?.let { arr.put(it) }
    }
    return JSONObject().put("assignments", arr).toString()
}

// --- EDT -------------------------------------------------------------------

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
    val win = weekWindowUtc(query)
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

// --- Actus -----------------------------------------------------------------

internal fun newsPayload(client: Client): String {
    val arr = JSONArray()
    val raws = client.informationAndSurveys()
    raws.take(100).forEachIndexed { i, info ->
        var body = ""
        if (i < 20) {
            body = try {
                boundedCp(info.content(), 2000)
            } catch (e: Exception) {
                if (isSessionFailure(e)) throw e
                ""
            }
        }
        val title = boundedCp(info.title, 200)
        val finalTitle = title.ifEmpty { boundedCp(body, 200).ifEmpty { "Actualité" } }
        arr.put(JSONObject().apply {
            put("id", info.id.ifBlank { "news-$i" })
            put("title", finalTitle)
            putIf("body", body.ifEmpty { null })
            put("publishedAt", (info.creationDate ?: info.startDate)?.parisIso() ?: parisNowIso())
            putIf("category", boundedCp(info.category, 100).ifEmpty { null })
            putIf("author", boundedCp(info.author, 100).ifEmpty { null })
            put("read", info.read)
        })
    }
    return JSONObject().put("news", arr).toString()
}

// --- Cantine ---------------------------------------------------------------

private fun mealOf(isDinner: Boolean, name: String?): String {
    if (isDinner) return "dinner"
    if (name != null && Regex("\\b(petit[\\s-]?d[eé]jeuner|breakfast)\\b", RegexOption.IGNORE_CASE).containsMatchIn(boundedCp(name, 100))) {
        return "breakfast"
    }
    return "lunch"
}

internal fun menusPayload(client: Client): String {
    val (from, to) = currentWeekLocal()
    val fromMs = from.atZone(PARIS).toInstant().toEpochMilli()
    val toMs = to.plusDays(1).atZone(PARIS).toInstant().toEpochMilli() - 1
    val arr = JSONArray()
    var seq = 0
    for (m in client.menus(from, to)) {
        val dateMs = m.date.atZone(PARIS).toInstant().toEpochMilli()
        if (dateMs < fromMs || dateMs > toMs) continue
        val dishes = mutableListOf<String>()
        val allergens = mutableListOf<String>()
        for (group in listOf(m.firstMeal, m.mainMeal, m.sideMeal, m.otherMeal, m.cheese, m.dessert)) {
            if (group == null) continue
            for (f in group) {
                val label = boundedCp(f.name, 120)
                if (label.isNotEmpty() && label !in dishes && dishes.size < 20) dishes.add(label)
                for (lb in f.labels) {
                    val a = boundedCp(lb.name, 40)
                    if (a.isNotEmpty() && a !in allergens && allergens.size < 14) allergens.add(a)
                }
            }
        }
        if (dishes.isEmpty()) continue
        val mealId = m.id.ifBlank { "menu-${seq++}" }
        val mealDate = m.date.parisIso()
        val mealKind = mealOf(m.isDinner, m.name)
        arr.put(JSONObject().apply {
            put("id", mealId)
            put("date", mealDate)
            put("meal", mealKind)
            put("dishes", JSONArray(dishes))
            if (allergens.isNotEmpty()) put("allergens", JSONArray(allergens))
        })
    }
    return JSONObject().put("menus", arr).toString()
}

// --- Vie scolaire ------------------------------------------------------------

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
    for (p in client.periods) {
        val pid = p.id.ifBlank { null }
        if (pid != null) names[pid] = p.name
        val rows: List<Pair<JSONObject, String?>> = mutableListOf<Pair<JSONObject, String?>>().apply {
            val ab = try {
                p.absences()
            } catch (e: Exception) {
                if (isSessionFailure(e)) throw e
                emptyList()
            }
            for ((i, a) in ab.withIndex()) {
                add(JSONObject().apply {
                    put("id", a.id.ifBlank { "abs-$i" })
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
                if (isSessionFailure(e)) throw e
                emptyList()
            }
            for ((i, d) in dl.withIndex()) {
                add(JSONObject().apply {
                    put("id", d.id.ifBlank { "late-$i" })
                    put("kind", "late")
                    put("date", d.date.parisIso())
                    putIf("motif", joinReasons(d.reasons, 500))
                    putIf("periodId", pid?.take(64))
                    if (d.minutes.isFinite() && d.minutes >= 0) put("durationMinutes", d.minutes)
                    if (d.justified) put("justified", true)
                } to pid)
            }
        }
        for ((obj, id) in rows) {
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
            if (isSessionFailure(e)) throw e
            continue
        }
        for (s in rows) {
            val motif = joinReasons(s.reasons, 500) ?: "Sanction"
            arr.put(JSONObject().apply {
                put("id", s.id.ifBlank { "pun-${seq++}" })
                put("date", s.given.parisIso())
                put("motif", motif)
                put("type", boundedCp(s.nature, 100).ifEmpty { "Sanction" })
                s.duration?.takeIf { it.isFinite() && it >= 0 }?.let { put("gravity", it) }
                putIf("periodId", pid?.take(64))
            })
        }
    }
    return JSONObject().put("punishments", arr).toString()
}

// --- Messagerie --------------------------------------------------------------

private const val DISCUSSION_ENRICH_LIMIT = 12

private fun unreadOf(raw: Double): Int? =
    if (raw.isFinite() && raw >= 0 && raw <= 999 && raw == kotlin.math.floor(raw)) raw.toInt() else null

internal fun discussionsPayload(client: Client, nowIso: String = parisNowIso()): String {
    val arr = JSONArray()
    val raws = client.discussions()
    raws.forEachIndexed { i, d ->
        val id = boundedCp(d.id, 64)
        if (id.isEmpty()) return@forEachIndexed
        var participants: List<String> = emptyList()
        var lastMessageAt: String? = null
        var updatedAt = nowIso
        if (i < DISCUSSION_ENRICH_LIMIT) {
            try {
                participants = d.participants().mapNotNullTo(LinkedHashSet()) {
                    boundedCp(it, 100).ifEmpty { null }
                }.take(20)
            } catch (e: Exception) {
                if (isSessionFailure(e)) throw e
            }
            try {
                val msgs = d.messages()
                val last = msgs.lastOrNull()
                val first = msgs.firstOrNull()
                last?.created?.parisIso()?.let {
                    lastMessageAt = it
                    updatedAt = it
                } ?: first?.created?.parisIso()?.let { updatedAt = it }
            } catch (e: Exception) {
                if (isSessionFailure(e)) throw e
            }
        }
        arr.put(JSONObject().apply {
            put("id", id)
            put("subject", boundedCp(d.subject, 200).ifEmpty { "Discussion" })
            put("participants", JSONArray(participants))
            put("updatedAt", updatedAt)
            unreadOf(d.unread)?.let { put("unreadCount", it) }
            lastMessageAt?.let { put("lastMessageAt", it) }
        })
    }
    return JSONObject().put("discussions", arr).toString()
}

/** Messages d'un fil (miroir `mapDiscussionMessage`) : jamais en cache disque. */
internal fun messagesPayload(
    discussionId: String,
    discussion: fr.veryslopnynotes.pronote.Discussion,
): String {
    val arr = JSONArray()
    discussion.messages().forEachIndexed { i, m ->
        val body = boundedCp(m.content, 4000)
        if (body.isEmpty()) return@forEachIndexed
        arr.put(JSONObject().apply {
            put("id", m.id.ifBlank { "m-$i" }.take(64))
            put("discussionId", discussionId)
            putIf("authorName", boundedCp(m.author, 100).ifEmpty { null })
            put("body", body)
            put("sentAt", m.created.parisIso())
        })
    }
    return JSONObject().put("messages", arr).toString()
}

/** Destinataires (enseignants + vie scolaire, miroir `getRecipients`). */
internal fun recipientsPayload(client: Client): String {
    val arr = JSONArray()
    for (r in client.getRecipients()) {
        val id = boundedCp(r.id, 64)
        val name = boundedCp(r.name, 100)
        if (id.isEmpty() || name.isEmpty()) continue
        arr.put(JSONObject().apply {
            put("id", id)
            put("displayName", name)
            put("kind", if (r.type == "teacher") "teacher" else "administration")
        })
    }
    return JSONObject().put("recipients", arr).toString()
}

// --- Capacités ---------------------------------------------------------------

/** Sonde structurelle (miroir `getCapabilities`) : méthode exposée = onglet servi. */
internal fun capabilitiesPayload(client: Client, nowIso: String = parisNowIso()): String {    val periods = try {
        client.periods
    } catch (e: Exception) {
        if (isSessionFailure(e)) throw e
        emptyList()
    }
    val info = try {
        client.info
    } catch (e: Exception) {
        if (isSessionFailure(e)) throw e
        null
    }
    val caps = CapabilityProbe.fromProbe(
        client.infoId ?: "",
        mapOf(
            "grades" to periods.isNotEmpty(),
            "homework" to true,
            "timetable" to true,
            "news" to true,
            "menus" to true,
            "attendance" to periods.isNotEmpty(),
            "punishments" to periods.isNotEmpty(),
            "discussions" to true,
            "profile" to (info != null),
        ),
        nowIso,
    )
    val body = JSONObject().apply {
        put("accountId", caps.accountId)
        put("tabs", JSONArray(caps.tabs))
        put("fetchedAt", caps.fetchedAt)
    }
    return JSONObject().put("capabilities", body).toString()
}

// --- Profil ------------------------------------------------------------------

internal fun mePayload(client: Client, now: LocalDateTime = LocalDateTime.now()): String {
    val info = client.info
    val displayName = boundedCp(info.name, 64)
    if (displayName.isEmpty()) return JSONObject().put("user", JSONObject.NULL).toString()
    val periods = try {
        client.periods
    } catch (e: Exception) {
        if (isSessionFailure(e)) throw e
        emptyList()
    }
    val current = periods.find { !now.isBefore(it.start) && !now.isAfter(it.end) } ?: periods.firstOrNull()
    val picId = info.profilePicture?.id?.trim().orEmpty()
    val photoRef = if (Regex("^[A-Za-z0-9._-]{1,150}$").matches(picId)) "photo:$picId" else null
    val user = JSONObject().apply {
        put("accountId", (info.id ?: "").trim().take(64))
        put("displayName", displayName)
        put("firstName", "")
        put("lastName", "")
        putIf("classLabel", boundedCp(info.className, 64).ifEmpty { null })
        current?.let {
            put("periodId", it.id.take(64))
            put("periodName", boundedCp(it.name, 100))
        }
        putIf("photoRef", photoRef)
        put("hasKids", false)
        put("kids", JSONArray())
    }
    return JSONObject().put("user", user).toString()
}

// --- Alertes -----------------------------------------------------------------

/** Textes scannés = contenus déjà en cache (aucun réseau : marche hors ligne). */
internal fun alertsPayload(texts: List<SecurityAlert.ScannableText>): String {
    val arr = JSONArray()
    for (a in SecurityAlert.scanTextsForInjections(texts)) {
        arr.put(JSONObject().apply {
            put("id", a.id)
            put("kind", a.kind)
            put("excerpt", a.excerpt)
            put("source", a.source)
        })
    }
    return JSONObject().put("alerts", arr).toString()
}
