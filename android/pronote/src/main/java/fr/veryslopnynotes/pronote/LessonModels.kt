package fr.veryslopnynotes.pronote

import java.time.LocalDateTime

// Pièces jointes et cours (`dataClasses.js`).

/**
 * Pièce jointe (`type == 0` : lien (`url` sinon `name`) ; sinon URL magique AES
 * `FichiersExternes/<hex>/<nom>?Session=<h>`, `data()` la télécharge).
 */
class Attachment(private val client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
    val name: String = r(::strOf, listOf("L"), ResolveOpts.withDefault(""))
    val id: String = r(::strOf, listOf("N"))
    val type: Double = r(::numOf, listOf("G"))
    val url: String =
        if (type == 0.0) {
            r(::optStr, listOf("url"), ResolveOpts.lenient()) ?: name
        } else {
            // Double bourrage fidèle : manuel PUIS `aesEncrypt` (qui bourre à
            // son tour) — le serveur attend 48 octets, pas 32. Espaces retirés
            // (y compris dans `id`, comme `.replace(/ /g,"")` côté TS).
            val payload = Json.stringify(jobj("N" to JVal.Str(id), "Actif" to JVal.Bool(true))).replace(" ", "")
            val magic = client.communication.encryption
                .aesEncrypt(pkcs7Pad(payload.toByteArray(Charsets.UTF_8))).toHexLower()
            "${client.communication.rootSite}/FichiersExternes/$magic/${encodeURIComponent(name)}" +
                "?Session=${client.attributes["h"] ?: "undefined"}"
        }

    /** Octets bruts du fichier (requête réseau bloquante). */
    fun data(): ByteArray = client.communication.session.get(url).content
}

/** Contenu détaillé d'un cours (`_files` brut, `files()` l'habille). */
class LessonContent(private val client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
    val title: String? = r(::optStr, listOf("L"), ResolveOpts.lenient())
    val description: String? =
        r(::htmlParse, listOf("descriptif", "V"), ResolveOpts.lenient())
    val category: String? = r(::optStr, listOf("categorie", "V", "L"), ResolveOpts.lenient())
    private val filesJson: JVal? = r({ v -> v }, listOf("ListePieceJointe", "V"))

    fun files(): List<Attachment> = attachList(client, filesJson)
}

/**
 * Cours (`ListeContenus` : `16` = matière, `3` = profs, `17` = salles, `2` = groupes ;
 * `end` absent = repli `ListeHeuresFin` + modulo ; `content()` réseau, `null` si vide).
 */
class Lesson(private val client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
    val id: String = r(::strOf, listOf("N"))
    val canceled: Boolean = r(::boolOf, listOf("estAnnule"), ResolveOpts.withDefault(false))
    val status: String? = r(::optStr, listOf("Statut"), ResolveOpts.lenient())
    val memo: String? = r(::optStr, listOf("memo"), ResolveOpts.lenient())
    val backgroundColor: String? = r(::optStr, listOf("CouleurFond"), ResolveOpts.lenient())
    val outing: Boolean = r(::boolOf, listOf("estSortiePedagogique"), ResolveOpts.withDefault(false))
    val start: LocalDateTime = r(::datetimeParse, listOf("DateDuCours", "V"))
    val exempted: Boolean = r(::boolOf, listOf("dispenseEleve"), ResolveOpts.withDefault(false))
    val virtualClassrooms: List<String?> =
        r(::rawUrls, listOf("listeVisios", "V"), ResolveOpts.withDefault(listOf<String?>()))
    val num: Double = r(::numOf, listOf("P"), ResolveOpts.withDefault(0.0))
    val detention: Boolean = r(::boolOf, listOf("estRetenue"), ResolveOpts.withDefault(false))
    val test: Boolean =
        r(::boolOf, listOf("cahierDeTextes", "V", "estDevoir"), ResolveOpts.withDefault(false))
    val end: LocalDateTime =
        r<LocalDateTime?>(::datetimeParse, listOf("DateDuCoursFin", "V"), ResolveOpts.lenient())
            ?: run {
                val raw = (json as? JVal.Obj)?.fields
                val endTimes = hoursValue(client, "ListeHeuresFin")
                val size = (endTimes as? JVal.Arr)?.items?.size ?: 0
                // Absent = `NaN` (`undefined` en arithmétique) ; `null` présent = `0`
                // (`Number(null)`), comme côté TS.
                val place = raw?.get("place")?.let { numOf(it) } ?: Double.NaN
                val duree = raw?.get("duree")?.let { numOf(it) } ?: Double.NaN
                val endPlace = (place % (size - 1)) + duree - 1
                val (h, m) = place2time(endTimes, endPlace)
                start.withHour(h).withMinute(m).withSecond(0).withNano(0)
            }

    private val parts: LessonParts = run {
        val root = json as? JVal.Obj
            ?: throw ParsingError("Détails du cours manquants", listOf("ListeContenus", "V"))
        if (!root.fields.containsKey("ListeContenus")) {
            throw ParsingError("Détails du cours manquants", listOf("ListeContenus", "V"))
        }
        val items = ((root.fields["ListeContenus"] as? JVal.Obj)?.fields?.get("V") as? JVal.Arr)?.items
            ?: throw ParsingError("Détails du cours manquants", listOf("ListeContenus", "V"))
        var subj: Subject? = null
        val teachers = mutableListOf<String?>()
        val rooms = mutableListOf<String?>()
        val groups = mutableListOf<String?>()
        for (d in items) {
            val o = d as? JVal.Obj ?: continue
            if (!o.fields.containsKey("G")) continue
            when ((o.fields["G"] as? JVal.Num)?.value) {
                16.0 -> subj = Subject(d)
                3.0 -> teachers.add(rawLeaf(o.fields["L"]))
                17.0 -> rooms.add(rawLeaf(o.fields["L"]))
                2.0 -> groups.add(rawLeaf(o.fields["L"]))
            }
        }
        LessonParts(subj, teachers, rooms, groups)
    }

    val subject: Subject? = parts.subject
    val teacherNames: List<String?> = parts.teachers
    val classrooms: List<String?> = parts.rooms
    val groupNames: List<String?> = parts.groups
    // `join` : `undefined`/`null` = chaine vide (jamais `"null"`), tableau vide = `null`.
    private fun namesOf(names: List<String?>): String? =
        if (names.isNotEmpty()) names.joinToString(", ") { it ?: "" } else null
    val teacherName: String? = namesOf(teacherNames)
    val classroom: String? = namesOf(classrooms)
    val groupName: String? = namesOf(groupNames)

    private var contentCache: LessonContent? = null

    /** Ni retenue ni sortie : un cours « normal ». */
    val normal: Boolean get() = !detention && !outing

    /** Contenu détaillé (requête `PageCahierDeTexte`, `null` si absent ; mis en cache). */
    fun content(): LessonContent? {
        contentCache?.let { return it }
        val week = client.getWeek(start)
        val resp = client.post(
            "PageCahierDeTexte", 89.0,
            mapOf("domaine" to jobj("_T" to JVal.Num(8.0), "V" to JVal.Str("[$week..$week]"))),
        )
        var contents: JVal? = null
        for (lesson in dataList(resp, "ListeCahierDeTextes")) {
            // Accès directs : intermédiaire absent = jeté ; `N` comparé brut
            // (non-texte ne matche jamais, comme `===` côté TS).
            val o = lesson as JVal.Obj
            val coursN = (((o.fields["cours"] as JVal.Obj).fields["V"] as JVal.Obj).fields["N"] as? JVal.Str)?.value
            // COURT-CIRCUIT comme la référence : `listeContenus` n'est lu QUE pour
            // le cours demandé. Avant, une entrée SANS `listeContenus` (un cours
            // d'un autre jour) jetait et PERDAIT tout le bloc « Contenu de cours ».
            if (coursN != id) continue
            val list = ((o.fields["listeContenus"] as JVal.Obj).fields["V"] as JVal.Arr).items
            if (list.isNotEmpty()) {
                contents = list[0]
                break
            }
        }
        if (contents == null) return null
        val c = LessonContent(client, contents)
        contentCache = c
        return c
    }

    private data class LessonParts(
        val subject: Subject?,
        val teachers: List<String?>,
        val rooms: List<String?>,
        val groups: List<String?>,
    )
}
