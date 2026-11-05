package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.MessagePaging
import fr.veryslopnynotes.pronote.Client
import fr.veryslopnynotes.pronote.Message
import fr.veryslopnynotes.pronote.PartialRead
import org.json.JSONArray
import org.json.JSONObject

private const val DISCUSSION_ENRICH_LIMIT = 12

private data class KnownThread(val date: String?, val unread: Int?)

private fun unreadOf(raw: Double): Int? =
    if (raw.isFinite() && raw >= 0 && raw <= 999 && raw == kotlin.math.floor(raw)) raw.toInt() else null

/** Dates du payload PRÉCÉDENT (même requête) : un fil resté lu n'a pas bougé. */
private fun knownThreads(previous: String?): Map<String, KnownThread> {
    if (previous.isNullOrBlank()) return emptyMap()
    return try {
        val arr = JSONObject(previous).optJSONArray("discussions") ?: return emptyMap()
        val out = HashMap<String, KnownThread>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val id = o.optString("id", "")
            if (id.isEmpty()) continue
            val date = o.optString("lastMessageAt", "").ifEmpty { o.optString("updatedAt", "") }
            out[id] = KnownThread(
                date = date.ifEmpty { null },
                unread = if (o.has("unreadCount")) o.optInt("unreadCount", 0) else null,
            )
        }
        out
    } catch (_: Exception) {
        emptyMap()
    }
}

// Seuls les `DISCUSSION_ENRICH_LIMIT` premiers fils sont enrichis (chaque appel
// réseau coûte) : au-delà, la date du dernier message est INCONNUE, et
// `updatedAt` est OMIS plutôt qu'inventé — sinon les fils anciens remontent en
// tête et mentent sur leur fraîcheur. Une date déjà connue d'un fil resté lu est
// RÉUTILISÉE : sans nouveau message, relire `ListeMessages` ne dirait rien de
// plus. `nowIso` reste un paramètre à signature stable mais ne date plus aucun
// fil, d'où le `@Suppress`.
@Suppress("UNUSED_PARAMETER")
internal fun discussionsPayload(
    client: Client,
    nowIso: String = parisNowIso(),
    previous: String? = null,
    epoch: Long = SessionEpoch.current(),
): String {
    val arr = JSONArray()
    val known = knownThreads(previous)
    val read = client.discussionsPartial()
    val raws = read.value
    var partial = read.partial
    // La liste ne se publie que pour la session qui l'a lue : un retour après
    // déconnexion ne repeuple pas le cache du compte suivant (I16).
    DiscussionListCache.put(raws, epoch)
    raws.forEachIndexed { i, d ->
        val id = boundedCp(d.id, 64)
        if (id.isEmpty()) return@forEachIndexed
        var lastMessageAt: String? = null
        var updatedAt: String? = null
        val before = known[id]
        if (before != null && before.date != null && before.unread == 0 && d.unread <= 0.0) {
            lastMessageAt = before.date
            updatedAt = before.date
        } else if (i < DISCUSSION_ENRICH_LIMIT) {
            // Participants non téléchargés ici : la liste ne promet pas de nom,
            // le fil ouvert les redemande.
            try {
                val dates = datesOf(d.messages())
                lastMessageAt = dates.first
                updatedAt = dates.second
            } catch (e: Exception) {
                if (mustPropagateReadFailure(e)) throw e
                partial = true
            }
        }
        arr.put(JSONObject().apply {
            put("id", id)
            put("subject", boundedCp(d.subject, 200).ifEmpty { "Discussion" })
            putIf("updatedAt", updatedAt)
            unreadOf(d.unread)?.let { put("unreadCount", it) }
            lastMessageAt?.let { put("lastMessageAt", it) }
        })
    }
    return JSONObject().put("discussions", arr).apply { putFlag("partial", partial) }.toString()
}

/** Dates réelles d'un fil : dernier message, sinon premier (fil sans réponse). */
private fun datesOf(messages: List<Message>): Pair<String?, String?> {
    val last = messages.lastOrNull()
    val first = messages.firstOrNull()
    var lastMessageAt: String? = null
    var updatedAt: String? = null
    last?.created?.parisIso()?.let {
        lastMessageAt = it
        updatedAt = it
    } ?: first?.created?.parisIso()?.let { updatedAt = it }
    return lastMessageAt to updatedAt
}

/**
 * Enrichissement EXPLICITE des fils visibles : mêmes dates que la liste, mais
 * seulement pour les identifiants demandés. La liste déjà téléchargée est
 * réutilisée quand elle est fraîche, donc une vue qui défile ne refait pas
 * `ListeMessagerie` pour chaque ligne.
 */
internal fun enrichmentPayload(
    client: Client,
    ids: List<String>,
    epoch: Long = SessionEpoch.current(),
): String {
    val cached = DiscussionListCache.get(epoch)
    val read = if (cached != null) {
        PartialRead(cached, false)
    } else {
        client.discussionsPartial().also { DiscussionListCache.put(it.value, epoch) }
    }
    val byId = read.value.associateBy { it.id }
    var partial = read.partial
    val arr = JSONArray()
    val wanted = MessagePaging.enrichBatch(ids, emptySet())
    for (id in wanted) {
        val discussion = byId[id] ?: continue
        var lastMessageAt: String? = null
        var updatedAt: String? = null
        try {
            val dates = datesOf(discussion.messages())
            lastMessageAt = dates.first
            updatedAt = dates.second
        } catch (e: Exception) {
            if (mustPropagateReadFailure(e)) throw e
            partial = true
        }
        arr.put(JSONObject().apply {
            put("id", boundedCp(id, 64))
            putIf("lastMessageAt", lastMessageAt)
            putIf("updatedAt", updatedAt)
        })
    }
    return JSONObject().put("discussions", arr).apply { putFlag("partial", partial) }.toString()
}

internal fun recipientsPayload(client: Client): String {
    val arr = JSONArray()
    val read = client.getRecipientsPartial()
    for (r in read.value) {
        val id = boundedCp(r.id, 64)
        val name = boundedCp(r.name, 100)
        if (id.isEmpty() || name.isEmpty()) continue
        arr.put(JSONObject().apply {
            put("id", id)
            put("displayName", name)
            put("kind", if (r.type == "teacher") "teacher" else "administration")
        })
    }
    return JSONObject().put("recipients", arr).apply { putFlag("partial", read.partial) }.toString()
}

