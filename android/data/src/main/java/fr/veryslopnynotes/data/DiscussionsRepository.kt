package fr.veryslopnynotes.data

import android.os.Handler
import android.os.Looper
import fr.veryslopnynotes.core.Discussion
import fr.veryslopnynotes.core.DiscussionMessage
import fr.veryslopnynotes.core.DiscussionRecipient
import fr.veryslopnynotes.core.DiscussionRules
import fr.veryslopnynotes.core.ThreadMessageCache
import fr.veryslopnynotes.pronote.Client
import fr.veryslopnynotes.pronote.DiscussionClosed
import fr.veryslopnynotes.pronote.Message
import org.json.JSONArray
import org.json.JSONObject

/**
 * Messagerie : lecture de la liste des fils (cache `discussions`), des
 * messages d'un fil et des destinataires, plus les 4 écritures — le tout sur
 * le client local (ADR-003).
 *
 * I7 : une écriture ne part que d'un GESTE (répondre, créer, marquer lu,
 * supprimer) ; aucune donnée de messagerie n'est réinjectée dans une IA.
 * I1 : aucune adresse d'établissement ici ; les pièces jointes ne sont pas
 * téléchargées (l'écran affiche une notice).
 * I6 : corps/sujets = DONNÉES affichées telles quelles, jamais exécutées.
 */
data class DiscussionWriteOutcome(val ok: Boolean, val error: String?)

/** Fil absent du client : un refus de destinataires n'est PAS « introuvable ». */
class DiscussionNotFound : IllegalArgumentException("fil introuvable")

/** Destinataires demandés absents de la liste de l'établissement. */
class UnknownRecipients : IllegalArgumentException("destinataires inconnus")

/**
 * Un fil OUVERT : une PAGE de ses messages et ses participants. La première
 * page télécharge le fil (le protocole ne pagine pas) ; les suivantes sortent
 * du cache mémoire et ne coûtent aucune requête.
 */
data class DiscussionThread(
    val messages: List<DiscussionMessage>,
    val participants: List<String>,
    val total: Int = messages.size,
    val start: Int = 0,
) {
    val hasMore: Boolean get() = start > 0
}

class DiscussionsRepository(
    private val cache: CacheStore,
    private val provider: PronoteClientProvider = { PronoteSession.client },
    private val main: Handler = Handler(Looper.getMainLooper()),
) {

    /**
     * Une PAGE de messages d'un fil : lue à la demande, JAMAIS en cache disque.
     * Fil vide/illisible = liste vide, l'écran affiche son état vide propre.
     * Les participants voyagent avec la PREMIÈRE page ; les suivantes les
     * omettent (l'écran garde déjà les siens).
     */
    fun fetchMessages(discussionId: String, before: Int? = null, cb: (DiscussionThread?, String?) -> Unit) {
        val epoch = SessionEpoch.current()
        ClientQueue.submitUnit(
            key = "discussion-thread|$discussionId|${before ?: 0}",
            work = {
            if (!SessionEpoch.isCurrent(epoch)) throw StaleSessionRead()
            val client = provider()
            if (client == null) {
                // Sans session : liste vide, état vide propre, pas d'écran
                // d'erreur plein écran pour l'absence de connexion.
                ThreadMessageCache.clear()
                DiscussionListCache.clear()
                post { cb(null, null) }
                return@submitUnit
            }
            try {
                val target = boundedCp(discussionId, 64)
                val discussion = findDiscussion(client, target, epoch)
                if (discussion == null) {
                    post { cb(null, "Fil introuvable.") }
                    return@submitUnit
                }
                val page = ThreadMessageCache.page(epoch, target, before, SessionEpoch::current) {
                    discussion.messages().mapIndexedNotNull { i, m -> toDiscussionMessage(target, m, i) }
                }
                // Participants demandés à l'ouverture (première page) seulement.
                val participants = if (before == null) participantsOf(discussion) else emptyList()
                if (!SessionEpoch.isCurrent(epoch)) throw StaleSessionRead()
                post {
                    cb(
                        DiscussionThread(
                            messages = page.items,
                            participants = participants,
                            total = page.total,
                            start = page.start,
                        ),
                        null,
                    )
                }
            } catch (e: Exception) {
                if (isSessionFailure(e)) {
                    ThreadMessageCache.clear()
                    DiscussionListCache.clear()
                    DeviceAuth.reject()
                    post { cb(null, DeviceAuth.REJECTED_MESSAGE) }
                } else {
                    post { cb(null, null) }
                }
            }
            },
            onFailure = { post { cb(null, null) } },
        )
    }

    /** Fils visibles à enrichir : une requête `ListeMessages` par identifiant. */
    fun fetchEnrichment(ids: List<String>, cb: (String?, String?) -> Unit) {
        val epoch = SessionEpoch.current()
        ClientQueue.submitUnit(
            key = "discussion-enrich|${ids.joinToString(",")}",
            work = {
            if (!SessionEpoch.isCurrent(epoch)) throw StaleSessionRead()
            val client = provider()
            if (client == null) {
                post { cb(null, null) }
                return@submitUnit
            }
            try {
                val body = enrichmentPayload(client, ids, epoch)
                if (!SessionEpoch.isCurrent(epoch)) throw StaleSessionRead()
                post { cb(body, null) }
            } catch (e: Exception) {
                if (isSessionFailure(e)) {
                    ThreadMessageCache.clear()
                    DiscussionListCache.clear()
                    DeviceAuth.reject()
                    post { cb(null, DeviceAuth.REJECTED_MESSAGE) }
                } else {
                    post { cb(null, null) }
                }
            }
            },
            onFailure = { post { cb(null, null) } },
        )
    }

    /** Destinataires d'une nouvelle discussion (sélecteur). Vide = onglet absent. */
    fun fetchRecipients(cb: (List<DiscussionRecipient>, String?) -> Unit) {
        ClientQueue.submitUnit(
            key = "discussion-recipients|",
            work = {
            val client = provider()
            if (client == null) {
                post { cb(emptyList(), null) }
                return@submitUnit
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
            },
            onFailure = { post { cb(emptyList(), null) } },
        )
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
        ClientQueue.submitUnit(
            key = "discussion-create|${System.nanoTime()}",
            work = {
            val client = provider()
            if (client == null) {
                post { cb(DiscussionWriteOutcome(false, "Connexion indisponible, retour arrière.")) }
                return@submitUnit
            }
            val outcome = writeLocal("Création impossible.") {
                val matched = client.getRecipients().filter { it.id in ids }
                if (matched.isEmpty()) throw UnknownRecipients()
                client.newDiscussion(title, text, matched)
            }
            post { cb(outcome) }
            },
            onFailure = { post { cb(DiscussionWriteOutcome(false, "Connexion indisponible, retour arrière.")) } },
        )
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
        val epoch = SessionEpoch.current()
        ClientQueue.submitUnit(
            key = "discussion-reply|${System.nanoTime()}",
            work = {
            if (!SessionEpoch.isCurrent(epoch)) throw StaleSessionRead()
            val client = provider()
            if (client == null) {
                post { cb(DiscussionWriteOutcome(false, "Connexion indisponible, retour arrière.")) }
                return@submitUnit
            }
            val outcome = writeLocal("Réponse impossible.") {
                val discussion = findDiscussion(client, target, epoch)
                    ?: throw DiscussionNotFound()
                discussion.reply(text)
            }
            if (outcome.ok) ThreadMessageCache.invalidate(target)
            post { cb(outcome) }
            },
            onFailure = { post { cb(DiscussionWriteOutcome(false, "Connexion indisponible, retour arrière.")) } },
        )
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
        val epoch = SessionEpoch.current()
        ClientQueue.submitUnit(
            key = "discussion-read|${System.nanoTime()}",
            work = {
            if (!SessionEpoch.isCurrent(epoch)) throw StaleSessionRead()
            val client = provider()
            if (client == null) {
                post { cb(DiscussionWriteOutcome(false, "Connexion indisponible, retour arrière.")) }
                return@submitUnit
            }
            val outcome = writeLocal("État de lecture refusé.") {
                val discussion = findDiscussion(client, target, epoch)
                    ?: throw DiscussionNotFound()
                discussion.markAs(read)
            }
            post { cb(outcome) }
            },
            onFailure = { post { cb(DiscussionWriteOutcome(false, "Connexion indisponible, retour arrière.")) } },
        )
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
        val epoch = SessionEpoch.current()
        ClientQueue.submitUnit(
            key = "discussion-delete|${System.nanoTime()}",
            work = {
            if (!SessionEpoch.isCurrent(epoch)) throw StaleSessionRead()
            val client = provider()
            if (client == null) {
                post { cb(DiscussionWriteOutcome(false, "Connexion indisponible, retour arrière.")) }
                return@submitUnit
            }
            val outcome = writeLocal("Suppression impossible.") {
                val discussion = findDiscussion(client, target, epoch)
                    ?: throw DiscussionNotFound()
                discussion.delete()
            }
            if (outcome.ok) ThreadMessageCache.invalidate(target)
            post { cb(outcome) }
            },
            onFailure = { post { cb(DiscussionWriteOutcome(false, "Connexion indisponible, retour arrière.")) } },
        )
    }

    /** Liste déjà téléchargée d'abord : une ouverture ne refait pas `ListeMessagerie`. */
    private fun findDiscussion(
        client: Client,
        id: String,
        epoch: Long,
    ): fr.veryslopnynotes.pronote.Discussion? {
        val list = DiscussionListCache.get(epoch) ?: client.discussions().also {
            // La session a changé pendant la lecture : cette liste n'appartient
            // plus au compte courant, elle ne doit pas être utilisée (I16).
            if (!DiscussionListCache.put(it, epoch)) throw StaleSessionRead()
        }
        if (!SessionEpoch.isCurrent(epoch)) throw StaleSessionRead()
        return list.firstOrNull { it.id == id }
    }

    /** Participants d'un fil ouvert ; une panne réseau non-session = liste vide. */
    private fun participantsOf(discussion: fr.veryslopnynotes.pronote.Discussion): List<String> {
        return try {
            discussion.participants()
                .mapNotNull { boundedCp(it, 100).ifEmpty { null } }
                .distinct()
                .take(20)
        } catch (e: Exception) {
            if (mustPropagateReadFailure(e)) throw e
            emptyList()
        }
    }

    /** Message Pronote → contrat : corps borné, auteur vide = message du compte. */
    private fun toDiscussionMessage(
        discussionId: String,
        message: Message,
        index: Int,
    ): DiscussionMessage? {
        val body = boundedCp(message.content, 4000)
        if (body.isEmpty()) return null
        return DiscussionMessage(
            id = message.id.ifBlank { "m-$index" }.take(64),
            discussionId = discussionId,
            authorName = boundedCp(message.author, 100),
            body = body,
            sentAt = message.created.parisIso(),
        )
    }

    /** Écriture locale : succès = pas d'exception ; fil fermé/session = message. */
    private fun writeLocal(failure: String, block: () -> Unit): DiscussionWriteOutcome {
        return try {
            // Écriture CONFIRMÉE → invalide le cache : l'état d'avant ne
            // ressort plus. Une écriture refusée (exception) ne purge rien.
            writeAndInvalidate(cache, CachePolicy.DISCUSSIONS) { block() }
            // La liste (non-lus) et les objets `Discussion` ne sont plus à jour.
            DiscussionListCache.clear()
            DiscussionWriteOutcome(true, null)
        } catch (e: Exception) {
            if (isSessionFailure(e)) {
                DeviceAuth.reject()
                DiscussionWriteOutcome(false, DeviceAuth.REJECTED_MESSAGE)
            } else if (e is DiscussionNotFound) {
                DiscussionWriteOutcome(false, "$failure (Fil introuvable).")
            } else if (e is UnknownRecipients) {
                DiscussionWriteOutcome(false, "$failure (Destinataires inconnus).")
            } else if (e is DiscussionClosed) {
                // Par TYPE : R8 renomme la classe, `simpleName` ne la reconnaîtrait
                // plus en release (fil fermé affiché « Sans connexion »).
                DiscussionWriteOutcome(false, "$failure (Fil fermé).")
            } else if (e is IllegalArgumentException) {
                DiscussionWriteOutcome(false, "$failure (Demande refusée).")
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
    }
}
