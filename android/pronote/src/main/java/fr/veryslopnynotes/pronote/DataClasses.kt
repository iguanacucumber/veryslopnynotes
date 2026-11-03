package fr.veryslopnynotes.pronote

import java.time.LocalDateTime
import kotlin.math.floor

/**
 * Aides et périodes des objets métier PRONOTE. Zéro dépendance (stdlib Kotlin +
 * `java.time`) ; seules les méthodes listées font du réseau. Dates murales.
 *
 * Non porté du TS (pas de lecteur Android) : `Student`, `StudentClass`,
 * `Identity`, `Guardian`, `TeachingStaff`, `Report`, `Evaluation`, `toDict`,
 * `Util.get`.
 */

internal fun jobj(vararg ps: Pair<String, JVal>): JVal.Obj =
    JVal.Obj(LinkedHashMap<String, JVal>().also { m -> ps.forEach { m[it.first] = it.second } })

/**
 * Chemin absent (`lenient`) → `null` ; `null` PRÉSENT → `"null"`, comme
 * `String(null)` en TS (le serveur omet, il ne `null`-ifie jamais).
 */
internal fun optStr(v: JVal?): String? = strOf(v)

/** Chemin absent → `null`, `null` présent → `0` (comme `Number(null)`). */
internal fun optNum(v: JVal?): Double? = v?.let { numOf(it) }

/** Feuille brute (`.L`, `.url`…) : absente/`null` → `null`, sinon stringifiée. */
internal fun rawLeaf(v: JVal?): String? = when (v) {
    null, is JVal.Null -> null
    is JVal.Str -> v.value
    else -> strOf(v)
}

/** Elements BRUTS : `null` gardé, comme `undefined`/`null` en TS. */
internal fun rawList(v: JVal?): List<String?> {
    val items = (v as? JVal.Arr)?.items ?: throw IllegalStateException("liste attendue")
    return items.map { rawLeaf((it as? JVal.Obj)?.fields?.get("L")) }
}

/** Absent = `undefined` (rendu omis par le pilote). */
internal fun rawStrOrNull(v: JVal?): String? =
    v?.let { if (it is JVal.Null) "null" else strOf(it) }

internal fun rawUrls(v: JVal?): List<String?> {
    val items = (v as? JVal.Arr)?.items ?: throw IllegalStateException("liste attendue")
    return items.map { rawLeaf((it as? JVal.Obj)?.fields?.get("url")) }
}

internal fun attachList(client: PronoteClientLike, v: JVal?): List<Attachment> {
    val items = (v as? JVal.Arr)?.items ?: throw IllegalStateException("liste de pièces jointes attendue")
    return items.map { Attachment(client, it) }
}

/** Enveloppe utile (`dataSec.data`) d'un `post`. */
internal fun dataOf(resp: JVal): JVal.Obj {
    val dataSec = (resp as? JVal.Obj)?.fields?.get("dataSec") as? JVal.Obj
    return dataSec?.fields?.get("data") as? JVal.Obj
        ?: throw ParsingError("Enveloppe dataSec.data manquante", listOf("dataSec", "data"))
}

/** `dataSec.data.<key>.V` en liste (absent/non-tableau = `ParsingError`). */
internal fun dataList(resp: JVal, key: String): List<JVal> {
    val arr = (dataOf(resp).fields[key] as? JVal.Obj)?.fields?.get("V") as? JVal.Arr
    return arr?.items ?: throw ParsingError("Liste $key manquante", listOf("dataSec", "data", key, "V"))
}

/** Une liste ABSENTE est une section illisible : `null`, pas une liste vide. */
internal fun dataListOrNull(resp: JVal, key: String): List<JVal>? =
    ((dataOf(resp).fields[key] as? JVal.Obj)?.fields?.get("V") as? JVal.Arr)?.items

/**
 * Résultat d'une lecture sectionnée : [value] ne contient que les données
 * lisibles, [partial] dit qu'une section ou une ligne a été écartée.
 *
 * Une lecture PARTIELLE n'est jamais rendue comme complète : le drapeau
 * voyage jusqu'au payload publié.
 */
data class PartialRead<out T>(val value: T, val partial: Boolean)

/**
 * Une erreur de FORME (ligne tordue, champ absent) se saute ; une erreur de
 * session, de débit ou de transport remonte : elle ne prouve pas que la
 * donnée est incomplète, elle prouve que la lecture a échoué.
 */
internal fun isUnreadableRow(e: Throwable): Boolean =
    e is DataError || e is DateParsingError || e is IllegalArgumentException ||
        e is IllegalStateException || e is ClassCastException

/**
 * Lignes tolérantes : une ligne illisible est SAUTÉE, le résultat est marqué
 * partiel. Si toutes les lignes sont illisibles, la première erreur remonte :
 * une liste non vide dont rien n'est lisible n'est pas une liste vide.
 */
internal fun <T> partialRows(rows: List<JVal>, make: (JVal) -> T): PartialRead<List<T>> {
    val out = mutableListOf<T>()
    var partial = false
    var first: Exception? = null
    for (row in rows) {
        try {
            out.add(make(row))
        } catch (e: Exception) {
            if (!isUnreadableRow(e)) throw e
            partial = true
            if (first == null) first = e
        }
    }
    if (rows.isNotEmpty() && out.isEmpty()) throw first ?: ParsingError("Aucune ligne lisible")
    return PartialRead(out, partial)
}

/** Une SECTION peut manquer : elle est alors écartée, pas devinée vide. */
internal class PartialSections<T> {
    private val values = mutableListOf<T>()
    private var attempted = 0
    private var readable = 0
    private var partial = false
    private var firstFailure: Exception? = null

    fun add(block: () -> PartialRead<List<T>>) {
        attempted += 1
        try {
            val section = block()
            readable += 1
            values += section.value
            if (section.partial) partial = true
        } catch (e: Exception) {
            if (!isUnreadableRow(e)) throw e
            partial = true
            if (firstFailure == null) firstFailure = e
        }
    }

    /** Aucune section lisible = l'erreur typée de la première, jamais un vide. */
    fun build(): PartialRead<List<T>> {
        if (attempted > 0 && readable == 0) {
            throw firstFailure ?: ParsingError("Aucune section lisible")
        }
        return PartialRead(values, partial)
    }
}

/** `funcOptions.dataSec.data.General.<key>.V` brut, `null` si illisible. */
internal fun hoursValue(client: PronoteClientLike, key: String): JVal? {
    val root = client.funcOptions as? JVal.Obj ?: return null
    val data = ((root.fields["dataSec"] as? JVal.Obj)?.fields?.get("data") as? JVal.Obj) ?: return null
    val general = data.fields["General"] as? JVal.Obj ?: return null
    return (general.fields[key] as? JVal.Obj)?.fields?.get("V")
}

/** `parseFloat` : espaces taillés, préfixe décimal/`Infinity`, sinon `NaN`. */
private val FLOAT_PREFIX = Regex("^[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?")

private fun parseFloatJs(s: String): Double {
    val t = s.trim { c -> c <= ' ' || c == ' ' }
    if (t.startsWith("Infinity") || t.startsWith("+Infinity")) return Double.POSITIVE_INFINITY
    if (t.startsWith("-Infinity")) return Double.NEGATIVE_INFINITY
    return FLOAT_PREFIX.find(t)?.value?.toDoubleOrNull() ?: Double.NaN
}

/** `encodeURIComponent` : `A-Za-z0-9 -_.!~*'()` bruts, sinon `%XX` (UTF-8). */
internal fun encodeURIComponent(s: String): String {
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

/** `Math.round` : demis vers `+∞`, `-0.5` → `-0` (`floor` donnerait `+0`). */
private fun roundJs(x: Double): Double = if (x == -0.5) -0.0 else floor(x + 0.5)

/**
 * Snapshot publié par l'app : notes, moyennes et moyenne générale du MÊME POST.
 * Les lignes illisibles sont SAUTÉES une par une.
 *
 * `overallAverage` : `moyGenerale.V` publiée, sinon moyenne manuelle, `"-1"` si
 * aucune moyenne exploitable ; `null` = moyenne INCONNUE.
 *
 * `partial` : au moins une section (`listeDevoirs`, `listeServices`) ou une
 * ligne a été écartée. Un snapshot partiel n'est jamais publié comme complet.
 */
data class PeriodNotes(
    val grades: List<Grade>,
    val averages: List<Average>,
    val overallAverage: JVal?,
    val partial: Boolean = false,
)

/**
 * `moyGenerale.V` si publiée, sinon moyenne manuelle des `moyEleve` (virgule→
 * point, `NaN` sautés, arrondi `x100/100`, `"-1"` si vide).
 *
 * `tolerant` : services illisibles SAUTÉS et liste absente = `null` ; sinon
 * comportement strict (`UnsupportedOperation` / `ParsingError`).
 */
private fun overallAverageOf(resp: JVal, tolerant: Boolean): JVal? {
    val data = dataOf(resp)
    // Falsy = calcul manuel ; sinon `V` BRUT (`undefined` côté TS).
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
 * Période d'une session : les notes résolvent leur période dans la liste du
 * MÊME client, jamais dans un registre partagé (I16).
 */
class Period(private val client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
    /** Liste du client, complétée de cette période quand elle est construite seule. */
    private fun periodLookup(): (String) -> Period? {
        val cached = runCatching { client.periods }.getOrNull().orEmpty()
        val scoped = if (cached.any { it === this }) cached else cached + this
        return { id -> scoped.firstOrNull { it.id == id } }
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

    /** `DernieresNotes` 198. */
    fun grades(): List<Grade> {
        val resp = client.post("DernieresNotes", 198.0, notesPayload())
        val resolve = periodLookup()
        return dataList(resp, "listeDevoirs").map { Grade(it, resolve) }
    }

    /**
     * UN SEUL POST au lieu de trois ; lignes tordues sautées, enveloppe
     * `dataSec.data` obligatoire.
     *
     * Les deux listes sont des SECTIONS indépendantes : l'une illisible ne
     * jette pas l'autre. `moyGenerale` est une troisième section : elle peut
     * suffire quand les listes manquent. Aucune des trois = erreur typée.
     */
    fun notes(): PeriodNotes {
        val resp = client.post("DernieresNotes", 198.0, notesPayload())
        val data = dataOf(resp)
        val resolve = periodLookup()
        var firstFailure: Exception? = null
        val grades = try {
            val rows = dataListOrNull(resp, "listeDevoirs")
                ?: throw ParsingError("Liste listeDevoirs manquante", listOf("dataSec", "data", "listeDevoirs", "V"))
            partialRows(rows) { Grade(it, resolve) }
        } catch (e: Exception) {
            if (!isUnreadableRow(e)) throw e
            firstFailure = e
            null
        }
        val averages = try {
            val rows = dataListOrNull(resp, "listeServices")
                ?: throw ParsingError("Liste listeServices manquante", listOf("dataSec", "data", "listeServices", "V"))
            partialRows(rows) { Average(it) }
        } catch (e: Exception) {
            if (!isUnreadableRow(e)) throw e
            if (firstFailure == null) firstFailure = e
            null
        }
        val overallKnown = data.fields["moyGenerale"]?.let { boolOf(it) } == true
        if (grades == null && averages == null && !overallKnown) {
            throw firstFailure ?: ParsingError("Notes illisibles", listOf("dataSec", "data"))
        }
        return PeriodNotes(
            grades = grades?.value.orEmpty(),
            averages = averages?.value.orEmpty(),
            overallAverage = overallAverageOf(resp, tolerant = true),
            partial = grades == null || averages == null || grades.partial || averages.partial,
        )
    }

    /** `moyEleve` illisible = `UnsupportedOperation`. */
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

    /** `moyEleve` absent = `UnsupportedOperation`. */
    fun overallAverage(): JVal? {
        val resp = client.post("DernieresNotes", 198.0, notesPayload())
        return overallAverageOf(resp, tolerant = false)
    }

    private fun presenceRows(g: Double): List<JVal> {
        val resp = client.post("PagePresence", 19.0, presencePayload())
        return dataList(resp, "listeAbsences")
            .filter { ((it as? JVal.Obj)?.fields?.get("G") as? JVal.Num)?.value == g }
    }

    /** Absences (`PagePresence` 19, `G == 13`). */
    fun absences(): List<Absence> = presenceRows(13.0).map { Absence(it) }

    /** Absences tolérantes : une ligne tordue est sautée, le reste publié. */
    fun absencesPartial(): PartialRead<List<Absence>> = partialRows(presenceRows(13.0)) { Absence(it) }

    /** Retards (`PagePresence` 19, `G == 14`). */
    fun delays(): List<Delay> = presenceRows(14.0).map { Delay(it) }

    fun delaysPartial(): PartialRead<List<Delay>> = partialRows(presenceRows(14.0)) { Delay(it) }

    /** Punitions (`PagePresence` 19, `G == 41`). */
    fun punishments(): List<Punishment> = presenceRows(41.0).map { Punishment(client, it) }

    fun punishmentsPartial(): PartialRead<List<Punishment>> =
        partialRows(presenceRows(41.0)) { Punishment(client, it) }
}

/**
 * `profilePicture` = `Attachment` si `avecPhoto` ; `cache()` poste
 * `PageInfosPerso` sur `communication` et le garde.
 */
class ClientInfo(private val client: PronoteClientLike, json: JVal?) {
    // `json.N` direct : `null`/`undefined` jette (comme `.N` en TS).
    private val raw: JVal.Obj = json as JVal.Obj
    val id: String? = rawStrOrNull(raw.fields["N"])
    val rawResource: JVal = raw

    private var cacheValue: JVal? = null

    val name: String? get() = rawStrOrNull(raw.fields["L"])

    val profilePicture: Attachment? get() {
        if (!boolOf(raw.fields["avecPhoto"])) return null
        // `N` brut ; absent = `"undefined"` textuel, comme `String(undefined)`.
        val payload = LinkedHashMap<String, JVal>()
        payload["L"] = JVal.Str("photo.jpg")
        payload["N"] = raw.fields["N"]?.let { if (it is JVal.Null) JVal.Str("null") else JVal.Str(strOf(it)) } ?: JVal.Str("undefined")
        payload["G"] = JVal.Num(1.0)
        return Attachment(client, JVal.Obj(payload))
    }

    val delegue: List<String?> get() {
        if (!boolOf(raw.fields["estDelegue"])) return emptyList()
        // `.V` direct : absent = jette ; éléments bruts (`.L` absent = `null`).
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
        // `V` absent = `""` (pas d'exception), `L` absent = `""`.
        val v = (etab.fields["V"] as? JVal.Obj)?.fields?.get("L") ?: return ""
        return if (v is JVal.Null) "" else strOf(v)
    }

    /** Bloc `Informations` (`PageInfosPerso` via `communication`), mis en cache. */
    fun cache(): JVal? {
        cacheValue?.let { return it }
        val resp = client.communication.post(
            "PageInfosPerso",
            mapOf(
                "Signature" to JVal.Obj(LinkedHashMap<String, JVal>().also { sig ->
                    sig["onglet"] = JVal.Num(49.0)
                    // `N` brut : absent = clé omise (comme `undefined` en TS).
                    val res = LinkedHashMap<String, JVal>()
                    id?.let { res["N"] = JVal.Str(it) }
                    res["G"] = JVal.Num(4.0)
                    sig["ressource"] = JVal.Obj(res)
                }),
            ),
        )
        // Absent = `undefined`, pas d'erreur.
        val c = dataOf(resp).fields["Informations"]
        cacheValue = c
        return c
    }
}
