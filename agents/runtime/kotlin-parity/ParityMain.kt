// ParityMain.kt — pilote JSON du harnais de parité TS <-> Kotlin (#202, #203).
//
// Ce fichier est un OUTIL DE TEST, pas du code embarqué : il n'est compilé que
// par `tests/unit/kotlin-domain-parity.test.ts` (jamais par Gradle, jamais dans
// l'APK). Protocole : une opération JSON par ligne sur stdin, une réponse JSON
// canonique par ligne sur stdout (clés triées, nombres au format JS — voir
// `jsNumber`, car `Double.toString` écrit `1.0E-4` là où `JSON.stringify`
// écrit `0.0001`).
//
// Le pilote ne connaît QUE le contrat 0.7.0 : il parse du JSON en valeurs du
// domaine, appelle le code porté (`core/Averages.kt`, `core/Attendance.kt`,
// `core/Capabilities.kt`) et resérialise. Aucune logique métier ici — un écart
// constaté par le test est un écart du PORT, jamais du pilote.
//
// Point délicat : le `null` JSON. Le mapper TS n'émet JAMAIS de `null` explicite
// (champ absent = `undefined` = clé omise), donc les fixtures de parité omettent
// les clés. Sauf `coefficient: null`, que le contrat TS tolère à l'exécution
// (`isUsable` le rejette : `Number.isFinite(null) == false`) : le pilote
// l'émule par `NaN`, qui suit exactement le même chemin côté Kotlin
// (`!NaN.isFinite()` → ignorée). Le test de parité le prouve cas par cas.
package fr.veryslopnynotes.parity

import fr.veryslopnynotes.core.AbsenceRecord
import fr.veryslopnynotes.core.AttendancePeriod
import fr.veryslopnynotes.core.Capabilities
import fr.veryslopnynotes.core.CapabilityProbe
import fr.veryslopnynotes.core.ComputeAveragesOptions
import fr.veryslopnynotes.core.Grade
import fr.veryslopnynotes.core.Period
import fr.veryslopnynotes.core.ProvidedAverages
import fr.veryslopnynotes.core.attendancePeriods
import fr.veryslopnynotes.core.averageWith
import fr.veryslopnynotes.core.computeAverages
import fr.veryslopnynotes.core.isoMillis
import fr.veryslopnynotes.core.providedAveragesFor
import fr.veryslopnynotes.core.subjectAlgorithmAverage
import fr.veryslopnynotes.core.subjectAverage
import fr.veryslopnynotes.core.subjectKey
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets
import kotlin.math.abs
import kotlin.math.floor

// --- Modèle JSON minimal -----------------------------------------------------

sealed interface J {
    data class Obj(val entries: Map<String, J?>) : J
    data class Arr(val items: List<J?>) : J
    data class Str(val value: String) : J
    data class Num(val value: Double) : J
    data object BoolTrue : J
    data object BoolFalse : J
    data object Null : J
}

/** Parseur JSON strict (RFC 8259) : objets, tableaux, chaînes (échapées `\uXXXX`
 *  et paires de substitution comprises), nombres, `true`/`false`/`null`. */
private class JsonParser(private val text: String) {
    private var pos = 0

    fun parse(): J? {
        skipWs()
        val v = parseValue() ?: throw IllegalArgumentException("JSON vide")
        skipWs()
        if (pos != text.length) throw IllegalArgumentException("traîne à $pos")
        return v
    }

    private fun skipWs() {
        while (pos < text.length && text[pos] in " \t\n\r") pos++
    }

    private fun parseValue(): J? {
        skipWs()
        if (pos >= text.length) throw IllegalArgumentException("fin inattendue")
        return when (val c = text[pos]) {
            '{' -> parseObj()
            '[' -> parseArr()
            '"' -> J.Str(parseStr())
            't' -> { expect("true"); J.BoolTrue }
            'f' -> { expect("false"); J.BoolFalse }
            'n' -> { expect("null"); J.Null }
            '-', in '0'..'9' -> parseNum()
            else -> throw IllegalArgumentException("caractère '$c' à $pos")
        }
    }

    private fun expect(word: String) {
        if (!text.startsWith(word, pos)) throw IllegalArgumentException("attendu $word à $pos")
        pos += word.length
    }

    private fun parseObj(): J.Obj {
        pos++ // {
        val map = LinkedHashMap<String, J?>()
        skipWs()
        if (pos < text.length && text[pos] == '}') {
            pos++
            return J.Obj(map)
        }
        while (true) {
            skipWs()
            if (pos >= text.length || text[pos] != '"') throw IllegalArgumentException("clé attendue à $pos")
            val key = parseStr()
            skipWs()
            if (pos >= text.length || text[pos] != ':') throw IllegalArgumentException("':' attendu à $pos")
            pos++
            map[key] = parseValue()
            skipWs()
            if (pos >= text.length) throw IllegalArgumentException("fin d'objet inattendue")
            if (text[pos] == '}') {
                pos++
                return J.Obj(map)
            }
            if (text[pos] != ',') throw IllegalArgumentException("',' attendue à $pos")
            pos++
        }
    }

    private fun parseArr(): J.Arr {
        pos++ // [
        val list = mutableListOf<J?>()
        skipWs()
        if (pos < text.length && text[pos] == ']') {
            pos++
            return J.Arr(list)
        }
        while (true) {
            list.add(parseValue())
            skipWs()
            if (pos >= text.length) throw IllegalArgumentException("fin de tableau inattendue")
            if (text[pos] == ']') {
                pos++
                return J.Arr(list)
            }
            if (text[pos] != ',') throw IllegalArgumentException("',' attendue à $pos")
            pos++
        }
    }

    private fun parseStr(): String {
        pos++ // "
        val out = StringBuilder()
        while (true) {
            if (pos >= text.length) throw IllegalArgumentException("chaîne non fermée")
            val c = text[pos++]
            if (c == '"') return out.toString()
            if (c == '\\') {
                if (pos >= text.length) throw IllegalArgumentException("échapée tronquée")
                when (val e = text[pos++]) {
                    '"', '\\', '/' -> out.append(e)
                    'b' -> out.append('\b')
                    'f' -> out.append('')
                    'n' -> out.append('\n')
                    'r' -> out.append('\r')
                    't' -> out.append('\t')
                    'u' -> {
                        if (pos + 4 > text.length) throw IllegalArgumentException("\\u tronqué")
                        val hi = text.substring(pos, pos + 4).toInt(16)
                        pos += 4
                        // Paire de substitution : `\uD83D\uDE00`.
                        if (hi in 0xD800..0xDBFF && pos + 6 <= text.length &&
                            text[pos] == '\\' && text[pos + 1] == 'u'
                        ) {
                            val lo = text.substring(pos + 2, pos + 6).toInt(16)
                            if (lo in 0xDC00..0xDFFF) {
                                out.appendCodePoint(0x10000 + ((hi - 0xD800) shl 10) + (lo - 0xDC00))
                                pos += 6
                                continue
                            }
                        }
                        out.append(hi.toChar())
                    }
                    else -> throw IllegalArgumentException("échapée '\\$e' à $pos")
                }
                continue
            }
            if (c < ' ') throw IllegalArgumentException("contrôle brut en chaîne à $pos")
            out.append(c)
        }
    }

    private fun parseNum(): J.Num {
        val start = pos
        if (pos < text.length && text[pos] == '-') pos++
        while (pos < text.length && text[pos] in '0'..'9') pos++
        if (pos < text.length && text[pos] == '.') {
            pos++
            while (pos < text.length && text[pos] in '0'..'9') pos++
        }
        if (pos < text.length && (text[pos] == 'e' || text[pos] == 'E')) {
            pos++
            if (pos < text.length && (text[pos] == '+' || text[pos] == '-')) pos++
            while (pos < text.length && text[pos] in '0'..'9') pos++
        }
        return J.Num(text.substring(start, pos).toDouble())
    }
}

/**
 * Rendu d'un `Double` à la `JSON.stringify` : entier si le nombre est entier
 * (`20`, pas `20.0`), décimal le plus court sinon (`0.30000000000000004`, pas
 * `0.3`), exponentiel au-delà de `1e21` et sous `1e-6` (`1e+21`, pas `1.0E21`).
 * `NaN`/`Infini` → `null`, comme `JSON.stringify`.
 */
fun jsNumber(d: Double): String {
    if (d.isNaN() || d.isInfinite()) return "null"
    if (d == floor(d) && abs(d) < 1e21) return d.toLong().toString()
    val java = d.toString()
    val ePos = java.indexOf('E')
    if (ePos < 0) return java
    var digits = java.substring(0, ePos).replace("-", "").replace(".", "")
    val exp = java.substring(ePos + 1).toInt()
    val negative = d < 0
    // Sous 1e-6 ou au-delà de 1e21 : forme exponentielle `mEe`.
    val ad = abs(d)
    if (ad >= 1e21 || ad < 1e-6) {
        digits = digits.trimEnd('0')
        if (digits.isEmpty()) digits = "0"
        val mantissa = if (digits.length == 1) digits else digits[0] + "." + digits.substring(1)
        return (if (negative) "-" else "") + mantissa + "e" + (if (exp < 0) "-" else "+") + abs(exp)
    }
    // Entre 1e-6 et 1e-3 : Java écrit `1.0E-4`, JS `0.0001` — on déplie.
    var point = 1 + exp
    var body = digits.trimStart('0')
    if (body.isEmpty()) return "0"
    val out = StringBuilder()
    if (negative) out.append('-')
    if (point <= 0) {
        out.append("0.")
        repeat(-point) { out.append('0') }
        out.append(body)
    } else if (point >= body.length) {
        out.append(body)
        repeat(point - body.length) { out.append('0') }
    } else {
        out.append(body.substring(0, point))
        out.append('.')
        out.append(body.substring(point))
    }
    var s = out.toString()
    if (s.contains('.')) {
        s = s.trimEnd('0').trimEnd('.')
    }
    return s
}

private fun escapeStr(s: String): String {
    val out = StringBuilder()
    for (c in s) {
        when (c) {
            '"' -> out.append("\\\"")
            '\\' -> out.append("\\\\")
            '\n' -> out.append("\\n")
            '\r' -> out.append("\\r")
            '\t' -> out.append("\\t")
            '' -> out.append("\\b")
            '' -> out.append("\\f")
            else -> if (c < ' ') out.append("\\u%04x".format(c.code)) else out.append(c)
        }
    }
    return out.toString()
}

/**
 * JSON canonique : clés triées (l'ordre d'insertion dépend de l'implémentation,
 * jamais du résultat), `null` Kotlin = clé omise, `J.Null` = `null` explicite.
 */
fun canonical(v: J?): String = when (v) {
    null -> "null"
    is J.Null -> "null"
    is J.BoolTrue -> "true"
    is J.BoolFalse -> "false"
    is J.Num -> jsNumber(v.value)
    is J.Str -> "\"${escapeStr(v.value)}\""
    is J.Arr -> v.items.joinToString(",", "[", "]") { canonical(it) }
    is J.Obj -> v.entries.entries
        .filter { it.value != null }
        .sortedBy { it.key }
        .joinToString(",", "{", "}") { (k, item) -> "\"${escapeStr(k)}\":${canonical(item)}" }
}

// --- JSON -> domaine ---------------------------------------------------------

private fun J.Obj.str(key: String): String? = (entries[key] as? J.Str)?.value

private fun J.Obj.num(key: String): Double? = (entries[key] as? J.Num)?.value

private fun J.Obj.bool(key: String): Boolean? = when (entries[key]) {
    is J.BoolTrue -> true
    is J.BoolFalse -> false
    else -> null
}

private fun J.Obj.obj(key: String): J.Obj? = entries[key] as? J.Obj

private fun J.Obj.arr(key: String): List<J?>? = (entries[key] as? J.Arr)?.items

/**
 * Nombre JSON -> `Double` du domaine. `null`/absent/mal typé :
 * - champ requis (`value`, `scale`) : `NaN` = inexploitable (`isUsable` le
 *   rejette, comme `Number.isFinite(undefined)` côté TS) ;
 * - `coefficient` : `NaN` aussi — c'est l'émulation exacte du `null` TS
 *   (`isUsable` le rejette, `weightOf` retombe sur 1) ;
 * - champ annexe : `null` (inutilisé par les algorithmes).
 */
private fun J.Obj.reqNum(key: String): Double = num(key) ?: Double.NaN

private fun J.Obj.optNum(key: String): Double? = num(key)

private fun parseGrade(o: J.Obj): Grade = Grade(
    id = o.str("id") ?: "",
    accountId = o.str("accountId") ?: "",
    subject = o.str("subject") ?: "",
    value = o.reqNum("value"),
    scale = o.reqNum("scale"),
    coefficient = if (o.entries.containsKey("coefficient")) o.num("coefficient") ?: Double.NaN else null,
    date = o.str("date") ?: "",
    classAverage = o.optNum("classAverage"),
    classMin = o.optNum("classMin"),
    classMax = o.optNum("classMax"),
    periodId = o.str("periodId"),
    bonus = o.bool("bonus"),
    optional = o.bool("optional"),
    label = o.str("label"),
    teacher = o.str("teacher"),
)

private fun parseGrades(v: J?): List<Grade> =
    (v as? J.Arr)?.items?.map { parseGrade(it as J.Obj) } ?: emptyList()

private fun parseProvided(o: J.Obj?): ProvidedAverages? {
    if (o == null) return null
    val subjects = o.obj("subjects")?.entries?.mapValues { (_, v) ->
        (v as? J.Num)?.value?.takeIf { it.isFinite() } ?: Double.NaN
    }
    return ProvidedAverages(
        periodId = o.str("periodId"),
        general = o.num("general"),
        subjects = subjects,
    )
}

private fun parseRecord(o: J.Obj): AbsenceRecord = AbsenceRecord(
    id = o.str("id") ?: "",
    accountId = o.str("accountId") ?: "",
    kind = o.str("kind") ?: "",
    date = o.str("date") ?: "",
    dateEnd = o.str("dateEnd"),
    subject = o.str("subject"),
    motif = o.str("motif"),
    periodId = o.str("periodId"),
    durationMinutes = o.optNum("durationMinutes"),
    justified = o.bool("justified"),
)

private fun parsePeriod(o: J.Obj): Period = Period(
    id = o.str("id") ?: "",
    name = o.str("name") ?: "",
    start = o.str("start") ?: "",
    end = o.str("end") ?: "",
)

private fun parseCapabilities(o: J.Obj?): Capabilities? {
    if (o == null) return null
    return Capabilities(
        accountId = o.str("accountId") ?: "",
        tabs = o.arr("tabs")?.mapNotNull { (it as? J.Str)?.value } ?: emptyList(),
        fetchedAt = o.str("fetchedAt") ?: "",
    )
}

// --- Domaine -> JSON canonique -----------------------------------------------

private fun gradeInfluenceJson(g: fr.veryslopnynotes.core.GradeInfluence): J.Obj = J.Obj(
    mapOf("gradeId" to J.Str(g.gradeId), "subject" to J.Str(g.subject), "impact" to J.Num(g.impact)),
)

private fun reportJson(r: fr.veryslopnynotes.core.AveragesReport): J.Obj = J.Obj(
    mapOf(
        "algorithm" to J.Str(r.algorithm),
        "periodId" to (r.periodId?.let { J.Str(it) } ?: J.Null),
        "general" to J.Obj(
            mapOf(
                "value" to (r.general.value?.let { J.Num(it) } ?: J.Null),
                "origin" to J.Str(r.general.origin),
                "subjectCount" to J.Num(r.general.subjectCount.toDouble()),
            ),
        ),
        "subjects" to J.Arr(
            r.subjects.map { s ->
                J.Obj(
                    mapOf(
                        "subject" to J.Str(s.subject),
                        "value" to (s.value?.let { J.Num(it) } ?: J.Null),
                        "origin" to J.Str(s.origin),
                        "gradeCount" to J.Num(s.gradeCount.toDouble()),
                    ),
                )
            },
        ),
        "history" to J.Arr(
            r.history.map { h ->
                J.Obj(mapOf("date" to J.Str(h.date), "value" to (h.value?.let { J.Num(it) } ?: J.Null)))
            },
        ),
        "influences" to J.Arr(r.influences.map { gradeInfluenceJson(it) }),
    ),
)

private fun attendanceJson(periods: List<AttendancePeriod>): J.Arr = J.Arr(
    periods.map { p ->
        J.Obj(
            mapOf(
                "periodId" to J.Str(p.periodId),
                "name" to p.name?.let { J.Str(it) },
                "absences" to J.Num(p.absences.toDouble()),
                "late" to J.Num(p.late.toDouble()),
                "missingMinutes" to J.Num(p.missingMinutes),
            ),
        )
    },
)

private fun capabilitiesJson(c: Capabilities): J.Obj = J.Obj(
    mapOf(
        "accountId" to J.Str(c.accountId),
        "tabs" to J.Arr(c.tabs.map { J.Str(it) }),
        "fetchedAt" to J.Str(c.fetchedAt),
    ),
)

// --- Opérations --------------------------------------------------------------

private fun runOp(op: J.Obj): J? {
    return when (op.str("op")) {
        "echo" -> op.entries["value"]
        "num" -> op.entries["value"]
        "subjectKey" -> J.Obj(mapOf("value" to J.Str(subjectKey(op.str("value") ?: ""))))
        "subjectAverage" -> {
            val v = subjectAverage(parseGrades(op.entries["grades"]))
            J.Obj(mapOf("value" to (v?.let { J.Num(it) } ?: J.Null)))
        }
        "averageWith" -> {
            val v = averageWith(op.str("algorithm"), parseGrades(op.entries["grades"]))
            J.Obj(mapOf("value" to (v?.let { J.Num(it) } ?: J.Null)))
        }
        "averages" -> {
            val options = op.obj("options")
            reportJson(
                computeAverages(
                    parseGrades(op.entries["grades"]),
                    ComputeAveragesOptions(
                        algorithm = options?.str("algorithm"),
                        periodId = options?.str("periodId"),
                        provided = parseProvided(options?.obj("provided")),
                    ),
                ),
            )
        }
        "providedFor" -> {
            val byPeriod = op.obj("byPeriod")?.entries?.mapValues { (_, v) -> parseProvided(v as? J.Obj) }
            val found = providedAveragesFor(byPeriod, op.str("periodId"))
            if (found == null) J.Null
            else J.Obj(
                mapOf(
                    "periodId" to (found.periodId?.let { J.Str(it) } ?: J.Null),
                    "general" to (found.general?.let { J.Num(it) } ?: J.Null),
                    "subjects" to found.subjects?.let { subjects ->
                        J.Obj(subjects.mapValues { (_, n) -> J.Num(n) as J? })
                    },
                ),
            )
        }
        "attendance" -> {
            val records = (op.entries["records"] as? J.Arr)?.items?.map { parseRecord(it as J.Obj) } ?: emptyList()
            val periods = (op.entries["periods"] as? J.Arr)?.items?.map { parsePeriod(it as J.Obj) } ?: emptyList()
            attendanceJson(attendancePeriods(records, periods))
        }
        "probe" -> {
            val probe = op.obj("probe")?.entries?.mapValues { (_, v) -> v == J.BoolTrue } ?: emptyMap()
            capabilitiesJson(
                CapabilityProbe.fromProbe(
                    op.str("accountId") ?: "",
                    probe,
                    op.str("at") ?: "",
                ),
            )
        }
        "disabled" -> J.Arr(
            CapabilityProbe.disabled(parseCapabilities(op.obj("caps"))).map { J.Str(it) },
        )
        "enabled" -> if (CapabilityProbe.enabled(parseCapabilities(op.obj("caps")), op.str("tab") ?: "")) {
            J.BoolTrue
        } else {
            J.BoolFalse
        }
        "isoMillis" -> {
            val v = isoMillis(op.str("value"))
            J.Obj(mapOf("value" to (v?.let { J.Num(it.toDouble()) } ?: J.Null)))
        }
        else -> throw IllegalArgumentException("opération inconnue : ${op.str("op")}")
    }
}

fun main() {
    val stdin: BufferedReader = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    val stdout = PrintStream(System.out, true, StandardCharsets.UTF_8)
    val stderr = PrintStream(System.err, true, StandardCharsets.UTF_8)
    while (true) {
        val line = stdin.readLine() ?: break
        if (line.isBlank()) continue
        try {
            stdout.println(canonical(runOp(JsonParser(line).parse() as J.Obj)))
        } catch (err: Exception) {
            // Erreur de PILOTE (entrée malformée, op inconnue) : le harnais la
            // voit comme un échec explicite, jamais comme un résultat vide.
            stderr.println("pilote: ${err.message}")
            stdout.println("{\"error\":${canonical(J.Str(err.message ?: "inconnu"))}}")
        }
    }
}
