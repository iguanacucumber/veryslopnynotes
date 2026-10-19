package fr.veryslopnynotes.pronote

import java.time.LocalDateTime

/**
 * Résolution des valeurs PRONOTE brutes (#201, port de `pronotets` `resolver.js`).
 *
 * Dates FR (`JJ/MM/AAAA`, `JJ/MM/AAAA HH:MM:SS`, `JJ/MM/AA HHhMM`…), notes
 * codées (`|1` = Absent…), HTML des enseignants, tranches horaires. Pur, zéro
 * dépendance.
 *
 * Dates = `LocalDateTime` (heure murale LOCALE, sans fuseau — comme `new Date`
 * côté TS, avec les mêmes bizarreries assumées : `JJ/MM` injecte l'année
 * courante, `HHMM` jette l'heure qu'il vient de lire, `AA` → 2000+AA).
 */

/** Table `gradeTranslate` : code PRONOTE (1..8) → constante (exacte, ordonnée). */
val GRADE_TRANSLATE = listOf(
    "Absent",
    "Dispense",
    "NonNote",
    "Inapte",
    "NonRendu",
    "AbsentZero",
    "NonRenduZero",
    "Felicitations",
)

/**
 * Note codée `|N` → constante, sinon la chaîne telle quelle (virgule FR
 * conservée : `"14,50"` reste `"14,50"`, c'est le mapper qui normalise).
 * Hors table (`|9`, `|` seul) → `null`, comme l'index undefined côté TS.
 * Non-texte (dont `null` présent) = jeté brut, emballé en `ParsingError` par
 * `r()` — comme `.includes` qui jette `TypeError` côté TS.
 */
fun gradeParse(v: JVal?): String? {
    val value = (v as? JVal.Str)?.value ?: throw IllegalArgumentException("note non textuelle")
    if (!value.contains("|")) return value
    if (value.length < 2) return null
    // `value[1]` : le SECOND caractère, en unité UTF-16 comme côté TS.
    val code = parseIntJs(value[1].toString())
    if (code.isNaN()) return null
    val idx = code.toInt() - 1
    return if (idx in GRADE_TRANSLATE.indices) GRADE_TRANSLATE[idx] else null
}

/** `String(v)` : null → `"null"`, nombre au format JS, booléen, objet/arbre plats. */
fun strOf(v: JVal?): String = when (v) {
    null, is JVal.Null -> "null"
    is JVal.Str -> v.value
    is JVal.Num -> jsNumber(v.value)
    is JVal.Bool -> if (v.value) "true" else "false"
    is JVal.Obj -> "[object Object]"
    is JVal.Arr -> v.items.joinToString(",") { strOf(it) }
    // `RawBytes` (transient interne à `Communication.post`) ne traverse jamais ici.
    else -> throw IllegalStateException("JVal non affichable : ${v.javaClass.simpleName}")
}

/**
 * `Array.prototype.toString` = `join(",")` : `null`/`undefined` → chaîne VIDE
 * (pas `"null"`), un tableau imbriqué → son propre `join` (`"1,2"`, pas
 * `"[1],[2]"`). C'est ce que rend `String([null])` = `""` et
 * `String([[1],[2]])` = `"1,2"`.
 */
private fun jsArrayToString(items: List<JVal>): String =
    items.joinToString(",") { if (it == null || it is JVal.Null) "" else strOf(it) }

/**
 * `Number(v)` (sous-ensemble) : nombre direct ; chaîne taillée puis `""` → 0,
 * hexadécimal (`0x10` → 16), `Infinity` signés, décimal/exposant ; le reste →
 * `NaN`. Booléen → 1/0, `null` → 0, objet → `NaN` (pas de `valueOf`).
 * TABLEAU → `Number(String(x))` (le `toString` du tableau) : `Number([])` = 0,
 * `Number([30])` = 30, `Number([null])` = 0, `Number([1,2])` = `NaN`.
 */
fun numOf(v: JVal?): Double {
    if (v == null || v is JVal.Null) return 0.0
    if (v is JVal.Num) return v.value
    if (v is JVal.Bool) return if (v.value) 1.0 else 0.0
    if (v is JVal.Obj) return Double.NaN
    // Tableau : `Number(x)` = `Number(ToPrimitive(x))` = `Number(join(x))`.
    if (v is JVal.Arr) return numOf(JVal.Str(jsArrayToString(v.items)))
    val t = jsTrim((v as JVal.Str).value)
    if (t.isEmpty()) return 0.0
    val hex = Regex("^[+-]?0[xX]([0-9a-fA-F]+)$").matchEntire(t)
    if (hex != null) {
        val sign = if (t.startsWith("-")) -1.0 else 1.0
        return sign * hex.groupValues[1].toLong(16).toDouble()
    }
    // `Number("0b101")` = 5, `Number("0o17")` = 15 (le serveur n'envoie jamais
    // ça, mais `Number()` les accepte : la parité ne doit pas dépendre du goût).
    val bin = Regex("^[+-]?0[bB]([01]+)$").matchEntire(t)
    if (bin != null) {
        val sign = if (t.startsWith("-")) -1.0 else 1.0
        return sign * bin.groupValues[1].toLong(2).toDouble()
    }
    val oct = Regex("^[+-]?0[oO]([0-7]+)$").matchEntire(t)
    if (oct != null) {
        val sign = if (t.startsWith("-")) -1.0 else 1.0
        return sign * oct.groupValues[1].toLong(8).toDouble()
    }
    if (t == "Infinity" || t == "+Infinity") return Double.POSITIVE_INFINITY
    if (t == "-Infinity") return Double.NEGATIVE_INFINITY
    return t.toDoubleOrNull() ?: Double.NaN
}

/** `Boolean(v)` : null/absent/0/NaN/chaîne vide → faux, tout le reste (dont `"false"`) → vrai. */
fun boolOf(v: JVal?): Boolean = when (v) {
    null, is JVal.Null -> false
    is JVal.Bool -> v.value
    is JVal.Num -> v.value != 0.0 && !v.value.isNaN()
    is JVal.Str -> v.value.isNotEmpty()
    is JVal.Obj, is JVal.Arr -> true
    else -> throw IllegalStateException("JVal non testable : ${v.javaClass.simpleName}")
}

fun <T> noopOf(v: T): T = v

private val RE_DMY4 = Regex("""^\d{2}/\d{2}/\d{4}$""")
private val RE_DMY2 = Regex("""^\d{2}/\d{2}/\d{2}$""")
private val RE_DMY4HMS = Regex("""^\d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2}$""")
private val RE_DMY2HM = Regex("""^\d{2}/\d{2}/\d{2} \d{2}h\d{2}$""")
private val RE_DM = Regex("""^\d{2}/\d{2}$""")
private val RE_HM = Regex("""^\d{4}$""")
private val RE_HM_COLON = Regex("""(\d{2})h(\d{2})""")

private fun frParts(s: String): Triple<Int, Int, Int> {
    val p = s.split("/")
    return Triple(p[0].toInt(), p[1].toInt(), p[2].toInt())
}

/**
 * `new Date(y, mo0, d, h, mi, s)` : mois/jours/heures en TROP débordent en
 * cascade (32/09 → 02/10, mois 13 → janvier +1, 25h → lendemain 01h), jamais
 * d'erreur de plage. Mois négatifs idem (`floorDiv`, pas de troncature).
 * Résolu dans la zone système (trous DST décalés vers l'avant, comme JS).
 */
private fun jsDate(y: Int, mo0: Int, d: Int, h: Int = 0, mi: Int = 0, s: Int = 0): LocalDateTime {
    val totalMonths = y * 12 + mo0
    val yy = Math.floorDiv(totalMonths, 12)
    val mm = Math.floorMod(totalMonths, 12) + 1
    val base = LocalDateTime.of(yy, mm, 1, 0, 0)
        .plusDays((d - 1).toLong())
        .plusHours(h.toLong())
        .plusMinutes(mi.toLong())
        .plusSeconds(s.toLong())
    // Trous DST (ex. minuit inexistant) : JS avance d'autant ; `ZonedDateTime`
    // en résolution SMART fait pareil, chevauchements = premier offset.
    // SMART par défaut : trou = avancé de la durée du trou (comme JS),
    // chevauchement = premier offset (comme les moteurs JS).
    return java.time.ZonedDateTime.of(base, java.time.ZoneId.systemDefault()).toLocalDateTime()
}

/**
 * `dateParse` : 6 formats, sinon `DateParsingError`. `JJ/MM` = année courante
 * (borne Dec→Jan assumée) ; `HHMM` = aujourd'hui à minuit (l'heure lue est
 * JETÉE, comme côté TS).
 */
fun dateParse(v: JVal?): LocalDateTime {
    val s = (v as? JVal.Str)?.value ?: throw IllegalArgumentException("date non textuelle")
    if (RE_DMY4.matches(s)) {
        val (d, m, y) = frParts(s)
        return jsDate(y, m - 1, d)
    }
    if (RE_DMY2.matches(s)) {
        val (d, m, y) = frParts(s)
        return jsDate(2000 + y, m - 1, d)
    }
    if (RE_DMY4HMS.matches(s)) {
        val (date, time) = s.split(" ")
        val (d, m, y) = frParts(date)
        val t = time.split(":").map { it.toInt() }
        return jsDate(y, m - 1, d, t[0], t[1], t[2])
    }
    if (RE_DMY2HM.matches(s)) {
        val (date, time) = s.split(" ")
        val (d, m, y) = frParts(date)
        val hm = RE_HM_COLON.find(time)!!.groupValues
        return jsDate(2000 + y, m - 1, d, hm[1].toInt(), hm[2].toInt(), 0)
    }
    if (RE_DM.matches(s)) {
        // Année courante injectée, cascade calendaire comme ailleurs (`31/02` déborde).
        val year = LocalDateTime.now().year
        val (d, m, _) = frParts("$s/$year")
        return jsDate(year, m - 1, d)
    }
    if (RE_HM.matches(s)) {
        val now = LocalDateTime.now()
        return LocalDateTime.of(now.year, now.monthValue, now.dayOfMonth, 0, 0, 0)
    }
    throw DateParsingError(s)
}

/**
 * `datetimeParse` : 3 formats seulement (`JJ/MM` et `HHMM` REFUSÉS, comme côté
 * TS — à l'appelant de choisir). Heure conservée quand elle est là.
 */
fun datetimeParse(v: JVal?): LocalDateTime {
    val s = (v as? JVal.Str)?.value ?: throw IllegalArgumentException("date non textuelle")
    if (RE_DMY4.matches(s)) {
        val (d, m, y) = frParts(s)
        return jsDate(y, m - 1, d)
    }
    if (RE_DMY4HMS.matches(s)) {
        val (date, time) = s.split(" ")
        val (d, m, y) = frParts(date)
        val t = time.split(":").map { it.toInt() }
        return jsDate(y, m - 1, d, t[0], t[1], t[2])
    }
    if (RE_DMY2HM.matches(s)) {
        val (date, time) = s.split(" ")
        val (d, m, y) = frParts(date)
        val hm = RE_HM_COLON.find(time)!!.groupValues
        return jsDate(2000 + y, m - 1, d, hm[1].toInt(), hm[2].toInt(), 0)
    }
    throw DateParsingError(s)
}

private val HTML_NAMED = mapOf(
    "amp" to "&",
    "lt" to "<",
    "gt" to ">",
    "quot" to "\"",
    "#39" to "'",
    "apos" to "'",
    "nbsp" to " ",
)

/**
 * `htmlParse` : strip des balises (`<.*?>`), entités numériques (hexa +
 * décimales, `fromCodePoint`) puis 7 nommées — inconnue laissée telle quelle.
 */
fun htmlParse(v: JVal?): String {
    val html = (v as? JVal.Str)?.value ?: throw IllegalArgumentException("HTML non textuel")
    val stripped = Regex("<.*?>", RegexOption.DOT_MATCHES_ALL).replace(html, "")
    val numeric = Regex("&#x([0-9a-fA-F]+);|&#([0-9]+);").replace(stripped) { m ->
        val code = m.groupValues[1].ifEmpty { null }?.toIntOrNull(16)
            ?: m.groupValues[2].toIntOrNull(10)
            ?: return@replace m.value
        String(Character.toChars(code))
    }
    return Regex("&(\\w+);").replace(numeric) { m ->
        HTML_NAMED[m.groupValues[1]] ?: m.value
    }
}

/**
 * `place2time` : tranche `G == place` dans `listeHeures`, `L` = `08h00` strict
 * (2 chiffres, `h` minuscule). `place > taille` → modulo `taille - 1` (collisions
 * assumées, comme côté TS). Absent/illisible → `IllegalStateException` (le TS
 * jette une `Error` nue, reprise en `DataError` par l'appelant).
 */
fun place2time(heures: JVal?, place: Double): Pair<Int, Int> {
    val list = (heures as? JVal.Arr)?.items ?: throw IllegalStateException("Could not find starting time for place $place")
    val size = list.size
    val p = if (place > size) place % (size - 1) else place
    val slot = list.firstOrNull { ((it as? JVal.Obj)?.fields?.get("G") as? JVal.Num)?.value == p }
        ?: throw IllegalStateException("Could not find starting time for place $place")
    val label = ((slot as JVal.Obj).fields["L"] as? JVal.Str)?.value
        ?: throw IllegalStateException("Could not parse time for place $place")
    val m = RE_HM_COLON.find(label) ?: throw IllegalStateException("Could not parse time for place $place")
    return Pair(m.groupValues[1].toInt(), m.groupValues[2].toInt())
}

/** `JJ/MM/AAAA` (champs locaux, zero-padded) pour les bornes `PagePresence`. */
fun frDate(d: LocalDateTime): String =
    "${d.dayOfMonth.toString().padStart(2, '0')}/${d.monthValue.toString().padStart(2, '0')}/${d.year}"

/** `JJ/MM/AAAA HH:MM:SS` pour les mêmes bornes. */
fun frDateTime(d: LocalDateTime): String =
    "${frDate(d)} ${d.hour.toString().padStart(2, '0')}:${d.minute.toString().padStart(2, '0')}:${d.second.toString().padStart(2, '0')}"

/**
 * Marcheur de JSON (`Resolver.call`) : `converter` appliqué au bout du chemin,
 * `default` court-circuite le reste, `strict` (défaut vrai) jette
 * `ParsingError` — l'erreur du convertisseur est RÉEMBALLÉE sauf si déjà
 * `ParsingError`.
 */
class Resolver(private val root: JVal?) {
    fun <R> call(converter: (JVal?) -> R, path: List<Any>, opts: ResolveOpts<R>? = null): R {
        val strict = opts?.strict ?: true
        var current: JVal? = root
        for (p in path) {
            // `p in Object(...)` côté TS : parent null OU clé absente = arrêt
            // (une valeur `null` PRÉSENTE n'est pas un arrêt : le convertisseur la voit).
            val missing = current == null || when {
                p is String && current is JVal.Obj -> !current.fields.containsKey(p)
                p is Int && current is JVal.Arr -> p < 0 || p >= current.items.size
                else -> true
            }
            if (missing) {
                if (opts?.hasDefault == true) {
                    @Suppress("UNCHECKED_CAST")
                    return opts.default as R
                }
                if (strict) throw ParsingError("Could not follow path", path.map { it.toString() })
                @Suppress("UNCHECKED_CAST")
                return null as R
            }
            // Ici : parent non null ET clé présente (la valeur peut être `null`).
            current = when (current) {
                is JVal.Obj -> current.fields[p as String]
                is JVal.Arr -> current.items.getOrNull(p as Int)
                else -> null
            }
        }
        try {
            return converter(current)
        } catch (e: ParsingError) {
            throw e
        } catch (e: Exception) {
            throw ParsingError("Error while converting value: ${e.message}", path.map { it.toString() })
        }
    }
}

data class ResolveOpts<R>(val default: R? = null, val hasDefault: Boolean = false, val strict: Boolean = true) {
    companion object {
        fun <R> withDefault(default: R): ResolveOpts<R> = ResolveOpts(default, true, true)
        fun <R> lenient(): ResolveOpts<R> = ResolveOpts(null, false, false)
    }
}

/**
 * Base des objets PRONOTE (`PronoteObject`) : `r()` = `call` raccourci.
 * (`toDict` et `Util.get` ne sont pas portés : aucun lecteur ne les utilise.)
 */
abstract class PronoteObject(json: JVal?) {
    protected val resolver = Resolver(json)

    protected fun <R> r(converter: (JVal?) -> R, path: List<Any>, opts: ResolveOpts<R>? = null): R =
        resolver.call(converter, path, opts)
}
