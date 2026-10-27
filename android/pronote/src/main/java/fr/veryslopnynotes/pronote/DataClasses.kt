package fr.veryslopnynotes.pronote

import java.time.LocalDateTime
import kotlin.math.floor

/**
 * Objets métier PRONOTE (port fidèle de `pronotets` `dataClasses.js`).
 *
 * Zéro dépendance (stdlib Kotlin + `java.time`) ; seules les méthodes listées
 * font du réseau (bloquant, sans coroutines). Dates = `LocalDateTime` mural.
 *
 * Non porté (uniligne chacun) :
 * - `ParentClient`/`VieScolaireClient` : appartiennent à `client.js`, pas aux données.
 * - `Student` : fiche élève (`FicheEleve`) encore servie par `client.js`, pas ici.
 * - `StudentClass` : seul son `students()` lisait `client.periods`, absent de `ClientLike`.
 * - `Identity` : grappe d'état-civil lue via `Student.ficheEleve`, non porté.
 * - `Guardian` : enveloppe de `Identity`, non porté.
 * - `TeachingStaff`/`TeachingSubject` : annuaire des profs (`ListeRessources`), non porté.
 * - `Report`/`ReportSubject` : bulletins (`PageBulletins`), non porté.
 * - `Evaluation`/`Acquisition` : évaluations par compétences (`DernieresEvaluations`), non porté.
 * - `Attachment.save` : écriture disque Node-only, sans objet sur Android.
 * - `Information.markAsRead` : accusé de lecture (`SaisieActualites`), non porté.
 * - `Period.report`/`evaluations`/`classOverallAverage` : dépendent des classes non portées.
 * - `ClientInfo.address`/`email`/`phone`/`ineNumber` : données perso (`PageInfosPerso`), non portées.
 * - `toDict` : sérialisation générique sans lecteur côté Android.
 * - `Util.get` : filtre générique sans lecteur côté Android.
 */

// ---------------------------------------------------------------------------
// Aides privées (miroirs locaux des idiomes `resolver.js`/`dataClasses.js).
// ---------------------------------------------------------------------------

/** Construit un objet `JVal` (clés dans l'ordre d'insertion). */
private fun jobj(vararg ps: Pair<String, JVal>): JVal.Obj =
    JVal.Obj(LinkedHashMap<String, JVal>().also { m -> ps.forEach { m[it.first] = it.second } })

/**
 * `String(v)` sur chemin optionnel : absent (`lenient`) → `null` (le convertisseur
 * ne voit jamais `null` Kotlin) ; `null` PRÉSENT → `"null"`, comme `String(null)`
 * côté TS (le serveur omet, il ne `null`-ifie jamais — la parité l'exige quand même).
 */
private fun optStr(v: JVal?): String? = strOf(v)

/** `Number(v)` nullable : chemin absent → `null`, `null` présent → `0` (comme `Number(null)`). */
private fun optNum(v: JVal?): Double? = v?.let { numOf(it) }

/** `(l) => l.map((i) => i.L)` : `V` doit être un tableau (jeté → `ParsingError` via `r()`). */
/**
 * Feuille brute (`.L`, `.url`, ...) : absente/`null` -> `null`, texte tel quel,
 * le reste stringifie. Le serveur envoie du texte (ou rien).
 */
private fun rawLeaf(v: JVal?): String? = when (v) {
    null, is JVal.Null -> null
    is JVal.Str -> v.value
    else -> strOf(v)
}

/**
 * `(l) => l.map((i) => i.L)` : elements BRUTS (`null` garde, comme
 * `undefined`/`null` cote TS — `JSON` les rend `null` des deux cotes).
 */
private fun rawList(v: JVal?): List<String?> {
    val items = (v as? JVal.Arr)?.items ?: throw IllegalStateException("liste attendue")
    return items.map { rawLeaf((it as? JVal.Obj)?.fields?.get("L")) }
}

/** Direct brut (`json.N`, `.L`) : absent = `undefined` (rendu omis par le pilote). */
private fun rawStrOrNull(v: JVal?): String? =
    v?.let { if (it is JVal.Null) "null" else strOf(it) }

/** `(l) => l.map((i) => i.url)` : meme regle, cle `url`. */
private fun rawUrls(v: JVal?): List<String?> {
    val items = (v as? JVal.Arr)?.items ?: throw IllegalStateException("liste attendue")
    return items.map { rawLeaf((it as? JVal.Obj)?.fields?.get("url")) }
}

/** `(x) => x.map((a) => new Attachment(...))` sur un `V` tableau. */
private fun attachList(client: PronoteClientLike, v: JVal?): List<Attachment> {
    val items = (v as? JVal.Arr)?.items ?: throw IllegalStateException("liste de pièces jointes attendue")
    return items.map { Attachment(client, it) }
}

/** `resp.dataSec.data` : l'enveloppe utile d'un `post`. */
private fun dataOf(resp: JVal): JVal.Obj {
    val dataSec = (resp as? JVal.Obj)?.fields?.get("dataSec") as? JVal.Obj
    return dataSec?.fields?.get("data") as? JVal.Obj
        ?: throw ParsingError("Enveloppe dataSec.data manquante", listOf("dataSec", "data"))
}

/** `resp.dataSec.data.<key>.V` en liste (absent/non-tableau = `ParsingError`). */
private fun dataList(resp: JVal, key: String): List<JVal> {
    val arr = (dataOf(resp).fields[key] as? JVal.Obj)?.fields?.get("V") as? JVal.Arr
    return arr?.items ?: throw ParsingError("Liste $key manquante", listOf("dataSec", "data", key, "V"))
}

/**
 * Comme [dataList], mais une LISTE absente vaut vide : le snapshot
 * `Period.notes()` ne jette pas un trimestre entier parce qu'une des deux
 * listes manque. L'ENVELOPPE (`dataSec.data`), elle, reste stricte — un
 * payload sans données ne doit pas être publié comme un trimestre vide.
 */
private fun tolerantDataList(resp: JVal, key: String): List<JVal> {
    val data = dataOf(resp)
    val arr = (data.fields[key] as? JVal.Obj)?.fields?.get("V") as? JVal.Arr
    return arr?.items ?: emptyList()
}

/** Lignes tolérantes : une ligne illisible est sautée, les autres restent. */
private fun <T> tolerantRows(rows: List<JVal>, make: (JVal) -> T): List<T> {
    val out = mutableListOf<T>()
    for (row in rows) {
        try {
            out.add(make(row))
        } catch (_: Exception) {
            // Une note/moyenne tordue ne doit pas jeter TOUT le trimestre :
            // les autres lignes de la MÊME réponse restent affichables.
        }
    }
    return out
}

/** `funcOptions.dataSec.data.General.<key>.V` brut (tranches horaires ; `null` si illisible). */
private fun heuresV(client: PronoteClientLike, key: String): JVal? {
    val root = client.funcOptions as? JVal.Obj ?: return null
    val data = ((root.fields["dataSec"] as? JVal.Obj)?.fields?.get("data") as? JVal.Obj) ?: return null
    val general = data.fields["General"] as? JVal.Obj ?: return null
    return (general.fields[key] as? JVal.Obj)?.fields?.get("V")
}

/** `parseFloat` : espaces taillés, préfixe décimal/`Infinity`, sinon `NaN` (la moyenne manuelle en dépend). */
private val FLOAT_PREFIX = Regex("^[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?")

private fun parseFloatJs(s: String): Double {
    val t = s.trim { c -> c <= ' ' || c == ' ' }
    if (t.startsWith("Infinity") || t.startsWith("+Infinity")) return Double.POSITIVE_INFINITY
    if (t.startsWith("-Infinity")) return Double.NEGATIVE_INFINITY
    return FLOAT_PREFIX.find(t)?.value?.toDoubleOrNull() ?: Double.NaN
}

/** `encodeURIComponent` : `A-Za-z0-9 -_.!~*'()` bruts, le reste en `%XX` (UTF-8, hex MAJUSCULE). */
private fun encodeURIComponent(s: String): String {
    val kept = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
    val out = StringBuilder()
    for (b in s.toByteArray(Charsets.UTF_8)) {
        val c = b.toInt() and 0xFF
        if (c < 128 && kept.contains(c.toChar())) out.append(c.toChar())
        else {
            out.append('%')
            out.append("0123456789ABCDEF"[c shr 4])
            out.append("0123456789ABCDEF"[c and 0xF])
        }
    }
    return out.toString()
}

/**
 * `Math.round` : demis vers `+∞`, avec `-0.5 -> -0` (`floor` donnerait `+0`).
 * Les moyennes sont positives ; le cas ne survient que sur donnees tordues.
 */
private fun roundJs(x: Double): Double = if (x == -0.5) -0.0 else floor(x + 0.5)

// ---------------------------------------------------------------------------
// Matières, moyennes, notes.
// ---------------------------------------------------------------------------

/** Matière (`N`/`L`, `groups` = `estServiceGroupe`, défaut `false`). */
class Subject(json: JVal?) : PronoteObject(json) {
    val id: String = r(::strOf, listOf("N"))
    val name: String = r(::strOf, listOf("L"))
    val groups: Boolean = r(::boolOf, listOf("estServiceGroupe"), ResolveOpts.withDefault(false))
}

/** Moyenne de service (`subject` reconstruit depuis le même dict ; `null` = code `|N` inconnu). */
class Average(json: JVal?) : PronoteObject(json) {
    val student: String? = r(::gradeParse, listOf("moyEleve", "V"))
    val outOf: String? = r(::gradeParse, listOf("baremeMoyEleve", "V"))
    val defaultOutOf: String? = r(::gradeParse, listOf("baremeMoyEleveParDefault", "V"), ResolveOpts.withDefault<String?>( ""))
    val classAverage: String? = r(::gradeParse, listOf("moyClasse", "V"))
    val min: String? = r(::gradeParse, listOf("moyMin", "V"))
    val max: String? = r(::gradeParse, listOf("moyMax", "V"))
    val subject: Subject = Subject(json)
    val backgroundColor: String? = r(::optStr, listOf("couleur"), ResolveOpts.lenient())
}

/**
 * Note (`period` résolu via le registre `Period.instances`, `null` si inconnu ;
 * `isOptionnal` garde la coquille TS, `facultatif && !bonus`).
 */
class Grade(json: JVal?) : PronoteObject(json) {
    val id: String = r(::strOf, listOf("N"))
    val grade: String? = r(::gradeParse, listOf("note", "V"))
    val outOf: String? = r(::gradeParse, listOf("bareme", "V"))
    val defaultOutOf: String? = r(::gradeParse, listOf("baremeParDefaut", "V"), ResolveOpts.lenient())
    val date: LocalDateTime = r(::dateParse, listOf("date", "V"))
    val subject: Subject = r({ v -> Subject(v) }, listOf("service", "V"))
    val period: Period? =
        // `===` strict sur la valeur brute : `N` non-texte ne matche jamais.
        r({ v -> (v as? JVal.Str)?.value?.let { n -> Period.instances.firstOrNull { it.id == n } } }, listOf("periode", "V", "N"), ResolveOpts.lenient())
    val average: String? = r(::gradeParse, listOf("moyenne", "V"), ResolveOpts.lenient())
    val max: String? = r(::gradeParse, listOf("noteMax", "V"), ResolveOpts.lenient())
    val min: String? = r(::gradeParse, listOf("noteMin", "V"), ResolveOpts.lenient())
    val coefficient: String? = r(::optStr, listOf("coefficient"), ResolveOpts.lenient())
    val comment: String? = r(::optStr, listOf("commentaire"), ResolveOpts.lenient())
    val isBonus: Boolean = r(::boolOf, listOf("estBonus"), ResolveOpts.withDefault(false))
    val isOptionnal: Boolean = r(::boolOf, listOf("estFacultatif"), ResolveOpts.withDefault(false)) && !isBonus
    val isOutOf20: Boolean = r(::boolOf, listOf("estRamenerSur20"), ResolveOpts.withDefault(false))
}

// ---------------------------------------------------------------------------
// Vie scolaire.
// ---------------------------------------------------------------------------

/** Absence (`hours`/`justification` absents = `null`, `days` défaut `0`). */
class Absence(json: JVal?) : PronoteObject(json) {
    val id: String = r(::strOf, listOf("N"))
    val fromDate: LocalDateTime = r(::datetimeParse, listOf("dateDebut", "V"))
    val toDate: LocalDateTime = r(::datetimeParse, listOf("dateFin", "V"))
    val justified: Boolean = r(::boolOf, listOf("justifie"), ResolveOpts.withDefault(false))
    val hours: String? = r(::optStr, listOf("NbrHeures"), ResolveOpts.lenient())
    val days: Double = r(::numOf, listOf("NbrJours"), ResolveOpts.withDefault(0.0))
    val reasons: List<String?> = r(::rawList, listOf("listeMotifs", "V"), ResolveOpts.withDefault(listOf<String?>()))
}

/** Retard (mêmes défauts que `Absence`, `minutes` défaut `0`). */
class Delay(json: JVal?) : PronoteObject(json) {
    val id: String = r(::strOf, listOf("N"))
    val date: LocalDateTime = r(::datetimeParse, listOf("date", "V"))
    val minutes: Double = r(::numOf, listOf("duree"), ResolveOpts.withDefault(0.0))
    val justified: Boolean = r(::boolOf, listOf("justifie"), ResolveOpts.withDefault(false))
    val justification: String? = r(::optStr, listOf("justification"), ResolveOpts.lenient())
    val reasons: List<String?> = r(::rawList, listOf("listeMotifs", "V"), ResolveOpts.withDefault(listOf<String?>()))
}

/**
 * Punition (`during_lesson` = `!horsCours` ; `place2time` illisible = `DataError` ;
 * `schedule` vide sauf si `schedulable`).
 */
class Punishment(private val client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
    /** Programmation (`placeExecution` absent = date seule ; tranche illisible = `DataError`). */
    class ScheduledPunishment(private val client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
        val id: String = r(::strOf, listOf("N"))
        val start: LocalDateTime = run {
            val date = r(::dateParse, listOf("date", "V"))
            val place = r(::optNum, listOf("placeExecution"), ResolveOpts.lenient())
            if (place != null) {
                try {
                    val (h, m) = place2time(heuresV(client, "ListeHeures"), place)
                    date.withHour(h).withMinute(m).withSecond(0).withNano(0)
                } catch (e: Exception) {
                    throw DataError(e.toString())
                }
            } else date
        }
        val duration: Double? = r(::optNum, listOf("duree"), ResolveOpts.lenient())
    }

    val id: String = r(::strOf, listOf("N"))
    val during_lesson: Boolean = r({ v -> !boolOf(v) }, listOf("horsCours"))
    val given: LocalDateTime = run {
        val date = r(::dateParse, listOf("dateDemande", "V"))
        if (during_lesson) {
            val place = r(::numOf, listOf("placeDemande"))
            try {
                val (h, m) = place2time(heuresV(client, "ListeHeures"), place)
                date.withHour(h).withMinute(m).withSecond(0).withNano(0)
            } catch (e: Exception) {
                throw DataError(e.toString())
            }
        } else date
    }
    val exclusion: Boolean = r(::boolOf, listOf("estUneExclusion"))
    val homework: String? = r(::optStr, listOf("travailAFaire"), ResolveOpts.lenient())
    val homeworkDocuments: List<Attachment> =
        r({ v -> attachList(client, v) }, listOf("documentsTAF", "V"), ResolveOpts.withDefault(listOf<Attachment>()))
    val circumstances: String = r(::strOf, listOf("circonstances"))
    val circumstanceDocuments: List<Attachment> =
        r({ v -> attachList(client, v) }, listOf("documentsCirconstances", "V"))
    val nature: String = r(::strOf, listOf("nature", "V", "L"))
    val requiresParent: String? = r(::optStr, listOf("nature", "V", "estAvecARParent"), ResolveOpts.lenient())
    val reasons: List<String?> = r(::rawList, listOf("listeMotifs", "V"))
    val giver: String = r(::strOf, listOf("demandeur", "V", "L"))
    val schedulable: Boolean = r(::boolOf, listOf("estProgrammable"))
    val schedule: List<ScheduledPunishment> =
        if (schedulable) {
            r({ v ->
                val items = (v as? JVal.Arr)?.items ?: throw IllegalStateException("programmation attendue")
                items.map { ScheduledPunishment(client, it) }
            }, listOf("programmation", "V"))
        } else emptyList()
    /** Durée de la sanction, en MINUTES (`duree` Pronote, comme le retard). */
    val duration: Double? = r(::optNum, listOf("duree"), ResolveOpts.lenient())
}

// ---------------------------------------------------------------------------
// Cantine.
// ---------------------------------------------------------------------------

/**
 * Menu (`isLunch` = `G == 0`, `isDinner` = `G == 1` ; `ListePlats` réindexé par
 * `String(G)`, ordre `dessert = 4` / `fromage = 5` conservé tel quel).
 */
class Menu(private val client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
    /** Label alimentaire (le `client` est ignoré, signature conservée). */
    class FoodLabel(_client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
        val id: String = r(::strOf, listOf("N"))
        val name: String = r(::strOf, listOf("L"))
        val color: String? = r(::optStr, listOf("couleur"), ResolveOpts.lenient())
    }

    /** Plat (labels requis, même si vides côté serveur). */
    class Food(private val client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
        val id: String = r(::strOf, listOf("N"))
        val name: String = r(::strOf, listOf("L"))
        val labels: List<FoodLabel> =
            r({ v ->
                val items = (v as? JVal.Arr)?.items ?: throw IllegalStateException("labels attendus")
                items.map { FoodLabel(client, it) }
            }, listOf("listeLabelsAlimentaires", "V"))
    }

    val id: String = r(::strOf, listOf("N"))
    val name: String? = r(::optStr, listOf("L"), ResolveOpts.lenient())
    val date: LocalDateTime = r(::dateParse, listOf("Date", "V"))
    val isLunch: Boolean = r(::numOf, listOf("G")) == 0.0
    val isDinner: Boolean = r(::numOf, listOf("G")) == 1.0

    private val mealResolver: Resolver = run {
        // `json.ListePlats.V` : l'objet porte `V`, le tableau est dedans.
        val plats = r({ v -> v }, listOf("ListePlats")) as? JVal.Obj
            ?: throw ParsingError("ListePlats manquantes", listOf("ListePlats"))
        val platsArr = plats.fields["V"] as? JVal.Arr
            ?: throw ParsingError("ListePlats.V manquante", listOf("ListePlats", "V"))
        val dict = LinkedHashMap<String, JVal>()
        for (meal in platsArr.items) {
            val g = (meal as? JVal.Obj)?.fields?.get("G")
            dict[if (g == null) "undefined" else strOf(g)] = meal
        }
        Resolver(JVal.Obj(dict))
    }

    private fun mealAt(key: String): List<Food>? =
        mealResolver.call({ v ->
            val arr = (((v as? JVal.Obj)?.fields?.get("ListeAliments") as? JVal.Obj)?.fields?.get("V") as? JVal.Arr)
                ?: throw IllegalStateException("ListeAliments attendue")
            arr.items.map { Food(client, it) }
        }, listOf(key), ResolveOpts.lenient())

    val firstMeal: List<Food>? = mealAt("0")
    val mainMeal: List<Food>? = mealAt("1")
    val sideMeal: List<Food>? = mealAt("2")
    val otherMeal: List<Food>? = mealAt("3")
    val cheese: List<Food>? = mealAt("5")
    val dessert: List<Food>? = mealAt("4")
}

// ---------------------------------------------------------------------------
// Pièces jointes, cours, devoirs, infos.
// ---------------------------------------------------------------------------

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
                val endTimes = heuresV(client, "ListeHeuresFin")
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

// ---------------------------------------------------------------------------
// Discussions.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Trimestre + identité ressource.
// ---------------------------------------------------------------------------

/**
 * Lecture d'une période en UNE réponse `DernieresNotes`.
 *
 * C'est le snapshot que l'app publie : notes, moyennes et moyenne générale
 * viennent du MÊME POST (avant, `grades()` + `averages()` + `overallAverage()`
 * en faisaient trois pour une même période). Les lignes illisibles sont
 * SAUTÉES une par une : une note tordue ne fait plus disparaître toutes les
 * autres.
 *
 * `overallAverage` garde la forme de `Period.overallAverage()` (`moyGenerale.V`
 * publiée, sinon moyenne manuelle, `"-1"` si aucune moyenne exploitable) ;
 * `null` = liste de services absente, donc moyenne INCONNUE.
 */
data class PeriodNotes(
    val grades: List<Grade>,
    val averages: List<Average>,
    val overallAverage: JVal?,
)

/**
 * Moyenne générale d'une réponse `DernieresNotes` : `moyGenerale.V` si
 * publiée, sinon moyenne manuelle des `moyEleve` (virgule→point, `NaN`
 * sautés, arrondi `x100/100`, `"-1"` si vide).
 *
 * `tolerant` = les services illisibles sont SAUTÉS et une liste de services
 * absente vaut `null` (inconnue) ; sinon le comportement strict historique
 * (`UnsupportedOperation` / `ParsingError`) est conservé.
 */
private fun overallAverageOf(resp: JVal, tolerant: Boolean): JVal? {
    val data = dataOf(resp)
    // Falsy (`null`, absent, `0`, `""`) = calcul manuel ; sinon `V` BRUT
    // (même absent : `undefined` côté TS, rendu `null` par le pilote).
    val avg = data.fields["moyGenerale"]
    if (boolOf(avg)) return (avg as? JVal.Obj)?.fields?.get("V")
    val services = if (tolerant) {
        try {
            dataList(resp, "listeServices")
        } catch (_: ParsingError) {
            return null
        }
    } else {
        dataList(resp, "listeServices")
    }
    if (services.isEmpty()) return JVal.Str("-1")
    var a = 0.0
    var total = 0
    for (s in services) {
        val o = s as? JVal.Obj
        if (o == null) {
            if (tolerant) continue
            throw UnsupportedOperation("Could not get averages")
        }
        if (!o.fields.containsKey("moyEleve")) {
            if (tolerant) continue
            throw UnsupportedOperation("Could not get averages")
        }
        val avrg = strOf((o.fields["moyEleve"] as? JVal.Obj)?.fields?.get("V")).replace(",", ".")
        val flt = parseFloatJs(avrg)
        if (!flt.isNaN()) {
            a += flt
            total += 1
        }
    }
    return if (total != 0) JVal.Str(jsNumber(roundJs(a / total * 100) / 100)) else JVal.Str("-1")
}

/**
 * Trimestre (registre `instances` alimenté à la construction, avant parse —
 * comme le `Set` TS ; bornes `PagePresence` via `frDateTime`).
 */
class Period(private val client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
    companion object {
        val instances: MutableSet<Period> = mutableSetOf()
    }

    init {
        instances.add(this)
    }

    val id: String = r(::strOf, listOf("N"))
    val name: String = r(::strOf, listOf("L"))
    val start: LocalDateTime = r(::datetimeParse, listOf("dateDebut", "V"))
    val end: LocalDateTime = r(::datetimeParse, listOf("dateFin", "V"))

    private fun notesPayload(): Map<String, JVal> =
        mapOf("Periode" to jobj("N" to JVal.Str(id), "L" to JVal.Str(name)))

    private fun presencePayload(): Map<String, JVal> =
        mapOf(
            "periode" to jobj("N" to JVal.Str(id), "L" to JVal.Str(name), "G" to JVal.Num(2.0)),
            "DateDebut" to jobj("_T" to JVal.Num(7.0), "V" to JVal.Str(frDateTime(start))),
            "DateFin" to jobj("_T" to JVal.Num(7.0), "V" to JVal.Str(frDateTime(end))),
        )

    /** Notes (`DernieresNotes` 198 ; réseau bloquant). */
    fun grades(): List<Grade> {
        val resp = client.post("DernieresNotes", 198.0, notesPayload())
        return dataList(resp, "listeDevoirs").map { Grade(it) }
    }

    /**
     * Snapshot complet de la période en UN SEUL `DernieresNotes`.
     *
     * À préférer à `grades()` + `averages()` + `overallAverage()` pour
     * l'affichage : un seul POST au lieu de trois. Les lignes tordues sont
     * sautées (les autres notes/moyennes restent), mais l'enveloppe
     * `dataSec.data` reste obligatoire : un payload vide ne doit pas être
     * publié comme un trimestre sans notes.
     */
    fun notes(): PeriodNotes {
        val resp = client.post("DernieresNotes", 198.0, notesPayload())
        return PeriodNotes(
            grades = tolerantRows(tolerantDataList(resp, "listeDevoirs")) { Grade(it) },
            averages = tolerantRows(tolerantDataList(resp, "listeServices")) { Average(it) },
            overallAverage = overallAverageOf(resp, tolerant = true),
        )
    }

    /**
     * Moyennes (`DernieresNotes` 198 ; `moyEleve` illisible =
     * `UnsupportedOperation` ; réseau bloquant).
     */
    fun averages(): List<Average> {
        val resp = client.post("DernieresNotes", 198.0, notesPayload())
        val crs = dataList(resp, "listeServices")
        try {
            return crs.map { Average(it) }
        } catch (e: ParsingError) {
            if (e.path.joinToString(",") == "moyEleve,V") throw UnsupportedOperation("Could not get averages")
            throw e
        }
    }

    /**
     * Moyenne générale (`moyGenerale.V` si présente, sinon moyenne manuelle
     * virgule→point, `NaN` sautés, arrondi `x100/100`, `"-1"` si vide ;
     * `moyEleve` absent = `UnsupportedOperation` ; réseau bloquant).
     */
    fun overallAverage(): JVal? {
        val resp = client.post("DernieresNotes", 198.0, notesPayload())
        return overallAverageOf(resp, tolerant = false)
    }

    /** Absences (`PagePresence` 19, `G == 13` ; réseau bloquant). */
    fun absences(): List<Absence> {
        val resp = client.post("PagePresence", 19.0, presencePayload())
        return dataList(resp, "listeAbsences")
            .filter { ((it as? JVal.Obj)?.fields?.get("G") as? JVal.Num)?.value == 13.0 }
            .map { Absence(it) }
    }

    /** Retards (`PagePresence` 19, `G == 14` ; réseau bloquant). */
    fun delays(): List<Delay> {
        val resp = client.post("PagePresence", 19.0, presencePayload())
        return dataList(resp, "listeAbsences")
            .filter { ((it as? JVal.Obj)?.fields?.get("G") as? JVal.Num)?.value == 14.0 }
            .map { Delay(it) }
    }

    /** Punitions (`PagePresence` 19, `G == 41` ; réseau bloquant). */
    fun punishments(): List<Punishment> {
        val resp = client.post("PagePresence", 19.0, presencePayload())
        return dataList(resp, "listeAbsences")
            .filter { ((it as? JVal.Obj)?.fields?.get("G") as? JVal.Num)?.value == 41.0 }
            .map { Punishment(client, it) }
    }
}

/**
 * Identité d'une ressource (`name`/`delegue`/`className`/`establishment` en
 * getters bruts ; `profilePicture` = `Attachment` si `avecPhoto` ;
 * `cache()` poste `PageInfosPerso` sur `communication`, mis en cache).
 */
class ClientInfo(private val client: PronoteClientLike, json: JVal?) {
    // `json.N` direct : `null`/`undefined` jette (comme `.N` cote TS).
    private val raw: JVal.Obj = json as JVal.Obj
    val id: String? = rawStrOrNull(raw.fields["N"])
    val rawResource: JVal = raw

    private var cacheValue: JVal? = null

    val name: String? get() = rawStrOrNull(raw.fields["L"])

    val profilePicture: Attachment? get() {
        if (!boolOf(raw.fields["avecPhoto"])) return null
        // `N` brut transmis ; absent = `"undefined"` textuel (`String(undefined)`
        // — l'`Attachment` ne jette jamais ici, des deux côtés.
        val payload = LinkedHashMap<String, JVal>()
        payload["L"] = JVal.Str("photo.jpg")
        payload["N"] = raw.fields["N"]?.let { if (it is JVal.Null) JVal.Str("null") else JVal.Str(strOf(it)) } ?: JVal.Str("undefined")
        payload["G"] = JVal.Num(1.0)
        return Attachment(client, JVal.Obj(payload))
    }

    val delegue: List<String?> get() {
        if (!boolOf(raw.fields["estDelegue"])) return emptyList()
        // `.V` direct : absent = jete ; elements bruts (`.L` absent = `null`).
        val items = ((raw.fields["listeClassesDelegue"] as JVal.Obj).fields["V"] as JVal.Arr).items
        return items.map { rawLeaf((it as? JVal.Obj)?.fields?.get("L")) }
    }

    val className: String get() {
        val ce = raw.fields["classeDEleve"] as? JVal.Obj ?: return ""
        val l = ce.fields["L"]
        return if (l == null || l is JVal.Null) "" else strOf(l)
    }

    val establishment: String get() {
        val etab = raw.fields["Etablissement"] as? JVal.Obj ?: return ""
        // `?.V?.L ?? ""` : `V` absent = `""` (pas d'exception), `L` absent = `""`.
        val v = (etab.fields["V"] as? JVal.Obj)?.fields?.get("L") ?: return ""
        return if (v is JVal.Null) "" else strOf(v)
    }

    /** Bloc `Informations` (`PageInfosPerso` via `communication`, mis en cache ; réseau bloquant). */
    fun cache(): JVal? {
        cacheValue?.let { return it }
        val resp = client.communication.post(
            "PageInfosPerso",
            mapOf(
                "Signature" to JVal.Obj(LinkedHashMap<String, JVal>().also { sig ->
                    sig["onglet"] = JVal.Num(49.0)
                    // `N` brut : absent = cle omise (comme `undefined` cote TS).
                    val res = LinkedHashMap<String, JVal>()
                    id?.let { res["N"] = JVal.Str(it) }
                    res["G"] = JVal.Num(4.0)
                    sig["ressource"] = JVal.Obj(res)
                }),
            ),
        )
        // Absent = `undefined` (pas d'erreur : `address()` & co. lisent dedans).
        val c = dataOf(resp).fields["Informations"]
        cacheValue = c
        return c
    }
}
