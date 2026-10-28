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

// Dépôt devoirs #75 : parse du payload local + écriture "fait" sur le client.
// org.json = SDK Android (aucune dépendance ajoutée). Un devoir non conforme au
// contrat (ref en URL absolue, description hors borne) est rejeté = jamais de
// ligne affichée qui pointerait ailleurs (I1).
// I7 : le toggle part d'un TAP utilisateur (action confirmée), jamais d'une
// sortie LLM. Les pièces jointes se téléchargent sur le client local
// (FileProvider côté UI) : plus de proxy serveur.
data class ToggleOutcome(val assignment: Assignment?, val error: String?)

/** Pièce jointe téléchargée : nom pour l'ouvreur, octets à partager. */
data class AttachmentData(val name: String, val bytes: ByteArray)

// ponytail: refresh + toggle dans un seul dépôt (pas de ViewModel avant #82).
class AssignmentsRepository(
    private val cache: CacheStore,
    private val provider: PronoteClientProvider = { PronoteSession.client },
    private val main: Handler = Handler(Looper.getMainLooper()),
) {

    // Toggle Optimiste : l'UI bascule l'affichage d'abord, puis revert si échec.
    // Fenêtre = la semaine AFFICHÉE (`weekStart` de l'écran) : la même que le
    // payload affiché, sinon le devoir est visible mais « introuvable » (#369).
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
                // #369 : écriture CONFIRMÉE -> l'entrée de cache des devoirs ne
                // ressert plus l'état d'avant (la case se décochait au retour).
                // `setDone` lève si l'écriture échoue : rien n'est purgé alors.
                writeAndInvalidate(cache, CachePolicy.ASSIGNMENTS) { found.setDone(done) }
                val payload = JSONObject().put("assignment", assignmentJson(found, found.id.ifBlank { "a-0" }, 0, null)).toString()
                val updated = parseToggle(payload)?.copy(done = done)
                if (updated == null) {
                    post { onDone(ToggleOutcome(null, "Réponse illisible.")) }
                } else {
                    // Le cache local est invalidé : le payload complet sera
                    // rechargé au pull-refresh.
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
     * Octets d'une PJ pour l'ouvreur externe (FileProvider côté UI) : la `ref`
     * opaque `homework:<i>:file:<di>:<fileId>` est résolue sur le client local,
     * jamais une URL d'établissement dans l'app (I1).
     *
     * La fenêtre est celle de la semaine AFFICHÉE (comme le toggle) : une PJ
     * d'un devoir affiché s'ouvre (#369).
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
                val hw = client.homework(from, to)
                    .firstOrNull { it.id == homeworkId } ?: return@Thread post { onDone(null) }
                val file = try {
                    hw.files()
                } catch (_: Exception) {
                    emptyList()
                }.firstOrNull { it.id == attachmentId } ?: return@Thread post { onDone(null) }
                val bytes = file.data()
                val name = file.name.trim().take(200).ifEmpty { "piece-jointe" }
                AttachmentData(name, bytes)
            } catch (_: Exception) {
                null
            }
            post { onDone(data) }
        }.start()
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
            // #570 : un devoir = UNE entrée. Le même identifiant publié deux
            // fois (deux fenêtres de cache, #477) n'est lu qu'une fois.
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
                val a = arr?.optJSONObject(i) ?: continue
                val att = AssignmentAttachment(
                    id = a.optString("id", ""),
                    label = a.optString("label", ""),
                    ref = a.optString("ref", ""),
                )
                if (!AssignmentAttachment.isValid(att)) return null
                atts.add(att)
            }
            val lc = o.optJSONObject("lessonContent")?.let {
                AssignmentLessonContent(
                    title = it.optString("title", ""),
                    excerpt = it.optString("excerpt", ""),
                )
            }
            Assignment(
                id = o.optString("id", ""),
                subject = o.optString("subject", ""),
                title = o.optString("title", ""),
                dueDate = o.optString("dueDate", ""),
                done = o.optBoolean("done", false),
                description = o.optString("description", ""),
                lessonContent = lc,
                attachments = atts,
                periodId = o.optString("periodId", "").takeIf { it.isNotEmpty() },
                weekId = o.optString("weekId", "").takeIf { it.isNotEmpty() },
            )
            } catch (_: Exception) {
                null
            }
        }

        /** Réponse du toggle : {assignment}. */
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
