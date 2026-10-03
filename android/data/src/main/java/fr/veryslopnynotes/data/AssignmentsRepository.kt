package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.Assignment
import fr.veryslopnynotes.core.AssignmentAttachment
import fr.veryslopnynotes.core.AssignmentLessonContent
import fr.veryslopnynotes.core.ServerConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

// Dépôt devoirs #75 : parse du payload /v1/assignments + écriture "fait".
// org.json = SDK Android (aucune dépendance ajoutée). Un devoir non conforme au
// contrat (ref en URL absolue, description hors borne) est rejeté = jamais de
// ligne affichée qui pointerait ailleurs que le proxy serveur (I1).
// I7 : le toggle part d'un TAP utilisateur (action confirmée), jamais d'une
// sortie LLM ; le serveur refuse toute écriture non confirmée par l'app.
data class ToggleOutcome(val assignment: Assignment?, val error: String?)

// ponytail: refresh + toggle dans un seul dépôt (pas de ViewModel avant #82).
class AssignmentsRepository(private val api: ApiClient) {

    // Toggle Optimiste : l'UI bascule l'affichage d'abord, puis revert si échec.
    fun toggle(baseUrl: String, assignmentId: String, done: Boolean, onDone: (ToggleOutcome) -> Unit) {
        if (baseUrl.isBlank()) {
            onDone(ToggleOutcome(null, "Serveur non configuré."))
            return
        }
        // accountId absent = serveur mono-compte, il résout sa session appairée.
        val body = JSONObject()
            .put("assignmentId", assignmentId)
            .put("done", done)
            .toString()
        val request = try {
            // Chemin issu de ServerConfig seul (I1), comme les autres dépôts.
            api.buildPost(ServerConfig.assignmentsToggleUrl(baseUrl).removePrefix(baseUrl), body.toRequestBody(JSON))
        } catch (_: IllegalArgumentException) {
            onDone(ToggleOutcome(null, "URL hors allowlist serveur"))
            return
        }
        api.client().newCall(request).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                onDone(ToggleOutcome(null, "Hors-ligne, retour arrière."))
            }

            override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                response.use {
                    if (!it.isSuccessful) {
                        // 401 = session expirée, 409 = devoir introuvable, 501 = non supporté.
                        onDone(ToggleOutcome(null, "Toggle refusé (HTTP ${it.code})."))
                        return
                    }
                    val payload = it.body?.string().orEmpty()
                    val updated = parseToggle(payload)
                    if (updated == null) {
                        onDone(ToggleOutcome(null, "Réponse illisible."))
                    } else {
                        // Cache local invalidé : le payload complet sera rechargé au pull-refresh.
                        onDone(ToggleOutcome(updated, null))
                    }
                }
            }
        })
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()

        // ponytail: parse manuel org.json, pas de serializer. Upgrade: kotlinx.serialization si modèles > 10.
        fun parse(body: String): List<Assignment> {
            val root = JSONObject(body)
            val arr: JSONArray = root.optJSONArray("assignments") ?: JSONArray()
            val out = mutableListOf<Assignment>()
            for (i in 0 until arr.length()) {
                val o: JSONObject = arr.optJSONObject(i) ?: continue
                val a = fromJson(o) ?: continue
                if (Assignment.isValid(a)) out.add(a)
            }
            return out
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

        /** Réponse du toggle : {assignment, event}. L'event sert d'invalidation de cache. */
        fun parseToggle(body: String): Assignment? {
            return try {
                val root = JSONObject(body)
                fromJson(root.optJSONObject("assignment") ?: return null)
            } catch (_: Exception) {
                null
            }
        }

        /** URL de téléchargement d'une PJ : PROXY SERVEUR, jamais une URL Pronote (I1). */
        fun mediaUrl(baseUrl: String, accountId: String, ref: String): String =
            ServerConfig.mediaUrl(baseUrl, accountId, ref)
    }
}