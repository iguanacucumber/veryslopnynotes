package fr.veryslopnynotes.app

import fr.veryslopnynotes.core.AssignmentAttachment
import fr.veryslopnynotes.core.Capabilities
import fr.veryslopnynotes.core.CapabilitiesJson
import fr.veryslopnynotes.core.DiscussionRecipient
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.DiscussionWriteOutcome
import fr.veryslopnynotes.data.RefreshOutcome
import org.json.JSONArray
import org.json.JSONObject
import fr.veryslopnynotes.data.SessionEpoch

// --- Ressources ------------------------------------------------------------

internal fun VsnBridge.resourceCached(p: JSONObject, epoch: Long): JSONObject {
    // #529 : la session a changé depuis l'ARRIVÉE de l'appel (le cache a
    // été purgé : déconnexion, session morte, OU bascule de compte). L'entrée
    // servie pourrait alors être celle d'un AUTRE compte — on ne sert rien.
    if (SessionEpoch.current() != epoch) return emptyCached()
    val key = p.string("key")
    val resource = cacheKey(key) ?: return emptyCached()
    // #477 : le cache est indexé par (ressource, requête) : l'entrée servie
    // est celle de la requête AFFICHÉE, pas celle d'une autre semaine.
    val query = bounded(p.string("query"), 200)
    val entry = repo.cached(resource, query) ?: return emptyCached()
    return JSONObject()
        .put("payload", entry.payload)
        .put("fetchedAt", entry.fetchedAt)
        .put("stale", repo.isStale(resource, entry))
        .put("error", JSONObject.NULL)
}

internal fun VsnBridge.emptyCached(): JSONObject = JSONObject()
    .put("payload", JSONObject.NULL)
    .put("fetchedAt", 0L)
    .put("stale", false)
    .put("error", JSONObject.NULL)

internal fun VsnBridge.resourceLoad(p: JSONObject): JSONObject {
    val key = p.string("key")
    if (key == "profile") {
        return profileMe()
            .put("fetchedAt", System.currentTimeMillis())
            .put("stale", false)
    }
    if (key == "periods") {
        val outcome = await<RefreshOutcome> { cb ->
            repo.fetchPeriods(currentBaseUrl(), cb)
        } ?: throw BridgeFailure("unavailable", "Tranches indisponibles.")
        return resultJson(outcome, null)
    }
    val resource = cacheKey(key) ?: throw BridgeFailure("bad_request", "Ressource inconnue.")
    val query = bounded(p.string("query"), 200)
    val outcome = await<RefreshOutcome> { cb ->
        repo.refreshAsync(resource, currentBaseUrl(), query, p.optBoolean("force", false), cb)
    } ?: throw BridgeFailure("unavailable", "Lecture indisponible.")
    return resultJson(outcome, resource, query)
}

internal fun VsnBridge.resourceInvalidate(p: JSONObject): JSONObject {
    val resource = cacheKey(p.string("key"))
        ?: throw BridgeFailure("bad_request", "Ressource inconnue.")
    repo.invalidate(resource)
    return JSONObject().put("ok", true)
}

internal fun VsnBridge.resourceSync(): JSONObject {
    val outcome = await<RefreshOutcome> { cb ->
        repo.requestSyncRefresh(currentBaseUrl(), accounts.current().orEmpty(), cb)
    } ?: throw BridgeFailure("unavailable", "Relecture indisponible.")
    return resultJson(outcome, null)
}

internal fun VsnBridge.resultJson(outcome: RefreshOutcome, resource: String?, query: String = ""): JSONObject {
    val obj = JSONObject()
    when (outcome) {
        is RefreshOutcome.Updated -> obj
            .put("payload", outcome.payload)
            .put("fetchedAt", outcome.fetchedAt)
            .put("stale", false)
            .put("error", JSONObject.NULL)
        is RefreshOutcome.OfflineFallback -> obj
            .put("payload", outcome.payload)
            .put("fetchedAt", outcome.fetchedAt)
            .put("stale", outcome.stale)
            .put("error", "Données en cache (hors ligne).")
        is RefreshOutcome.Failed -> {
            sessionOrThrow(outcome.message)
            // #477 : l'entrée de cache servie est celle de la MÊME requête.
            val cached = resource?.let { repo.cached(it, query) }
            obj.put("payload", outcome.cachedPayload ?: JSONObject.NULL)
                .put("fetchedAt", cached?.fetchedAt ?: 0L)
                .put("stale", true)
                .put("error", outcome.message)
        }
    }
    return obj
}

internal fun VsnBridge.capabilitiesJson(force: Boolean): JSONObject {
    val outcome = await<RefreshOutcome> { cb ->
        repo.refreshAsync(CachePolicy.CAPABILITIES, currentBaseUrl(), force = force, cb = cb)
    }
    if (outcome is RefreshOutcome.Failed) sessionOrThrow(outcome.message)
    val payload = when (outcome) {
        is RefreshOutcome.Updated -> outcome.payload
        is RefreshOutcome.OfflineFallback -> outcome.payload
        else -> null
    }
    // Capacités inconnues = rien n'est affirmé : liste complète.
    val tabs = CapabilitiesJson.parse(payload)?.tabs ?: Capabilities.TABS
    return JSONObject().put("tabs", JSONArray(tabs))
}

// --- Actualités -----------------------------------------------------------

/**
 * Corps d'une actualité (#475) : lu À LA DEMANDE, au dépliage.
 *
 * La liste ne télécharge plus les corps (21 POST pour un écran dont
 * l'élève ne lit que 2-3 actus) : celui-ci arrive ici, à la demande, en
 * un POST. Le corps est une DONNÉE (texte brut), jamais du HTML (I6) : le
 * JS l'affiche dans un nœud texte.
 */
internal fun VsnBridge.newsItem(p: JSONObject): JSONObject {
    val id = bounded(p.string("id"), 64)
    if (id.isEmpty()) throw BridgeFailure("bad_request", "Actualité introuvable.")
    val result = await<Pair<String?, String?>> { cb ->
        repo.fetchNewsBody(id) { body, error -> cb(body to error) }
    } ?: throw BridgeFailure("unavailable", "Actualité indisponible.")
    val (body, error) = result
    sessionOrThrow(error)
    // Un échec de lecture = un REJET borné : la carte affiche son état
    // (« Contenu indisponible. »), jamais une page d'erreur.
    if (error != null) throw BridgeFailure("unavailable", error)
    return JSONObject().put("body", body ?: "")
}

// --- Devoirs ---------------------------------------------------------------

internal fun VsnBridge.toggleAssignment(p: JSONObject): JSONObject {
    val id = bounded(p.string("id"), 128)
    if (id.isEmpty()) throw BridgeFailure("bad_request", "Devoir introuvable.")
    val done = p.optBoolean("done", false)
    // #369 : la semaine AFFICHÉE (le `weekStart` de l'écran) : la fenêtre
    // de recherche suit le payload affiché, sinon le devoir est visible
    // mais « introuvable ».
    val week = bounded(p.string("weekStart"), 10)
    val outcome = await<fr.veryslopnynotes.data.ToggleOutcome> { cb ->
        assignments.toggle(currentBaseUrl(), id, done, week, cb)
    } ?: throw BridgeFailure("unavailable", "Bascule indisponible.")
    sessionOrThrow(outcome.error)
    return JSONObject()
        .put("ok", outcome.assignment != null)
        .apply { outcome.error?.let { put("error", it) } }
}

internal fun VsnBridge.openAttachment(p: JSONObject): JSONObject {
    val homeworkId = bounded(p.string("homeworkId"), 128)
    val attachmentId = bounded(p.string("attachmentId"), 128)
    if (homeworkId.isEmpty() || attachmentId.isEmpty()) {
        throw BridgeFailure("bad_request", "Pièce jointe introuvable.")
    }
    // Même semaine affichée que le toggle (#369).
    val week = bounded(p.string("weekStart"), 10)
    // #540 : l'époque est capturée AVANT le téléchargement : une pièce
    // jointe téléchargée pendant une déconnexion n'est pas écrite (le
    // cache purgé ne ressuscite pas).
    val epoch = SessionEpoch.current()
    val data = await<fr.veryslopnynotes.data.AttachmentData?> { cb ->
        assignments.fetchAttachment(homeworkId, attachmentId, week, cb)
    } ?: return JSONObject().put("ok", false).put("error", "Pièce jointe indisponible.")
    return try {
        val file = writeAttachmentFile(
            ctx,
            homeworkId,
            AssignmentAttachment(id = attachmentId, label = data.name, ref = ""),
            data.bytes,
            epoch,
        ) ?: return JSONObject().put("ok", false).put("error", "Pièce jointe indisponible.")
        openFile(file, mimeOf(data.name))
        JSONObject().put("ok", true)
    } catch (_: Exception) {
        JSONObject().put("ok", false).put("error", "Pièce jointe illisible.")
    }
}

// --- Messagerie ------------------------------------------------------------

internal fun VsnBridge.messagesList(): JSONObject {
    val outcome = await<RefreshOutcome> { cb ->
        repo.refreshAsync(CachePolicy.DISCUSSIONS, currentBaseUrl(), force = false, cb = cb)
    }
    if (outcome is RefreshOutcome.Failed) sessionOrThrow(outcome.message)
    val payload = when (outcome) {
        is RefreshOutcome.Updated -> outcome.payload
        is RefreshOutcome.OfflineFallback -> outcome.payload
        is RefreshOutcome.Failed -> outcome.cachedPayload
        null -> null
    }
    return JSONObject().put("payload", payload ?: JSONObject.NULL)
}

internal fun VsnBridge.messagesThread(p: JSONObject): JSONObject {
    val id = bounded(p.string("id"), 64)
    if (id.isEmpty()) throw BridgeFailure("bad_request", "Fil introuvable.")
    val result = await<Pair<fr.veryslopnynotes.data.DiscussionThread?, String?>> { cb ->
        discussions.fetchMessages(id) { thread, error -> cb(thread to error) }
    } ?: throw BridgeFailure("unavailable", "Fil indisponible.")
    val (thread, error) = result
    sessionOrThrow(error)
    val arr = JSONArray()
    for (m in thread?.messages ?: emptyList()) {
        arr.put(
            JSONObject()
                .put("id", m.id)
                .put("discussionId", m.discussionId)
                .put("authorName", m.authorName)
                .put("body", m.body)
                .put("sentAt", m.sentAt)
                .put(
                    "attachments",
                    JSONArray().apply {
                        for (a in m.attachments) {
                            put(
                                JSONObject()
                                    .put("id", a.id)
                                    .put("label", a.label)
                                    .put("ref", a.ref),
                            )
                        }
                    },
                ),
        )
    }
    val obj = JSONObject()
        // #476 : les participants voyagent avec le fil ouvert (ils ne sont
        // plus téléchargés pour toute la liste).
        .put(
            "payload",
            JSONObject()
                .put("messages", arr)
                .put("participants", JSONArray(thread?.participants ?: emptyList<String>()))
                .toString(),
        )
    error?.let { obj.put("error", it) }
    return obj
}

internal fun VsnBridge.messagesReply(p: JSONObject): JSONObject {
    val id = bounded(p.string("id"), 64)
    val body = bounded(p.string("body"), 4000)
    return writeOutcome { cb -> discussions.reply(currentBaseUrl(), id, body, cb) }
}

internal fun VsnBridge.messagesCreate(p: JSONObject): JSONObject {
    val ids = p.optJSONArray("recipients") ?: JSONArray()
    if (ids.length() > 8) throw BridgeFailure("bad_request", "Trop de destinataires.")
    val recipients = mutableListOf<String>()
    for (i in 0 until ids.length()) {
        val id = ids.optString(i, "").trim()
        if (id.isNotEmpty()) recipients.add(bounded(id, 64))
    }
    val subject = bounded(p.string("subject"), 200)
    val body = bounded(p.string("body"), 4000)
    return writeOutcome { cb ->
        discussions.create(currentBaseUrl(), subject, body, recipients, cb)
    }
}

internal fun VsnBridge.messagesSetRead(p: JSONObject): JSONObject {
    val id = bounded(p.string("id"), 64)
    val read = p.optBoolean("read", false)
    return writeOutcome { cb -> discussions.setRead(currentBaseUrl(), id, read, cb) }
}

internal fun VsnBridge.messagesDelete(p: JSONObject): JSONObject {
    val id = bounded(p.string("id"), 64)
    return writeOutcome { cb -> discussions.delete(currentBaseUrl(), id, cb) }
}

internal fun VsnBridge.writeOutcome(start: ((DiscussionWriteOutcome) -> Unit) -> Unit): JSONObject {
    val outcome = await<DiscussionWriteOutcome> { start(it) }
        ?: return JSONObject().put("ok", false).put("error", "Connexion indisponible.")
    sessionOrThrow(outcome.error)
    return JSONObject().put("ok", outcome.ok).apply {
        outcome.error?.let { put("error", it) }
    }
}

internal fun VsnBridge.messagesRecipients(): JSONObject {
    val result = await<Pair<List<DiscussionRecipient>, String?>> { cb ->
        discussions.fetchRecipients { list, error -> cb(list to error) }
    } ?: throw BridgeFailure("unavailable", "Destinataires indisponibles.")
    val (recipients, error) = result
    sessionOrThrow(error)
    val arr = JSONArray()
    for (r in recipients) {
        arr.put(
            JSONObject()
                .put("id", r.id)
                .put("displayName", r.displayName)
                .put("kind", r.kind),
        )
    }
    val obj = JSONObject()
        .put("payload", JSONObject().put("recipients", arr).toString())
    error?.let { obj.put("error", it) }
    return obj
}

