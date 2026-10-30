package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.Client
import org.json.JSONArray
import org.json.JSONObject

// Messagerie : payloads `discussions`, `messages` et `recipients`.

private const val DISCUSSION_ENRICH_LIMIT = 12

private fun unreadOf(raw: Double): Int? =
    if (raw.isFinite() && raw >= 0 && raw <= 999 && raw == kotlin.math.floor(raw)) raw.toInt() else null

// #427 : la fraîcheur d'un fil est IGNORÉE, jamais inventée.
//
// Seuls les `DISCUSSION_ENRICH_LIMIT` premiers fils sont enrichis (chaque
// appel réseau coûte) : au-delà, la date du dernier message est INCONNUE.
// L'INVENTER (« maintenant ») faisait remonter les plus anciens fils en tête
// de la liste et mentait sur leur fraîcheur. Le champ `updatedAt` est donc
// OMIS tant qu'aucune date RÉELLE n'est connue : le client trie alors sur
// l'ordre d'arrivée.
//
// `nowIso` reste le paramètre par défaut de la fonction (signature stable,
// comme `capabilitiesPayload`) mais ne date plus aucun fil : d'où le
// `@Suppress` (paramètre conservé, plus référencé).
@Suppress("UNUSED_PARAMETER")
internal fun discussionsPayload(client: Client, nowIso: String = parisNowIso()): String {
    val arr = JSONArray()
    val raws = client.discussions()
    raws.forEachIndexed { i, d ->
        val id = boundedCp(d.id, 64)
        if (id.isEmpty()) return@forEachIndexed
        var lastMessageAt: String? = null
        // NULLE = fraîcheur inconnue : le champ sera omis du JSON.
        var updatedAt: String? = null
        if (i < DISCUSSION_ENRICH_LIMIT) {
            // #476 : les PARTICIPANTS ne sont PLUS téléchargés ici (un POST de
            // moins par fil) : ils ne servent qu'à l'affichage de la ligne et
            // à la recherche par nom — or le fil ouvert les redemande. La
            // LISTE ne promet donc plus de nom : les noms arrivent à
            // l'ouverture du fil.
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
            // Champ OMIS : les participants sont INCONNUS à ce stade (#476).
            putIf("updatedAt", updatedAt)
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
    // #476 : les participants du fil, demandés À L'OUVERTURE (un POST de
    // plus, là où la liste en economisait douze).
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

