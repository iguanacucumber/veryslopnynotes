package fr.veryslopnynotes.data

import android.os.Handler
import android.os.Looper
import fr.veryslopnynotes.core.Assignment
import fr.veryslopnynotes.core.AssignmentAttachment
import fr.veryslopnynotes.core.AssignmentLessonContent
import fr.veryslopnynotes.core.dedupe
import fr.veryslopnynotes.core.eventKey
import org.json.JSONArray
import org.json.JSONObject

// Dépôt devoirs : parse du payload local + écriture « fait » sur le client.
// org.json = SDK Android (aucune dépendance ajoutée). Un devoir non conforme
// (ref en URL absolue, description hors borne) est rejeté : jamais de ligne qui
// pointerait ailleurs (I1).
// I7 : le toggle part d'un TAP utilisateur, jamais d'une sortie LLM. Les pièces
// jointes se téléchargent sur le client local (FileProvider côté UI).
data class ToggleOutcome(val assignment: Assignment?, val error: String?)

/** Pièce jointe téléchargée : nom pour l'ouvreur, octets à partager. */
data class AttachmentData(val name: String, val bytes: ByteArray)

// ponytail: refresh + toggle dans un seul dépôt (pas de ViewModel avant #82).
class AssignmentsRepository(
    private val cache: CacheStore,
    private val provider: PronoteClientProvider = { PronoteSession.client },
    private val main: Handler = Handler(Looper.getMainLooper()),
) {

    // Toggle optimiste : l'UI bascule d'abord, puis revert si échec. Fenêtre =
    // la semaine AFFICHÉE (celle du payload), sinon le devoir est visible mais
    // « introuvable ».
    fun toggle(
        baseUrl: String,
        assignmentId: String,
        done: Boolean,
        weekStart: String,
        onDone: (ToggleOutcome) -> Unit,
    ) {
        if (baseUrl.isBlank()) {
            onDone(ToggleOutcome(null, "Serveur non configuré."))
            return
        }
        val target = assignmentId.trim()
        if (target.isEmpty()) {
            post { onDone(ToggleOutcome(null, "Devoir introuvable.")) }
            return
        }
        Thread {
            val client = provider()
            if (client == null) {
                post { onDone(ToggleOutcome(null, "Connexion indisponible, retour arrière.")) }
                return@Thread
            }
            try {
                val (from, to) = assignmentWindow(weekStart)
                val found = client.homework(from, to)
                    .firstOrNull { it.id == target }
                if (found == null) {
                    post { onDone(ToggleOutcome(null, "Toggle refusé (devoir introuvable).")) }
                    return@Thread
                }
                // Écriture CONFIRMÉE → cache invalidé. `setDone` lève si
                // l'écriture échoue : rien n'est purgé alors.
                writeAndInvalidate(cache, CachePolicy.ASSIGNMENTS) { found.setDone(done) }
                val payload = JSONObject().put("assignment", assignmentJson(found, found.id.ifBlank { "a-0" }, 0)).toString()
                val updated = parseToggle(payload)?.copy(done = done)
                if (updated == null) {
                    post { onDone(ToggleOutcome(null, "Réponse illisible.")) }
                } else {
                    post { onDone(ToggleOutcome(updated, null)) }
                }
            } catch (e: Exception) {
                if (isSessionFailure(e)) {
                    DeviceAuth.reject()
                    post { onDone(ToggleOutcome(null, DeviceAuth.REJECTED_MESSAGE)) }
                } else {
                    post { onDone(ToggleOutcome(null, "Connexion indisponible, retour arrière.")) }
                }
            }
        }.start()
    }

    /**
     * Octets d'une PJ pour l'ouvreur externe : la `ref` opaque est résolue sur
     * le client local, jamais une URL d'établissement dans l'app (I1). Fenêtre
     * = semaine AFFICHÉE, comme le toggle.
     */
    fun fetchAttachment(
        homeworkId: String,
        attachmentId: String,
        weekStart: String,
        onDone: (AttachmentData?) -> Unit,
    ) {
        Thread {
            val data = try {
                val client = provider() ?: return@Thread post { onDone(null) }
                val (from, to) = assignmentWindow(weekStart)
                val hw = client.homework(from, to).firstOrNull { it.id == homeworkId }
                // Une pièce jointe de COURS n'est pas dans le devoir : on la
                // cherche dans les contenus de la même fenêtre. La `ref` reste
                // une clé interne, jamais une URL (I1).
                val file = hw?.let { h ->
                    try {
                        h.files()
                    } catch (_: Exception) {
                        emptyList()
                    }
                }.orEmpty().firstOrNull { it.id == attachmentId }
                    ?: lessonFiles(client, from, to).firstOrNull { it.id == attachmentId }
                    ?: return@Thread post { onDone(null) }
                val bytes = file.data()
                val name = file.name.trim().take(200).ifEmpty { "piece-jointe" }
                AttachmentData(name, bytes)
            } catch (_: Exception) {
                null
            }
            post { onDone(data) }
        }.start()
    }

    /**
     * Fichiers des contenus de cours de la fenêtre, bornés. Repli quand
     * l'identifiant n'appartient pas au devoir : les PJ de cours vivent dans
     * `LessonContent`, pas dans `Homework`.
     */
    private fun lessonFiles(
        client: fr.veryslopnynotes.pronote.Client,
        from: java.time.LocalDateTime,
        to: java.time.LocalDateTime,
    ): List<fr.veryslopnynotes.pronote.Attachment> {
        val out = mutableListOf<fr.veryslopnynotes.pronote.Attachment>()
        try {
            for (lesson in client.lessons(from, to).take(20)) {
                try {
                    lesson.content()?.files()?.let { out.addAll(it.take(Assignment.MAX_ATTACHMENTS)) }
                } catch (e: Exception) {
                    if (mustPropagateReadFailure(e)) throw e
                }
                if (out.size >= Assignment.MAX_ATTACHMENTS * 2) break
            }
        } catch (e: Exception) {
            if (mustPropagateReadFailure(e)) throw e
        }
        return out
    }

    private fun post(block: () -> Unit) {
        try {
            main.post { block() }
        } catch (_: Exception) {
            block()
        }
    }

    companion object {
        // ponytail: parse manuel org.json, pas de serializer. Upgrade: kotlinx.serialization si modèles > 10.
        fun parse(body: String): List<Assignment> {
            val root = JSONObject(body)
            val arr: JSONArray = root.optJSONArray("assignments") ?: JSONArray()
            val out = mutableListOf<Assignment>()
            // Un devoir = UNE entrée : le même identifiant publié deux fois
            // n'est lu qu'une fois.
            for (i in 0 until arr.length()) {
                val o: JSONObject = arr.optJSONObject(i) ?: continue
                val a = fromJson(o) ?: continue
                if (!Assignment.isValid(a)) continue
                out.add(a)
            }
            return dedupe(out) { eventKey("assignment", it.id) }
        }

        fun fromJson(o: JSONObject): Assignment? {
            return try {
            val atts = mutableListOf<AssignmentAttachment>()
            val arr = o.optJSONArray("attachments")
            for (i in 0 until (arr?.length() ?: 0)) {
                val att = parseAttachment(arr?.optJSONObject(i) ?: continue) ?: return null
                atts.add(att)
            }
            // `lessonContents` porte TOUS les cours ; le champ singulier reste
            // lu pour les caches antérieurs (et pour le premier cours).
            val lessons = mutableListOf<AssignmentLessonContent>()
            val lessonArr = o.optJSONArray("lessonContents")
            if (lessonArr != null) {
                for (i in 0 until lessonArr.length()) {
                    val lesson = parseLesson(lessonArr.optJSONObject(i) ?: continue) ?: return null
                    lessons.add(lesson)
                }
            } else {
                o.optJSONObject("lessonContent")?.let { lessons.add(parseLesson(it) ?: return null) }
            }
            Assignment(
                id = o.optString("id", ""),
                subject = o.optString("subject", ""),
                title = o.optString("title", ""),
                dueDate = o.optString("dueDate", ""),
                done = o.optBoolean("done", false),
                description = o.optString("description", ""),
                lessonContent = lessons.firstOrNull(),
                attachments = atts,
                periodId = o.optString("periodId", "").takeIf { it.isNotEmpty() },
                weekId = o.optString("weekId", "").takeIf { it.isNotEmpty() },
                lessonContents = lessons,
            )
            } catch (_: Exception) {
                null
            }
        }

        private fun parseAttachment(o: JSONObject): AssignmentAttachment? {
            val att = AssignmentAttachment(
                id = o.optString("id", ""),
                label = o.optString("label", ""),
                ref = o.optString("ref", ""),
            )
            return att.takeIf { AssignmentAttachment.isValid(it) }
        }

        private fun parseLesson(o: JSONObject): AssignmentLessonContent? {
            val atts = mutableListOf<AssignmentAttachment>()
            val arr = o.optJSONArray("attachments")
            for (i in 0 until (arr?.length() ?: 0)) {
                atts.add(parseAttachment(arr?.optJSONObject(i) ?: continue) ?: return null)
            }
            val lesson = AssignmentLessonContent(
                title = o.optString("title", ""),
                excerpt = o.optString("excerpt", ""),
                attachments = atts,
            )
            return lesson.takeIf { AssignmentLessonContent.isValid(it) }
        }

        fun parseToggle(body: String): Assignment? {
            return try {
                val root = JSONObject(body)
                fromJson(root.optJSONObject("assignment") ?: return null)
            } catch (_: Exception) {
                null
            }
        }
    }
}
