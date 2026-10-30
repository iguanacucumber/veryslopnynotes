package fr.veryslopnynotes.pronote

import java.time.LocalDateTime

// Messagerie : destinataire, message et discussion (`dataClasses.js`).

/**
 * Destinataire (`type` = `teacher` si `G == 3` sinon `staff` ; `functions` =
 * `listeRessources` ou `[fonction.V.L]` ; `_type` = discriminant brut).
 */
class Recipient(_client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
    val _type: Double = r(::numOf, listOf("G"))
    val id: String = r(::strOf, listOf("N"))
    val name: String = r(::strOf, listOf("L"))
    val type: String = if (_type == 3.0) "teacher" else "staff"
    val email: String? = r(::optStr, listOf("email"), ResolveOpts.lenient())
    val functions: List<String?> =
        if (type == "teacher") r(::rawList, listOf("listeRessources", "V"))
        else r({ v -> listOf(rawLeaf(v)) }, listOf("fonction", "V", "L"), ResolveOpts.withDefault(listOf<String?>()))
    val withDiscussion: Boolean = r(::boolOf, listOf("avecDiscussion"), ResolveOpts.withDefault(false))
}

/**
 * Message (`author` = `null` si `emetteur`, sinon `public_gauche` ; `contenu`
 * dés-HTML-isé ssi `estHTML` ; `date` = alias obsolète de `created`).
 */
class Message(private val client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
    private val possession: String = r(::strOf, listOf("possessionMessage", "V", "N"))
    val id: String = r(::strOf, listOf("N"))
    val author: String? = run {
        val emitter = r(::boolOf, listOf("emetteur"), ResolveOpts.withDefault(false))
        if (emitter) null else r(::strOf, listOf("public_gauche"))
    }
    val seen: Boolean = r(::boolOf, listOf("lu"), ResolveOpts.withDefault(false))
    val created: LocalDateTime = r(::datetimeParse, listOf("date", "V"))
    val date: LocalDateTime = created
    val content: String = run {
        val isHtml = boolOf((json as? JVal.Obj)?.fields?.get("estHTML"))
        if (isHtml) r(::htmlParse, listOf("contenu", "V"))
        else r(::strOf, listOf("contenu"))
    }
    var replyingTo: Message? = null

    /** Destinataires (`SaisiePublicMessage` 131 ; réseau bloquant). */
    fun recipients(): List<String?> {
        val resp = client.post("SaisiePublicMessage", 131.0, mapOf("message" to jobj("N" to JVal.Str(id))))
        return dataList(resp, "listeDest").map { rawLeaf((it as? JVal.Obj)?.fields?.get("L")) }
    }

    /** Réponse au message (`DiscussionClosed` si les boutons sont vides ; réseau bloquant). */
    fun reply(message: String) {
        val resp = client.post(
            "ListeMessages", 131.0,
            mapOf(
                "listePossessionsMessages" to JVal.Arr(listOf(jobj("N" to JVal.Str(possession)))),
                "message" to jobj("N" to JVal.Str(id)),
            ),
        )
        val data = dataOf(resp)
        // `?.V ?? []` : boutons absents = discussion fermee (pas d'erreur).
        val buttons = (((data.fields["listeBoutons"] as? JVal.Obj)?.fields?.get("V") as? JVal.Arr)?.items) ?: emptyList()
        if (buttons.isEmpty()) throw DiscussionClosed("Cannot reply to discussion")
        // `.V` absent = cle omise (comme `undefined` droppe) ; intermediaire absent = jete.
        val payload = LinkedHashMap<String, JVal>()
        ((data.fields["messagePourReponse"] as JVal.Obj).fields["V"])?.let { payload["messagePourReponse"] = it }
        payload["contenu"] = JVal.Str(message)
        payload["listeFichiers"] = JVal.Arr(emptyList())
        buttons.getOrNull(0)?.let { payload["bouton"] = it }
        client.post("SaisieMessage", 131.0, payload)
    }
}

/**
 * Discussion (`labels` : chaque `listeEtiquettes.V[i].N` traverse le dict
 * `callerLabels` puis `{4: Drafts, 5: Trash}`, `null` si inconnu ; `close` =
 * alias obsolète de `closed`, `replyable` toujours `true`).
 */
class Discussion(private val client: PronoteClientLike, json: JVal?, callerLabels: Map<String, String>) :
    PronoteObject(json) {
    companion object {
        // Clés TEXTUELLES (`labelsStr[G]` : `String(G)` côté JS).
        private val LABEL_NAMES = mapOf("4" to "Drafts", "5" to "Trash")
    }

    private val possessions: JVal? = r({ v -> v }, listOf("listePossessionsMessages", "V"))
    val id: String = r(::optStr, listOf("N"), ResolveOpts.lenient()) ?: ""
    val subject: String = r(::strOf, listOf("objet"))
    val creator: String? = r(::optStr, listOf("initiateur"), ResolveOpts.lenient())
    private val participantsMessageId: String = r(::strOf, listOf("messagePourParticipants", "V", "N"))
    val unread: Double = r(::numOf, listOf("nbNonLus"), ResolveOpts.withDefault(0.0))
    val closed: Boolean = r(::boolOf, listOf("ferme"), ResolveOpts.withDefault(false))
    val close: Boolean = closed
    val labels: List<String?> =
        r({ v ->
            val items = (v as? JVal.Arr)?.items ?: throw IllegalStateException("étiquettes attendues")
            items.map { item ->
                val key = jsKeyOf((item as? JVal.Obj)?.fields?.get("N"))
                callerLabels[key]?.let { LABEL_NAMES[it] }
            }
        }, listOf("listeEtiquettes", "V"), ResolveOpts.withDefault(listOf<String?>()))
    val replyable: Boolean = true

    private var dateCache: LocalDateTime? = null

    /** Participants (`SaisiePublicMessage` 131 ; réseau bloquant). */
    fun participants(): List<String?> {
        val resp = client.post(
            "SaisiePublicMessage", 131.0,
            mapOf(
                "estDestinatairesReponse" to JVal.Bool(false),
                "estPublicParticipant" to JVal.Bool(true),
                "message" to jobj("N" to JVal.Str(participantsMessageId)),
            ),
        )
        return dataList(resp, "listeDest").map { rawLeaf((it as? JVal.Obj)?.fields?.get("L")) }
    }

    /**
     * Messages chaînés (`replyingTo` en deux passes, triés par `created` ;
     * `messageSource` absent = `null`, là où le TS jetterait).
     */
    fun messages(): List<Message> {
        val resp = client.post(
            "ListeMessages", 131.0,
            mapOf("listePossessionsMessages" to (possessions ?: JVal.Null)),
        )
        val byId = LinkedHashMap<String, Message>()
        val raws = dataList(resp, "listeMessages")
        for (m in raws) {
            val msg = Message(client, m)
            byId[msg.id] = msg
        }
        for (m in raws) {
            // `messages.get(N)` : N absent = jete (assignation sur `undefined`).
            // `messageSource(.V)` absent = jete ; `N` terminal absent = `null`.
            val o = m as JVal.Obj
            val target = byId[(o.fields["N"] as? JVal.Str)?.value]
                ?: throw IllegalStateException("message sans N")
            val src = (((o.fields["messageSource"] as JVal.Obj).fields["V"] as JVal.Obj).fields["N"] as? JVal.Str)?.value
            target.replyingTo = src?.let { byId[it] }
        }
        return byId.values.sortedBy { it.created }
    }

    /** Date d'ouverture (alias du premier message ; mise en cache ; réseau bloquant). */
    fun date(): LocalDateTime {
        dateCache?.let { return it }
        val d = messages().first().date
        dateCache = d
        return d
    }

    /** Marque lu/non-lu (`SaisieMessage` 131 `pourLu` ; réseau bloquant). */
    fun markAs(read: Boolean) {
        client.post(
            "SaisieMessage", 131.0,
            mapOf(
                "commande" to JVal.Str("pourLu"),
                "lu" to JVal.Bool(read),
                "listePossessionsMessages" to (possessions ?: JVal.Null),
            ),
        )
    }

    /** Réponse (`DiscussionClosed` si `closed` ; réseau bloquant). */
    fun reply(message: String) {
        if (closed) throw DiscussionClosed("Cannot reply to discussion")
        val resp = client.post(
            "ListeMessages", 131.0,
            mapOf("listePossessionsMessages" to (possessions ?: JVal.Null)),
        )
        val data = dataOf(resp)
        // Intermediaires absents = jetes (comme `.V` sur `undefined` cote TS).
        val buttons = (((data.fields["listeBoutons"] as JVal.Obj).fields["V"] as? JVal.Arr)?.items)
            ?: throw ParsingError("Boutons manquants", listOf("listeBoutons", "V"))
        val payload = LinkedHashMap<String, JVal>()
        (((data.fields["messagePourReponse"] as JVal.Obj).fields["V"]))?.let { payload["messagePourReponse"] = it }
        payload["contenu"] = JVal.Str(message)
        payload["listeFichiers"] = JVal.Arr(emptyList())
        buttons.getOrNull(0)?.let { payload["bouton"] = it }
        client.post("SaisieMessage", 131.0, payload)
    }

    /** Corbeille (`SaisieMessage` 131 `corbeille` ; réseau bloquant). */
    fun delete() {
        client.post(
            "SaisieMessage", 131.0,
            mapOf(
                "commande" to JVal.Str("corbeille"),
                "listePossessionsMessages" to (possessions ?: JVal.Null),
            ),
        )
    }
}
