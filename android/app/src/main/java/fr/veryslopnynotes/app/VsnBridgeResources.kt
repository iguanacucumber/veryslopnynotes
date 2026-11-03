package fr.veryslopnynotes.app

import fr.veryslopnynotes.core.AssignmentAttachment
import fr.veryslopnynotes.core.Capabilities
import fr.veryslopnynotes.core.CapabilitiesJson
import fr.veryslopnynotes.core.DiscussionRecipient
import fr.veryslopnynotes.core.MessagePaging
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.DiscussionWriteOutcome
import fr.veryslopnynotes.data.RefreshFailureCause
import fr.veryslopnynotes.data.RefreshOutcome
import org.json.JSONArray
import org.json.JSONObject
import fr.veryslopnynotes.data.SessionEpoch

internal fun VsnBridge.resourceCached(p: JSONObject, epoch: Long): JSONObject {
    // Session changée depuis l'ARRIVÉE de l'appel (déconnexion, session morte,
    // bascule de compte) : l'entrée pourrait être celle d'un AUTRE compte.
    if (SessionEpoch.current() != epoch) return emptyCached()
    val key = p.string("key")
    val resource = cacheKey(key) ?: return emptyCached()
    // Le cache est indexé par (ressource, requête) : l'entrée servie est celle
    // de la requête AFFICHÉE, pas celle d'une autre semaine.
    val query = bounded(p.string("query"), 200)
    val entry = repo.cached(resource, query) ?: return emptyCached()
    return JSONObject()
        .put("payload", entry.payload)
        .put("fetchedAt", entry.fetchedAt)
        .put("stale", repo.isStale(resource, entry))
        .put("partial", payloadPartial(entry.payload))
        .put("error", JSONObject.NULL)
        .put("cause", JSONObject.NULL)
}

internal fun VsnBridge.emptyCached(error: String? = null, cause: RefreshFailureCause? = null): JSONObject = JSONObject()
    .put("payload", JSONObject.NULL)
    .put("fetchedAt", 0L)
    .put("stale", false)
    .put("partial", false)
    .put("error", error ?: JSONObject.NULL)
    .put("cause", cause?.wire ?: JSONObject.NULL)

/**
 * Échéance d'une lecture dépassée : le cache de la MÊME requête est rendu,
 * marqué périmé, avec la cause. L'écran garde ses données au lieu de tomber
 * sur une promesse rejetée, et le travail réseau a déjà été annulé.
 */
internal fun VsnBridge.deadlineOutcome(resource: String?, query: String, message: String): JSONObject {
    if (resource == null) {
        return emptyCached(message, RefreshFailureCause.NETWORK).put("stale", true)
    }
    val cached = repo.cached(resource, query)
    return resultJson(
        RefreshOutcome.Failed(message, cached?.payload, RefreshFailureCause.NETWORK),
        resource,
        query,
    )
}

/** Le drapeau vit DANS le payload ; le pont le remonte pour que l'écran le voie. */
internal fun payloadPartial(payload: String?): Boolean {
    if (payload.isNullOrBlank()) return false
    return try {
        JSONObject(payload).optBoolean("partial", false)
    } catch (_: Exception) {
        false
    }
}

internal fun VsnBridge.resourceLoad(p: JSONObject): JSONObject {
    val key = p.string("key")
    val deadline = BridgeTimeouts.resourceDeadlineMs(key)
    if (key == "profile") {
        return try {
            profileMe(deadline)
                .put("fetchedAt", System.currentTimeMillis())
                .put("stale", false)
        } catch (e: BridgeFailure) {
            // Un profil est une lecture réseau : l'échéance rend un résultat
            // typé vide, jamais une promesse sans données.
            if (e.code != "unavailable") throw e
            emptyCached(e.message, RefreshFailureCause.NETWORK).put("stale", true)
        }
    }
    if (key == "periods") {
        val outcome = await<RefreshOutcome>(deadline) { cb ->
            repo.fetchPeriods(currentBaseUrl(), cb)
        } ?: return deadlineOutcome(null, "", "Délai dépassé : tranches indisponibles.")
        return resultJson(outcome, null)
    }
    val resource = cacheKey(key) ?: throw BridgeFailure("bad_request", "Ressource inconnue.")
    val query = bounded(p.string("query"), 200)
    val outcome = await<RefreshOutcome>(deadline) { cb ->
        repo.refreshAsync(resource, currentBaseUrl(), query, p.optBoolean("force", false), cb)
    } ?: return deadlineOutcome(resource, query, "Délai dépassé : lecture partielle.")
    return resultJson(outcome, resource, query)
}

internal fun VsnBridge.resourceInvalidate(p: JSONObject): JSONObject {
    val resource = cacheKey(p.string("key"))
        ?: throw BridgeFailure("bad_request", "Ressource inconnue.")
    repo.invalidate(resource)
    return JSONObject().put("ok", true)
}

internal fun VsnBridge.resourceSync(): JSONObject {
    val outcome = await<RefreshOutcome>(BridgeTimeouts.resourceDeadlineMs("sync")) { cb ->
        repo.requestSyncRefresh(currentBaseUrl(), accounts.current().orEmpty(), cb)
    } ?: return deadlineOutcome(null, "", "Délai dépassé : relecture indisponible.")
    return resultJson(outcome, null)
}

internal fun VsnBridge.resultJson(outcome: RefreshOutcome, resource: String?, query: String = ""): JSONObject {
    val obj = JSONObject()
    when (outcome) {
        is RefreshOutcome.Updated -> obj
            .put("payload", outcome.payload)
            .put("fetchedAt", outcome.fetchedAt)
            .put("stale", false)
            .put("partial", payloadPartial(outcome.payload))
            .put("error", JSONObject.NULL)
            .put("cause", JSONObject.NULL)
        is RefreshOutcome.OfflineFallback -> obj
            .put("payload", outcome.payload)
            .put("fetchedAt", outcome.fetchedAt)
            .put("stale", outcome.stale)
            .put("partial", payloadPartial(outcome.payload))
            // L'âge et la cause disent l'état ; « hors ligne » n'est pas
            // affirmé ici, car le natif ne connaît pas le réseau de l'appareil.
            .put("error", "Données en cache.")
            .put("cause", outcome.cause.wire)
        is RefreshOutcome.Failed -> {
            sessionOrThrow(outcome.message)
            // L'entrée de cache servie est celle de la MÊME requête.
            val cached = resource?.let { repo.cached(it, query) }
            val payload = outcome.cachedPayload
            obj.put("payload", payload ?: JSONObject.NULL)
                .put("fetchedAt", cached?.fetchedAt ?: 0L)
                .put("stale", true)
                .put("partial", payloadPartial(payload))
                .put("error", outcome.message)
                .put("cause", outcome.cause.wire)
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

/**
 * Corps d'une actualité lu À LA DEMANDE (la liste ne télécharge plus 21 corps
 * pour 2-3 actus lues). Le corps est une DONNÉE, jamais du HTML (I6).
 */
internal fun VsnBridge.newsItem(p: JSONObject): JSONObject {
    val id = bounded(p.string("id"), 64)
    if (id.isEmpty()) throw BridgeFailure("bad_request", "Actualité introuvable.")
    val result = await<Pair<String?, String?>> { cb ->
        repo.fetchNewsBody(id) { body, error -> cb(body to error) }
    } ?: throw BridgeFailure("unavailable", "Actualité indisponible.")
    val (body, error) = result
    sessionOrThrow(error)
    // Un échec de lecture = un REJET borné, jamais une page d'erreur.
    if (error != null) throw BridgeFailure("unavailable", error)
    return JSONObject().put("body", body ?: "")
}

internal fun VsnBridge.toggleAssignment(p: JSONObject): JSONObject {
    val id = bounded(p.string("id"), 128)
    if (id.isEmpty()) throw BridgeFailure("bad_request", "Devoir introuvable.")
    val done = p.optBoolean("done", false)
    // La semaine AFFICHÉE : la fenêtre de recherche suit le payload affiché,
    // sinon le devoir est visible mais « introuvable ».
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
    // Même semaine affichée que le toggle.
    val week = bounded(p.string("weekStart"), 10)
    // L'époque est capturée AVANT le téléchargement : une pièce jointe
    // téléchargée pendant une déconnexion n'est pas écrite.
    val epoch = SessionEpoch.current()
    val outcome = await<fr.veryslopnynotes.data.AttachmentOutcome> { cb ->
        assignments.fetchAttachment(homeworkId, attachmentId, week, cb)
    } ?: throw BridgeFailure("unavailable", "Pièce jointe indisponible.")
    // Session morte = re-pair, jamais « pièce jointe indisponible ».
    sessionOrThrow(outcome.error)
    val data = outcome.data
        ?: return JSONObject().put("ok", false).put("error", outcome.error ?: "Pièce jointe indisponible.")
    return try {
        val file = writeAttachmentFile(
            ctx,
            homeworkId,
            AssignmentAttachment(id = attachmentId, label = data.name, ref = ""),
            data,
            epoch,
        ) ?: return JSONObject().put("ok", false).put("error", "Pièce jointe indisponible.")
        val viewerError = openFile(file, mimeOf(data.name))
        if (viewerError == null) {
            JSONObject().put("ok", true)
        } else {
            JSONObject().put("ok", false).put("error", viewerError)
        }
    } catch (_: Exception) {
        JSONObject().put("ok", false).put("error", "Pièce jointe illisible.")
    }
}

internal fun VsnBridge.messagesList(): JSONObject {
    val outcome = await<RefreshOutcome> { cb ->
        repo.refreshAsync(CachePolicy.DISCUSSIONS, currentBaseUrl(), force = false, cb = cb)
    } ?: throw BridgeFailure("unavailable", "Messagerie indisponible.")
    val obj = JSONObject()
    when (outcome) {
        is RefreshOutcome.Updated -> obj.put("payload", outcome.payload)
            .put("fetchedAt", outcome.fetchedAt)
            .put("stale", false)
        is RefreshOutcome.OfflineFallback -> obj.put("payload", outcome.payload)
            .put("fetchedAt", outcome.fetchedAt)
            .put("stale", true)
            .put("cause", outcome.cause.wire)
        is RefreshOutcome.Failed -> {
            sessionOrThrow(outcome.message)
            // Aucun cache de la MÊME requête : l'échec est un échec, jamais un
            // succès avec zéro fil (I14).
            val cached = outcome.cachedPayload ?: throw BridgeFailure("unavailable", outcome.message)
            obj.put("payload", cached)
                .put("error", outcome.message)
                .put("fetchedAt", repo.cached(CachePolicy.DISCUSSIONS, "")?.fetchedAt ?: 0L)
                .put("stale", true)
                .put("cause", outcome.cause.wire)
        }
    }
    return obj
}

internal fun VsnBridge.messagesThread(p: JSONObject): JSONObject {
    val id = bounded(p.string("id"), 64)
    if (id.isEmpty()) throw BridgeFailure("bad_request", "Fil introuvable.")
    val before = if (p.has("before") && !p.isNull("before")) {
        p.optInt("before", 0).coerceIn(0, 1_000_000)
    } else {
        null
    }
    val result = await<Pair<fr.veryslopnynotes.data.DiscussionThread?, String?>> { cb ->
        discussions.fetchMessages(id, before) { thread, error -> cb(thread to error) }
    } ?: throw BridgeFailure("unavailable", "Fil indisponible.")
    val (thread, error) = result
    sessionOrThrow(error)
    // Un fil non lu (échec ou réponse vide) est une ERREUR, pas un fil vide.
    if (error != null) throw BridgeFailure("unavailable", error)
    if (thread == null) throw BridgeFailure("unavailable", "Fil indisponible.")
    val arr = JSONArray()
    for (m in thread.messages) {
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
        // Les participants voyagent avec la PREMIÈRE page du fil ouvert.
        .put(
            "payload",
            JSONObject()
                .put("messages", arr)
                .put("participants", JSONArray(thread.participants))
                .put("total", thread.total)
                .put("start", thread.start)
                .put("hasMore", thread.hasMore)
                .toString(),
        )
    return obj
}

internal fun VsnBridge.messagesEnrich(p: JSONObject): JSONObject {
    val ids = p.optJSONArray("ids") ?: JSONArray()
    if (ids.length() > MessagePaging.MAX_VISIBLE_ENRICH) {
        throw BridgeFailure("bad_request", "Trop de fils visibles.")
    }
    val wanted = mutableListOf<String>()
    for (i in 0 until ids.length()) {
        val id = bounded(ids.optString(i, ""), 64)
        if (id.isNotEmpty()) wanted.add(id)
    }
    if (wanted.isEmpty()) return JSONObject().put("payload", JSONObject().put("discussions", JSONArray()).toString())
    val result = await<Pair<String?, String?>> { cb ->
        discussions.fetchEnrichment(wanted) { payload, error -> cb(payload to error) }
    } ?: throw BridgeFailure("unavailable", "Fils indisponibles.")
    val (payload, error) = result
    sessionOrThrow(error)
    if (error != null) throw BridgeFailure("unavailable", error)
    if (payload == null) throw BridgeFailure("unavailable", "Fils indisponibles.")
    return JSONObject().put("payload", payload)
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

