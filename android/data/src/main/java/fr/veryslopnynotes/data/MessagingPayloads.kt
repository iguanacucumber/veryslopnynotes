package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.Client
import org.json.JSONArray
import org.json.JSONObject

private const val DISCUSSION_ENRICH_LIMIT = 12

private fun unreadOf(raw: Double): Int? =
    if (raw.isFinite() && raw >= 0 && raw <= 999 && raw == kotlin.math.floor(raw)) raw.toInt() else null

// Seuls les `DISCUSSION_ENRICH_LIMIT` premiers fils sont enrichis (chaque appel
// réseau coûte) : au-delà, la date du dernier message est INCONNUE, et
// `updatedAt` est OMIS plutôt qu'inventé — sinon les fils anciens remontent en
// tête et mentent sur leur fraîcheur. `nowIso` reste un paramètre à signature
// stable mais ne date plus aucun fil, d'où le `@Suppress`.
@Suppress("UNUSED_PARAMETER")
internal fun discussionsPayload(client: Client, nowIso: String = parisNowIso()): String {
    val arr = JSONArray()
    val raws = client.discussions()
    raws.forEachIndexed { i, d ->
        val id = boundedCp(d.id, 64)
        if (id.isEmpty()) return@forEachIndexed
        var lastMessageAt: String? = null
        var updatedAt: String? = null
        if (i < DISCUSSION_ENRICH_LIMIT) {
            // Participants non téléchargés ici : la liste ne promet pas de nom,
            // le fil ouvert les redemande.
            try {
                val msgs = d.messages()
                val last = msgs.lastOrNull()
                val first = msgs.firstOrNull()
                last?.created?.parisIso()?.let {
                    lastMessageAt = it
                    updatedAt = it
                } ?: first?.created?.parisIso()?.let { updatedAt = it }
            } catch (e: Exception) {
                if (mustPropagateReadFailure(e)) throw e
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
    return JSONObject().put("discussions", arr).toString()
}

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
    // Participants demandés à l'ouverture du fil (la liste ne les charge pas).
    val parts = JSONArray()
    try {
        discussion.participants()
            .mapNotNullTo(LinkedHashSet()) { boundedCp(it, 100).ifEmpty { null } }
            .take(20)
            .forEach { parts.put(it) }
    } catch (e: Exception) {
        if (mustPropagateReadFailure(e)) throw e
    }
    return JSONObject().put("messages", arr).put("participants", parts).toString()
}

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

