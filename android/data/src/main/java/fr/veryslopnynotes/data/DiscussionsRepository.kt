package fr.veryslopnynotes.data

import android.os.Handler
import android.os.Looper
import fr.veryslopnynotes.core.Discussion
import fr.veryslopnynotes.core.DiscussionMessage
import fr.veryslopnynotes.core.DiscussionRecipient
import fr.veryslopnynotes.core.DiscussionRules
import fr.veryslopnynotes.core.MessageAttachment
import org.json.JSONArray
import org.json.JSONObject

/**
 * Messagerie #80 : lecture de la liste des fils (cache `discussions`), des
 * messages d'un fil et des destinataires, plus les 4 ÉCRITURES — le tout sur
 * le client local (#205, ADR-003).
 *
 * I7 : une écriture ne part que d'un GESTE de l'utilisateur (répondre, créer,
 * marquer lu, supprimer) — aucun appel automatique, aucune donnée de messagerie
 * n'est réinjectée dans une requête d'IA.
 * I1 : aucune adresse d'établissement ici (seul `android/pronote/` parle au
 * serveur de l'établissement) ; les pièces jointes ne sont pas téléchargées
 * (l'écran affiche une notice, comme avant).
 * I6 : corps/sujets = DONNÉES affichées telles quelles, jamais exécutées.
 */
data class DiscussionWriteOutcome(val ok: Boolean, val error: String?)

class DiscussionsRepository(
    private val cache: CacheStore,
    private val provider: PronoteClientProvider = { PronoteSession.client },
    private val main: Handler = Handler(Looper.getMainLooper()),
) {

    /**
     * Messages d'un fil : lus à la demande, JAMAIS en cache (donnée personnelle).
     * Fil vide/illisible = liste vide, l'écran affiche son état vide propre.
     */
    fun fetchMessages(discussionId: String, cb: (List<DiscussionMessage>, String?) -> Unit) {
        Thread {
            val client = provider()
            if (client == null) {
                // Sans session : liste vide, état vide propre — pas d'écran
                // d'erreur plein-écran pour l'absence de connexion (#260).
                post { cb(emptyList(), null) }
                return@Thread
            }
            try {
                val target = boundedCp(discussionId, 64)
                val discussion = client.discussions().firstOrNull { it.id == target }
                if (discussion == null) {
                    post { cb(emptyList(), "Fil introuvable.") }
                    return@Thread
                }
                val body = messagesPayload(discussionId, discussion)
                post { cb(parseMessages(body), null) }
            } catch (e: Exception) {
                if (isSessionFailure(e)) {
                    DeviceAuth.reject()
                    post { cb(emptyList(), DeviceAuth.REJECTED_MESSAGE) }
                } else {
                    post { cb(emptyList(), null) }
                }
            }
        }.start()
    }

    /** Destinataires d'une nouvelle discussion (sélecteur). Vide = onglet absent. */
    fun fetchRecipients(cb: (List<DiscussionRecipient>, String?) -> Unit) {
        Thread {
            val client = provider()
            if (client == null) {
                post { cb(emptyList(), null) }
                return@Thread
            }
            try {
                val body = recipientsPayload(client)
                post { cb(parseRecipients(body), null) }
            } catch (e: Exception) {
                if (isSessionFailure(e)) {
                    DeviceAuth.reject()
                    post { cb(emptyList(), DeviceAuth.REJECTED_MESSAGE) }
                } else {
                    post { cb(emptyList(), null) }
                }
            }
        }.start()
    }

    /** Nouvelle discussion (I7 : geste utilisateur confirmé). */
    fun create(
        baseUrl: String,
        subject: String,
        body: String,
        recipientIds: List<String>,
        cb: (DiscussionWriteOutcome) -> Unit,
    ) {
        if (baseUrl.isBlank()) {
            cb(DiscussionWriteOutcome(false, "Serveur non configuré."))
            return
        }
        val title = boundedCp(subject, 200)
        val text = boundedCp(body, 4000)
        val ids = recipientIds.map { boundedCp(it, 64) }.filter { it.isNotEmpty() }
        if (title.isEmpty() || text.isEmpty() || ids.isEmpty()) {
            post { cb(DiscussionWriteOutcome(false, "Création impossible.")) }
            return
        }
        Thread {
            val client = provider()
            if (client == null) {
                post { cb(DiscussionWriteOutcome(false, "Connexion indisponible, retour arrière.")) }
                return@Thread
            }
            val outcome = writeLocal("Création impossible.") {
                val matched = client.getRecipients().filter { it.id in ids }
                if (matched.isEmpty()) throw IllegalArgumentException("destinataires inconnus")
                client.newDiscussion(title, text, matched)
            }
            post { cb(outcome) }
        }.start()
    }

    /** Réponse dans un fil (I7). */
    fun reply(baseUrl: String, discussionId: String, body: String, cb: (DiscussionWriteOutcome) -> Unit) {
        if (baseUrl.isBlank()) {
            cb(DiscussionWriteOutcome(false, "Serveur non configuré."))
            return
        }
        val target = boundedCp(discussionId, 64)
        val text = boundedCp(body, 4000)
        if (target.isEmpty() || text.isEmpty()) {
            post { cb(DiscussionWriteOutcome(false, "Réponse impossible.")) }
            return
        }
        Thread {
            val client = provider()
            if (client == null) {
                post { cb(DiscussionWriteOutcome(false, "Connexion indisponible, retour arrière.")) }
                return@Thread
            }
            val outcome = writeLocal("Réponse impossible.") {
                val discussion = client.discussions().firstOrNull { it.id == target }
                    ?: throw IllegalArgumentException("fil introuvable")
                discussion.reply(text)
            }
            post { cb(outcome) }
        }.start()
    }

    /** Marquer lu / non-lu (I7). */
    fun setRead(baseUrl: String, discussionId: String, read: Boolean, cb: (DiscussionWriteOutcome) -> Unit) {
        if (baseUrl.isBlank()) {
            cb(DiscussionWriteOutcome(false, "Serveur non configuré."))
            return
        }
        val target = boundedCp(discussionId, 64)
        if (target.isEmpty()) {
            post { cb(DiscussionWriteOutcome(false, "État de lecture refusé.")) }
            return
        }
        Thread {
            val client = provider()
            if (client == null) {
                post { cb(DiscussionWriteOutcome(false, "Connexion indisponible, retour arrière.")) }
                return@Thread
            }
            val outcome = writeLocal("État de lecture refusé.") {
                val discussion = client.discussions().firstOrNull { it.id == target }
                    ?: throw IllegalArgumentException("fil introuvable")
                discussion.markAs(read)
            }
            post { cb(outcome) }
        }.start()
    }

    /** Mise à la corbeille (I7). */
    fun delete(baseUrl: String, discussionId: String, cb: (DiscussionWriteOutcome) -> Unit) {
        if (baseUrl.isBlank()) {
            cb(DiscussionWriteOutcome(false, "Serveur non configuré."))
            return
        }
        val target = boundedCp(discussionId, 64)
        if (target.isEmpty()) {
            post { cb(DiscussionWriteOutcome(false, "Suppression impossible.")) }
            return
        }
        Thread {
            val client = provider()
            if (client == null) {
                post { cb(DiscussionWriteOutcome(false, "Connexion indisponible, retour arrière.")) }
                return@Thread
            }
            val outcome = writeLocal("Suppression impossible.") {
                val discussion = client.discussions().firstOrNull { it.id == target }
                    ?: throw IllegalArgumentException("fil introuvable")
                discussion.delete()
            }
            post { cb(outcome) }
        }.start()
    }

    /** Écriture locale : succès = pas d'exception ; fil fermé/session = message. */
    private fun writeLocal(failure: String, block: () -> Unit): DiscussionWriteOutcome {
        return try {
            // #369 : écriture CONFIRMÉE -> l'entrée de cache de la messagerie ne
            // ressert plus l'état d'avant (fil supprimé qui réapparaît, fil
            // créé absent, compteur de non-lus figé). Une écriture refusée
            // (exception) ne purge rien.
            writeAndInvalidate(cache, CachePolicy.DISCUSSIONS) { block() }
            DiscussionWriteOutcome(true, null)
        } catch (e: Exception) {
            if (isSessionFailure(e)) {
                DeviceAuth.reject()
                DiscussionWriteOutcome(false, DeviceAuth.REJECTED_MESSAGE)
            } else if (e is IllegalArgumentException) {
                DiscussionWriteOutcome(false, "$failure (Fil introuvable).")
            } else if (e.javaClass.simpleName == "DiscussionClosed") {
                DiscussionWriteOutcome(false, "$failure (Fil fermé).")
            } else {
                DiscussionWriteOutcome(false, "$failure (Sans connexion).")
            }
        }
    }

    private fun post(block: () -> Unit) {
        try {
            main.post { block() }
        } catch (_: Exception) {
            block()
        }
    }

    companion object {
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

        /** UNKNOWN_UNREAD : champ absent = l'établissement ne publie pas le compteur. */
        private fun unreadOf(o: JSONObject): Int =
            if (o.isNull("unreadCount")) DiscussionRules.UNKNOWN_UNREAD else o.optInt("unreadCount", DiscussionRules.UNKNOWN_UNREAD)

        /** Liste des fils depuis le cache : payload absent/illisible = vide. */
        fun discussionsFromPayload(payload: String?): List<Discussion> = try {
            if (payload == null) emptyList() else parse(payload)
        } catch (_: Exception) {
            emptyList()
        }
    }
}
