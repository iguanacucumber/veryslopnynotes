package fr.veryslopnynotes.pronote

import java.time.LocalDateTime

// Devoirs et actualités (`dataClasses.js`).

/** Devoir (`done` requis ; `setDone` poste `SaisieTAFFaitEleve` 88 puis met à jour). */
class Homework(private val client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
    val id: String = r(::strOf, listOf("N"))
    val description: String = r(::htmlParse, listOf("descriptif", "V"))
    // Le setter JVM est renommé : `setDone(Boolean)` est la méthode réseau
    // (comme côté TS où propriété et méthode coexistent).
    @set:JvmName("updateDone")
    var done: Boolean = r(::boolOf, listOf("TAFFait"))
    val subject: Subject = r({ v -> Subject(v) }, listOf("Matiere", "V"))
    val date: LocalDateTime = r(::dateParse, listOf("PourLe", "V"))
    val backgroundColor: String = r(::strOf, listOf("CouleurFond"))
    private val filesJson: JVal? = r({ v -> v }, listOf("ListePieceJointe", "V"))

    fun files(): List<Attachment> = attachList(client, filesJson)

    /** Bascule fait/non-fait (requête réseau bloquante, état local mis à jour après). */
    fun setDone(status: Boolean) {
        client.post(
            "SaisieTAFFaitEleve", 88.0,
            mapOf("listeTAF" to JVal.Arr(listOf(jobj("N" to JVal.Str(id), "TAFFait" to JVal.Bool(status))))),
        )
        done = status
    }
}

/**
 * Questions d'une actualité : 1 POST `PageActualites` — le CORPS (texte) et
 * les pièces jointes.
 *
 * Facteur commun de `Information` et de `Client.informationContent(id)` : la
 * liste des actus ne télécharge plus les corps (#475), le corps se charge à
 * la demande, au dépliage.
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

/** Corps d'une actualité : texte du PREMIER texte, dés-HTML-isé (une DONNÉE). */
internal fun informationBodyText(questions: List<JVal>): String {
    val texte = (((questions.firstOrNull() as? JVal.Obj)?.fields?.get("texte") as? JVal.Obj)?.fields?.get("V"))
        ?: throw ParsingError("Texte d'info manquant", listOf("texte", "V"))
    return htmlParse(texte)
}

/** Info (`fetchContent` poste `PageActualites` 8 ; `content()` dés-HTML-ise, `""` si vide). */
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

    /** Texte dés-HTML-isé de la première question (requête réseau bloquante, mise en cache). */
    fun content(): String {
        fetchContent()
        val rc = rawContent ?: return ""
        if (contentCache == null) {
            contentCache = informationBodyText(rc)
        }
        return contentCache ?: ""
    }

    /** Pièces jointes de toutes les questions (requête réseau bloquante, mises en cache). */
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
