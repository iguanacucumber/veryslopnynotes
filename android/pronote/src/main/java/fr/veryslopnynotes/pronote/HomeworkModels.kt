package fr.veryslopnynotes.pronote

import java.time.LocalDateTime

/** `done` requis ; `setDone` poste `SaisieTAFFaitEleve`. */
class Homework(private val client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
    val id: String = r(::strOf, listOf("N"))
    val description: String = r(::htmlParse, listOf("descriptif", "V"))
    // Setter JVM renommé : `setDone(Boolean)` est la méthode réseau (côté TS,
    // propriété et méthode coexistent).
    @set:JvmName("updateDone")
    var done: Boolean = r(::boolOf, listOf("TAFFait"))
    val subject: Subject = r({ v -> Subject(v) }, listOf("Matiere", "V"))
    val date: LocalDateTime = r(::dateParse, listOf("PourLe", "V"))
    val backgroundColor: String = r(::strOf, listOf("CouleurFond"))
    private val filesJson: JVal? = r({ v -> v }, listOf("ListePieceJointe", "V"))

    fun files(): List<Attachment> = attachList(client, filesJson)

    /** Bascule fait/non-fait (réseau, état local mis à jour après). */
    fun setDone(status: Boolean) {
        client.post(
            "SaisieTAFFaitEleve", 88.0,
            mapOf("listeTAF" to JVal.Arr(listOf(jobj("N" to JVal.Str(id), "TAFFait" to JVal.Bool(status))))),
        )
        done = status
    }
}

/**
 * Corps et pièces jointes d'une actualité, en 1 POST `PageActualites` : le corps
 * se charge à la demande, au dépliage (la liste ne télécharge plus les corps).
 */
internal fun informationQuestions(client: PronoteClientLike, infoId: String): List<JVal> {
    // `N` brut (info.id) : absent = cle omise, comme `undefined` cote TS.
    val public = LinkedHashMap<String, JVal>()
    client.infoId?.let { public["N"] = JVal.Str(it) }
    public["G"] = JVal.Num(4.0)
    val resp = client.post(
        "PageActualites", 8.0,
        mapOf(
            "actualite" to jobj(
                "N" to JVal.Str(infoId),
                "genrePublic" to JVal.Num(4.0),
                "public" to JVal.Obj(public),
            ),
            "genreRequeteActualite" to JVal.Num(1.0),
            "modeAffActu" to JVal.Num(0.0),
        ),
    )
    // Acces directs : absent = jete (comme `.x` sur `undefined` cote TS).
    val data = dataOf(resp)
    return (((data.fields["detailsActualite"] as JVal.Obj).fields["listeQuestions"] as JVal.Obj).fields["V"] as JVal.Arr).items
}

/** Corps : texte du PREMIER texte, dés-HTML-isé (une DONNÉE non fiable). */
internal fun informationBodyText(questions: List<JVal>): String {
    val texte = (((questions.firstOrNull() as? JVal.Obj)?.fields?.get("texte") as? JVal.Obj)?.fields?.get("V"))
        ?: throw ParsingError("Texte d'info manquant", listOf("texte", "V"))
    return htmlParse(texte)
}

class Information(private val client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
    val id: String = r(::strOf, listOf("N"))
    val title: String? = r(::optStr, listOf("L"), ResolveOpts.lenient())
    val author: String = r(::strOf, listOf("auteur"))
    var read: Boolean = r(::boolOf, listOf("lue"))
    val creationDate: LocalDateTime = r(::datetimeParse, listOf("dateCreation", "V"))
    val startDate: LocalDateTime? =
        r(::datetimeParse, listOf("dateDebut", "V"), ResolveOpts.lenient())
    val endDate: LocalDateTime? =
        r(::datetimeParse, listOf("dateFin", "V"), ResolveOpts.lenient())
    val category: String = r(::strOf, listOf("nature", "V", "L"))
    val survey: Boolean = r(::boolOf, listOf("estSondage"))
    val template: Boolean = r(::boolOf, listOf("estModele"), ResolveOpts.withDefault(false))
    val sharedTemplate: Boolean = r(::boolOf, listOf("estModelePartage"), ResolveOpts.withDefault(false))
    val anonymousResponse: Boolean = r(::boolOf, listOf("reponseAnonyme"))

    private var rawContent: List<JVal>? = null
    private var contentCache: String? = null
    private var attachmentsCache: List<Attachment>? = null

    fun content(): String {
        fetchContent()
        val rc = rawContent ?: return ""
        if (contentCache == null) {
            contentCache = informationBodyText(rc)
        }
        return contentCache ?: ""
    }

    fun attachments(): List<Attachment> {
        attachmentsCache?.let { return it }
        fetchContent()
        val out = mutableListOf<Attachment>()
        for (q in rawContent ?: emptyList()) {
            val files = (((q as? JVal.Obj)?.fields?.get("listePiecesJointes") as? JVal.Obj)?.fields?.get("V") as? JVal.Arr)
                ?.items ?: throw ParsingError("Pièces jointes d'info manquantes", listOf("listePiecesJointes", "V"))
            for (j in files) out.add(Attachment(client, j))
        }
        attachmentsCache = out
        return out
    }

    private fun fetchContent() {
        if (rawContent != null) return
        rawContent = informationQuestions(client, id)
    }
}
