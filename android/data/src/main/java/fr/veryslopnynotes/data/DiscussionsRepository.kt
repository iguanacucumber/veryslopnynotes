package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.Discussion
import fr.veryslopnynotes.core.DiscussionMessage
import fr.veryslopnynotes.core.DiscussionRecipient
import fr.veryslopnynotes.core.DiscussionRules
import fr.veryslopnynotes.core.MessageAttachment
import fr.veryslopnynotes.core.ServerConfig
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

/**
 * Messagerie #80 : lecture de la liste des fils (cache `discussions`), des
 * messages d'un fil et des destinataires, plus les 4 ÉCRITURES.
 *
 * I7 : une écriture ne part que d'un GESTE de l'utilisateur (répondre, créer,
 * marquer lu, supprimer) — aucun appel automatique, aucune donnée de messagerie
 * n'est réinjectée dans une requête d'IA. Le serveur refuse de toute façon toute
 * écriture non confirmée par l'app.
 * I1 : tous les chemins viennent de ServerConfig (serveur allowlist seul), les
 * pièces jointes passent par le proxy /v1/media — aucune adresse d'ENT ici.
 * I6 : corps/sujets = DONNÉES affichées telles quelles, jamais exécutées.
 */
data class DiscussionWriteOutcome(val ok: Boolean, val error: String?)

class DiscussionsRepository(private val api: ApiClient) {

    fun discussionsRequest(): Request = api.buildGet(ServerConfig.discussionsPath())

    fun messagesRequest(discussionId: String): Request =
        api.buildGet(ServerConfig.discussionMessagesPath(discussionId))

    fun recipientsRequest(): Request = api.buildGet(ServerConfig.discussionRecipientsPath())

    /**
     * Messages d'un fil : lus à la demande, JAMAIS en cache (donnée personnelle).
     * Fil vide/illisible = liste vide, l'écran affiche son état vide propre.
     */
    fun fetchMessages(discussionId: String, cb: (List<DiscussionMessage>, String?) -> Unit) {
        val call = api.client().newCall(messagesRequest(discussionId))
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                cb(emptyList(), "Hors-ligne, messages indisponibles.")
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (!it.isSuccessful) {
                        cb(emptyList(), "Messages indisponibles (HTTP ${it.code}).")
                        return
                    }
                    cb(parseMessages(it.body?.string().orEmpty()), null)
                }
            }
        })
    }

    /** Destinataires d'une nouvelle discussion (sélecteur). Vide = onglet absent. */
    fun fetchRecipients(cb: (List<DiscussionRecipient>, String?) -> Unit) {
        val call = api.client().newCall(recipientsRequest())
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                cb(emptyList(), "Hors-ligne, destinataires indisponibles.")
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (!it.isSuccessful) {
                        cb(emptyList(), "Destinataires indisponibles (HTTP ${it.code}).")
                        return
                    }
                    cb(parseRecipients(it.body?.string().orEmpty()), null)
                }
            }
        })
    }

    /** Nouvelle discussion (I7 : geste utilisateur confirmé). */
    fun create(
        baseUrl: String,
        subject: String,
        body: String,
        recipientIds: List<String>,
        cb: (DiscussionWriteOutcome) -> Unit,
    ) = postAction(
        ServerConfig.discussionCreatePath(),
        baseUrl,
        JSONObject()
            .put("subject", subject)
            .put("body", body)
            .put("recipientIds", jsonArrayOf(recipientIds))
            .toString(),
        "Création impossible.",
        cb,
    )

    /** Réponse dans un fil (I7). */
    fun reply(baseUrl: String, discussionId: String, body: String, cb: (DiscussionWriteOutcome) -> Unit) =
        postAction(
            ServerConfig.discussionReplyPath(),
            baseUrl,
            JSONObject().put("discussionId", discussionId).put("body", body).toString(),
            "Réponse impossible.",
            cb,
        )

    /** Marquer lu / non-lu (I7). */
    fun setRead(baseUrl: String, discussionId: String, read: Boolean, cb: (DiscussionWriteOutcome) -> Unit) =
        postAction(
            ServerConfig.discussionReadStatePath(),
            baseUrl,
            JSONObject().put("discussionId", discussionId).put("read", read).toString(),
            "État de lecture refusé.",
            cb,
        )

    /** Mise à la corbeille (I7). */
    fun delete(baseUrl: String, discussionId: String, cb: (DiscussionWriteOutcome) -> Unit) =
        postAction(
            ServerConfig.discussionDeletePath(),
            baseUrl,
            JSONObject().put("discussionId", discussionId).toString(),
            "Suppression impossible.",
            cb,
        )

    /** Enveloppe commune des 4 actions : `{ok, event}`. */
    private fun postAction(
        path: String,
        baseUrl: String,
        body: String,
        failure: String,
        cb: (DiscussionWriteOutcome) -> Unit,
    ) {
        if (baseUrl.isBlank()) {
            cb(DiscussionWriteOutcome(false, "Serveur non configuré."))
            return
        }
        val request = try {
            // Chemin issu de ServerConfig seul (I1).
            api.buildPost(path, body.toRequestBody(JSON))
        } catch (_: IllegalArgumentException) {
            cb(DiscussionWriteOutcome(false, "URL hors allowlist serveur"))
            return
        }
        api.client().newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                cb(DiscussionWriteOutcome(false, "Hors-ligne, retour arrière."))
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (!it.isSuccessful) {
                        // 401 session expirée, 409 indisponible, 501 non supporté.
                        cb(DiscussionWriteOutcome(false, "$failure (HTTP ${it.code})."))
                        return
                    }
                    val outcome = parseAction(it.body?.string().orEmpty())
                    cb(outcome ?: DiscussionWriteOutcome(false, "Réponse illisible."))
                }
            }
        })
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()

        /** UNKNOWN_UNREAD : champ absent = l'ENT ne publie pas le compteur. */
        private fun unreadOf(o: JSONObject): Int =
            if (o.isNull("unreadCount")) DiscussionRules.UNKNOWN_UNREAD else o.optInt("unreadCount", DiscussionRules.UNKNOWN_UNREAD)

        private fun jsonArrayOf(ids: List<String>): JSONArray {
            val arr = JSONArray()
            for (id in ids) arr.put(id)
            return arr
        }

        // ponytail: parse manuel org.json (SDK, sans dépendance). Upgrade:
        // kotlinx.serialization si les modèles de messagerie dépassent 10 types.
        fun parse(body: String): List<Discussion> {
            val root = JSONObject(body)
            val arr = root.optJSONArray("discussions") ?: JSONArray()
            val out = mutableListOf<Discussion>()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val parts = mutableListOf<String>()
                val pArr = o.optJSONArray("participants")
                for (p in 0 until (pArr?.length() ?: 0)) {
                    val name = pArr?.optString(p, "") ?: ""
                    if (name.isNotBlank()) parts.add(name)
                }
                val d = Discussion(
                    id = o.optString("id", ""),
                    subject = o.optString("subject", ""),
                    participants = parts,
                    unreadCount = unreadOf(o),
                    lastMessageAt = o.optString("lastMessageAt", ""),
                    updatedAt = o.optString("updatedAt", ""),
                )
                // Discussion hors contrat écartée (pas de ligne cassée affichée).
                if (d.isValid()) out.add(d)
            }
            return out
        }

        fun parseMessages(body: String): List<DiscussionMessage> {
            val root = JSONObject(body)
            val arr = root.optJSONArray("messages") ?: JSONArray()
            val out = mutableListOf<DiscussionMessage>()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val m = DiscussionMessage(
                    id = o.optString("id", ""),
                    discussionId = o.optString("discussionId", ""),
                    authorName = o.optString("authorName", ""),
                    body = o.optString("body", ""),
                    sentAt = o.optString("sentAt", ""),
                    attachments = parseAttachments(o.optJSONArray("attachments")),
                )
                if (m.isValid()) out.add(m)
            }
            return out
        }

        /** Pièces jointes : `ref` en URL = rejetée (règle d'or média, I1). */
        private fun parseAttachments(arr: JSONArray?): List<MessageAttachment> {
            val out = mutableListOf<MessageAttachment>()
            for (i in 0 until (arr?.length() ?: 0)) {
                val o = arr?.optJSONObject(i) ?: continue
                val a = MessageAttachment(
                    id = o.optString("id", ""),
                    label = o.optString("label", ""),
                    ref = o.optString("ref", ""),
                )
                if (!a.isValid()) return emptyList()
                out.add(a)
            }
            return out
        }

        fun parseRecipients(body: String): List<DiscussionRecipient> {
            val root = JSONObject(body)
            val arr = root.optJSONArray("recipients") ?: JSONArray()
            val out = mutableListOf<DiscussionRecipient>()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val r = DiscussionRecipient(
                    id = o.optString("id", ""),
                    displayName = o.optString("displayName", ""),
                    kind = o.optString("kind", ""),
                )
                if (r.isValid()) out.add(r)
            }
            return out
        }

        /**
         * Réponse d'action : `ok === true` ET invalidation de la ressource
         * `discussions` (événement EXISTANT CacheInvalidated). Une réponse qui
         * ne le prouve pas = échec affiché, pas de faux succès.
         */
        fun parseAction(body: String): DiscussionWriteOutcome? = try {
            val root = JSONObject(body)
            val event = root.optJSONObject("event") ?: return null
            val resource = event.optJSONObject("data")?.optString("resource", "") ?: ""
            val type = event.optString("type", "")
            if (root.optBoolean("ok", false) && type == "CacheInvalidated" && resource == "discussions") {
                DiscussionWriteOutcome(true, null)
            } else {
                DiscussionWriteOutcome(false, "Réponse illisible.")
            }
        } catch (_: Exception) {
            null
        }

        /** Liste des fils depuis le cache : payload absent/illisible = vide. */
        fun discussionsFromPayload(payload: String?): List<Discussion> = try {
            if (payload == null) emptyList() else parse(payload)
        } catch (_: Exception) {
            emptyList()
        }
    }
}