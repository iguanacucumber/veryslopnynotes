package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.Assignment
import fr.veryslopnynotes.core.AssignmentAttachment
import fr.veryslopnynotes.core.AssignmentLessonContent
import fr.veryslopnynotes.core.dedupe
import fr.veryslopnynotes.core.eventKey
import fr.veryslopnynotes.pronote.Client
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDateTime

// Devoirs : payload `assignments` (devoirs, séances, pièces jointes).

private const val LESSON_FETCH_LIMIT = 10

private const val LESSON_ATTACHMENTS_LIMIT = Assignment.MAX_ATTACHMENTS

internal data class LessonPayload(
    val title: String,
    val text: String,
    val files: List<Pair<String, String>>,
)

private fun lessonKeyOf(subject: String, day: String?): String? {
    if (subject.isEmpty() || day == null) return null
    return "$subject|$day"
}

/**
 * Contenus de cours rattachés aux devoirs (matière + jour, plafond 10). PLUSIEURS
 * cours peuvent partager la même clé : tous sont conservés pour que chacun
 * devienne une source citable. Le cours est publié dans sa borne de payload
 * (8 000 caractères) ; le prompt applique ensuite son budget et signale la coupe.
 */
private fun lessonContents(
    client: Client,
    from: LocalDateTime,
    to: LocalDateTime,
    wanted: Set<String>,
): Map<String, List<LessonPayload>> {
    if (wanted.isEmpty()) return emptyMap()
    val out = LinkedHashMap<String, MutableList<LessonPayload>>()
    val seen = HashSet<String>()
    val lessons = try {
        client.lessons(from, to)
    } catch (e: Exception) {
        if (mustPropagateReadFailure(e)) throw e
        return emptyMap()
    }
    var fetched = 0
    for (l in lessons) {
        if (fetched >= LESSON_FETCH_LIMIT) break
        val key = lessonKeyOf(l.subject?.name ?: "", parisDay(l.start))
        if (key == null || key !in wanted) continue
        if (l.id.isNotBlank() && !seen.add(l.id)) continue
        fetched += 1
        try {
            val c = l.content() ?: continue
            val title = boundedCp(c.title, AssignmentLessonContent.MAX_TITLE)
            val excerpt = boundedCp(c.description, AssignmentLessonContent.MAX_EXCERPT)
            val files = c.files().take(LESSON_ATTACHMENTS_LIMIT).mapNotNull { f ->
                val id = boundedCp(f.id, 200)
                val name = boundedCp(f.name, AssignmentAttachment.MAX_LABEL)
                if (id.isEmpty() || name.isEmpty()) null else id to name
            }
            if (title.isEmpty() && excerpt.isEmpty() && files.isEmpty()) continue
            out.getOrPut(key) { mutableListOf() }.add(
                LessonPayload(
                    title = title.ifEmpty { "Contenu de cours" },
                    text = excerpt,
                    files = files,
                ),
            )
        } catch (e: Exception) {
            if (mustPropagateReadFailure(e)) throw e
        }
    }
    return out
}

private fun lessonJson(
    lesson: LessonPayload,
    homeworkIndex: Int,
    lessonIndex: Int,
): JSONObject? {
    val title = boundedCp(lesson.title, AssignmentLessonContent.MAX_TITLE)
    val excerpt = boundedCp(lesson.text, AssignmentLessonContent.MAX_EXCERPT)
    if (title.isEmpty() && excerpt.isEmpty() && lesson.files.isEmpty()) return null
    return JSONObject().apply {
        put("title", title.ifEmpty { "Contenu de cours" })
        put("excerpt", excerpt)
        if (lesson.files.isNotEmpty()) {
            put("attachments", JSONArray().apply {
                lesson.files.forEachIndexed { fi, (fileId, label) ->
                    val ref = AssignmentAttachment.lessonAttachmentRef(
                        homeworkIndex,
                        lessonIndex,
                        fi,
                        fileId,
                    ) ?: return@forEachIndexed
                    put(JSONObject().apply {
                        put("id", fileId)
                        put("label", label)
                        put("ref", ref)
                    })
                }
            })
        }
    }
}

/**
 * Identifiant PUBLIÉ d'un devoir.
 *
 * L'identifiant Pronote quand il existe : c'est l'IDENTITÉ du devoir (le toggle
 * le renvoie tel quel). Sinon un repli SYNTHÉTIQUE unique dans le payload ET
 * dans la fenêtre servie : deux fenêtres ne doivent JAMAIS forger le même
 * identifiant pour deux devoirs différents — le web déduplique par identifiant,
 * un repli partagé effacerait un vrai devoir.
 */
private fun homeworkIdOf(
    hw: fr.veryslopnynotes.pronote.Homework,
    index: Int,
    scope: String,
): String = hw.id.ifBlank { "a-$scope-$index" }

internal fun assignmentJson(
    hw: fr.veryslopnynotes.pronote.Homework,
    id: String,
    index: Int,
    lessons: List<LessonPayload> = emptyList(),
): JSONObject? {
    val description = boundedCp(hw.description, 2000)
    val files = try {
        hw.files()
    } catch (e: Exception) {
        if (mustPropagateReadFailure(e)) throw e
        emptyList()
    }
    val atts = JSONArray()
    var kept = 0
    files.forEachIndexed { di, f ->
        if (kept >= 10) return@forEachIndexed
        val label = boundedCp(f.name, 200)
        val fileId = boundedCp(f.id, 200)
        if (label.isEmpty() || fileId.isEmpty()) return@forEachIndexed
        // La `ref` est ASSAINIE (identifiant Pronote exotique) : une `ref` hors
        // schéma ferait disparaître le devoir ENTIER côté web.
        val ref = AssignmentAttachment.homeworkRef(index, di, fileId) ?: return@forEachIndexed
        atts.put(JSONObject().apply {
            put("id", fileId)
            put("label", label)
            put("ref", ref)
        })
        kept += 1
    }
    val subject = hw.subject.name.ifBlank { GRADE_SUBJECT_FALLBACK }
    return JSONObject().apply {
        put("id", id)
        put("subject", subject)
        put("title", (if (description.isEmpty()) "Devoir" else description.take(200)))
        put("dueDate", hw.date.parisIso())
        put("done", hw.done)
        putIf("description", description.ifEmpty { null })
        // Tous les cours de la même matière + jour, chacun avec ses PJ.
        // `lessonContent` reste le premier pour les lecteurs existants ;
        // `lessonContents` n'apparaît qu'au-delà d'un cours (payload borné).
        val lessonObjects = JSONArray()
        lessons.forEachIndexed { li, lesson ->
            lessonJson(lesson, index, li)?.let { lessonObjects.put(it) }
        }
        if (lessonObjects.length() > 0) {
            put("lessonContent", lessonObjects.getJSONObject(0))
            if (lessonObjects.length() > 1) put("lessonContents", lessonObjects)
        }
        if (atts.length() > 0) put("attachments", atts)
    }
}

/**
 * Fenêtre demandée (`weekStart` lundi→dimanche) ou repli -7/+21 jours (miroir
 * `getAssignments`). La MÊME fenêtre sert au toggle et aux pièces jointes : un
 * devoir affiché doit rester trouvable.
 */
internal fun assignmentsPayload(client: Client, query: Map<String, String>, now: LocalDateTime = LocalDateTime.now()): String {
    val win = weekWindow(query)
    val (from, to) = assignmentWindow(query["weekStart"], now)
    val raws = client.homework(from, to)
    val wanted = raws.mapNotNullTo(LinkedHashSet()) {
        lessonKeyOf(it.subject.name, parisDay(it.date))
    }
    val lessons = lessonContents(client, from, to, wanted)
    val arr = JSONArray()
    val fromMs = from.atZone(PARIS).toInstant().toEpochMilli()
    val toMs = to.atZone(PARIS).toInstant().toEpochMilli()
    // Un devoir = UNE ligne publiée. Le même devoir (même `N`) peut revenir
    // dans la liste brute : il est publié une fois (le web déduplique par
    // identifiant, mais le NATIF est la source de vérité). Le repli
    // d'identifiant est unique par fenêtre.
    val scope = "${from.toLocalDate()}-${to.toLocalDate()}"
    val rows = raws.mapIndexedNotNull { i, hw ->
        val dueMs = hw.date.atZone(PARIS).toInstant().toEpochMilli()
        if (win != null && (dueMs < fromMs || dueMs > toMs)) return@mapIndexedNotNull null
        Triple(homeworkIdOf(hw, i, scope), i, hw)
    }
    for ((id, i, hw) in dedupe(rows) { eventKey("assignment", it.first) }) {
        val key = lessonKeyOf(hw.subject.name, parisDay(hw.date))
        assignmentJson(hw, id, i, key?.let { lessons[it] }.orEmpty())?.let { arr.put(it) }
    }
    return JSONObject().put("assignments", arr).toString()
}

