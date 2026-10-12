// ParityJobsMain.kt — pilote JSON du harnais de parité TS <-> Kotlin des jobs (#207).
//
// OUTIL DE TEST, pas du code embarqué : compilé uniquement par
// `tests/unit/kotlin-jobs-parity.test.ts` (jamais par Gradle, jamais dans
// l'APK), dans son propre jar (pas de `main` partagé avec `ParityMain.kt`).
// Protocole : une opération JSON par ligne sur stdin, une réponse JSON
// canonique par ligne sur stdout (clés triées, nombres au format JS).
//
// Le pilote ne connaît QUE les contrats : il parse du JSON en valeurs du
// domaine, appelle le port (`core/GradeDiff.kt`, `core/ExamDetect.kt`,
// `core/NotifyFormat.kt`, `core/RevisionSheet.kt`) et resérialise. Aucune
// logique métier ici — un écart constaté par le test est un écart du PORT.
//
// `RevisionPdf.kt` (`android.graphics`, SDK uniquement) n'est pas compilé ici :
// seul `revisionPdfLines` (pur, dans `RevisionSheet.kt`) est rejoué.
//
// Test-only : `core` reste sans dépendance ; ce fichier non plus (stdlib JDK).
package fr.veryslopnynotes.parity

import fr.veryslopnynotes.core.AbsenceRecord
import fr.veryslopnynotes.core.Assignment
import fr.veryslopnynotes.core.ExamCandidate
import fr.veryslopnynotes.core.Grade
import fr.veryslopnynotes.core.GradeEvent
import fr.veryslopnynotes.core.GradePushSender
import fr.veryslopnynotes.core.PushDevice
import fr.veryslopnynotes.core.RevisionKv
import fr.veryslopnynotes.core.RevisionPushSender
import fr.veryslopnynotes.core.RevisionSheet
import fr.veryslopnynotes.core.TimetableSlot
import fr.veryslopnynotes.core.absenceFingerprint
import fr.veryslopnynotes.core.assembleRevisionSheet
import fr.veryslopnynotes.core.buildRevisionTitle
import fr.veryslopnynotes.core.detectExams
import fr.veryslopnynotes.core.diffGrades
import fr.veryslopnynotes.core.errorCause
import fr.veryslopnynotes.core.examConfidence
import fr.veryslopnynotes.core.fingerprint
import fr.veryslopnynotes.core.formatAbsencePush
import fr.veryslopnynotes.core.formatGradePush
import fr.veryslopnynotes.core.formatRevisionPush
import fr.veryslopnynotes.core.isAbsenceRecord
import fr.veryslopnynotes.core.listRevisionSheets
import fr.veryslopnynotes.core.loadRevisionSheet
import fr.veryslopnynotes.core.localDay
import fr.veryslopnynotes.core.newAbsences
import fr.veryslopnynotes.core.notifyGradeEvents
import fr.veryslopnynotes.core.notifyRevisionSheets
import fr.veryslopnynotes.core.notifySyncResult
import fr.veryslopnynotes.core.parseRevisionSheetJson
import fr.veryslopnynotes.core.revisionIdForExam
import fr.veryslopnynotes.core.revisionPdfLines
import fr.veryslopnynotes.core.revisionSheetJson
import fr.veryslopnynotes.core.saveRevisionSheet
import fr.veryslopnynotes.core.shouldPushForExam
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets
import kotlin.math.abs
import kotlin.math.floor

// --- Modèle JSON minimal (copie volontaire de ParityMain : aucun partage de
// --- fichier avec les autres pilotes, zéro risque de conflit) ----------------

sealed interface J {
    data class Obj(val entries: Map<String, J?>) : J
    data class Arr(val items: List<J?>) : J
    data class Str(val value: String) : J
    data class Num(val value: Double) : J
    data object BoolTrue : J
    data object BoolFalse : J
    data object Null : J
}

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
                    'f' -> out.append('\u000C')
                    'n' -> out.append('\n')
                    'r' -> out.append('\r')
                    't' -> out.append('\t')
                    'u' -> {
                        if (pos + 4 > text.length) throw IllegalArgumentException("\\u tronqué")
                        val hi = text.substring(pos, pos + 4).toInt(16)
                        pos += 4
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

fun jsNumber(d: Double): String {
    if (d.isNaN() || d.isInfinite()) return "null"
    if (d == floor(d) && abs(d) < 1e21) return d.toLong().toString()
    val java = d.toString()
    val ePos = java.indexOf('E')
    if (ePos < 0) return java
    var digits = java.substring(0, ePos).replace("-", "").replace(".", "")
    val exp = java.substring(ePos + 1).toInt()
    val negative = d < 0
    val ad = abs(d)
    if (ad >= 1e21 || ad < 1e-6) {
        digits = digits.trimEnd('0')
        if (digits.isEmpty()) digits = "0"
        val mantissa = if (digits.length == 1) digits else digits[0] + "." + digits.substring(1)
        return (if (negative) "-" else "") + mantissa + "e" + (if (exp < 0) "-" else "+") + abs(exp)
    }
    val point = 1 + exp
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
            '\b' -> out.append("\\b")
            '\u000C' -> out.append("\\f")
            else -> if (c < ' ') out.append("\\u%04x".format(c.code)) else out.append(c)
        }
    }
    return out.toString()
}

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

private fun parseAssignment(o: J.Obj): Assignment = Assignment(
    id = o.str("id") ?: "",
    subject = o.str("subject") ?: "",
    title = o.str("title") ?: "",
    dueDate = o.str("dueDate") ?: "",
    done = o.bool("done") ?: false,
)

private fun parseSlot(o: J.Obj): TimetableSlot = TimetableSlot(
    id = o.str("id") ?: "",
    subject = o.str("subject") ?: "",
    room = o.str("room"),
    start = o.str("start") ?: "",
)

private fun parseExam(o: J.Obj): ExamCandidate = ExamCandidate(
    source = o.str("source") ?: "",
    id = o.str("id") ?: "",
    subject = o.str("subject") ?: "",
    date = o.str("date") ?: "",
    confidence = o.str("confidence") ?: "",
    matched = o.str("matched") ?: "",
)

private fun parseDevice(o: J.Obj): PushDevice = PushDevice(
    id = o.str("id") ?: "",
    tokenHash = o.str("tokenHash") ?: "",
)

private fun parseSheet(o: J.Obj): RevisionSheet = RevisionSheet(
    id = o.str("id") ?: "",
    examId = o.str("examId") ?: "",
    subject = o.str("subject") ?: "",
    date = o.str("date") ?: "",
    title = o.str("title") ?: "",
    body = o.str("body") ?: "",
    sources = (o.entries["sources"] as? J.Arr)?.items?.map { (it as? J.Str)?.value ?: "" } ?: emptyList(),
    templateVersion = o.str("templateVersion") ?: "",
    createdAt = o.str("createdAt") ?: "",
)

// --- Domaine -> JSON canonique -----------------------------------------------

private fun examJson(e: ExamCandidate): J.Obj = J.Obj(
    mapOf(
        "source" to J.Str(e.source),
        "id" to J.Str(e.id),
        "subject" to J.Str(e.subject),
        "date" to J.Str(e.date),
        "confidence" to J.Str(e.confidence),
        "matched" to J.Str(e.matched),
    ),
)

private fun pushJson(title: String, body: String): J.Obj = J.Obj(
    mapOf("title" to J.Str(title), "body" to J.Str(body)),
)

private fun sheetJson(s: RevisionSheet): J.Obj = J.Obj(
    mapOf(
        "id" to J.Str(s.id),
        "examId" to J.Str(s.examId),
        "subject" to J.Str(s.subject),
        "date" to J.Str(s.date),
        "title" to J.Str(s.title),
        "body" to J.Str(s.body),
        "sources" to J.Arr(s.sources.map { J.Str(it) }),
        "templateVersion" to J.Str(s.templateVersion),
        "createdAt" to J.Str(s.createdAt),
    ),
)

private class RecGradeSender(
    val failOn: Set<String>,
    override val delivers: Boolean,
    val calls: MutableList<Triple<String, String, String>>,
) : GradePushSender {
    override fun send(deviceTokenHash: String, title: String, body: String) {
        if (failOn.contains(deviceTokenHash)) throw IllegalStateException("down")
        calls.add(Triple(deviceTokenHash, title, body))
    }
}

private class RecRevisionSender(
    val calls: MutableList<Triple<String, String, String>>,
) : RevisionPushSender {
    override fun send(deviceTokenHash: String, title: String, body: String) {
        calls.add(Triple(deviceTokenHash, title, body))
    }
}

private fun callsJson(calls: List<Triple<String, String, String>>): J.Arr = J.Arr(
    calls.map { (hash, title, body) ->
        J.Obj(mapOf("hash" to J.Str(hash), "title" to J.Str(title), "body" to J.Str(body)))
    },
)

private class MemKv : RevisionKv {
    val map = LinkedHashMap<String, ByteArray>()
    override fun get(key: String): ByteArray? = map[key]
    override fun set(key: String, value: ByteArray) {
        map[key] = value
    }
}

private val kvStore = MemKv()

// --- Opérations --------------------------------------------------------------

private fun runOp(op: J.Obj): J? {
    return when (op.str("op")) {
        "echo" -> op.entries["value"]
        "num" -> op.entries["value"]
        "fingerprint" -> {
            val g = parseGrade(op.obj("grade")!!)
            J.Obj(mapOf("fingerprint" to J.Str(fingerprint(g))))
        }
        "diffGrades" -> {
            val prevNodes = (op.entries["previous"] as? J.Arr)?.items?.map { it as J.Obj } ?: emptyList()
            val curNodes = (op.entries["current"] as? J.Arr)?.items?.map { it as J.Obj } ?: emptyList()
            val curById = curNodes.associate { (it.str("id") ?: "") to it }
            val diff = diffGrades(prevNodes.map { parseGrade(it) }, curNodes.map { parseGrade(it) })
            J.Obj(
                mapOf(
                    "added" to J.Arr(diff.added.map { curById[it.id] ?: J.Null }),
                    "changed" to J.Arr(diff.changed.map { curById[it.id] ?: J.Null }),
                    "removed" to J.Arr(diff.removed.map { J.Str(it) }),
                ),
            )
        }
        "diffPrints" -> {
            val prints = op.obj("previous")?.entries?.mapValues { (_, v) -> (v as? J.Str)?.value ?: "" } ?: emptyMap()
            val curNodes = (op.entries["current"] as? J.Arr)?.items?.map { it as J.Obj } ?: emptyList()
            val curById = curNodes.associate { (it.str("id") ?: "") to it }
            val diff = fr.veryslopnynotes.core.diffAgainstPrints(prints, curNodes.map { parseGrade(it) })
            J.Obj(
                mapOf(
                    "added" to J.Arr(diff.added.map { curById[it.id] ?: J.Null }),
                    "changed" to J.Arr(diff.changed.map { curById[it.id] ?: J.Null }),
                    "removed" to J.Arr(diff.removed.map { J.Str(it) }),
                ),
            )
        }
        "examConfidence" -> {
            val hit = examConfidence(op.str("title") ?: "")
            if (hit == null) J.Null
            else J.Obj(mapOf("confidence" to J.Str(hit.confidence), "matched" to J.Str(hit.matched)))
        }
        "detectExams" -> {
            val assignments = (op.entries["assignments"] as? J.Arr)?.items?.map { parseAssignment(it as J.Obj) } ?: emptyList()
            val entries = (op.entries["entries"] as? J.Arr)?.items?.map { parseSlot(it as J.Obj) } ?: emptyList()
            J.Arr(detectExams(assignments, entries).map { examJson(it) })
        }
        "formatGradePush" -> {
            val p = formatGradePush(parseGrade(op.obj("grade")!!))
            pushJson(p.title, p.body)
        }
        "errorCause" -> {
            val name = (op.entries["name"] as? J.Str)?.value
            val cause = errorCause(name, op.str("message") ?: "")
            J.Obj(mapOf("cause" to J.Str(cause)))
        }
        "localDay" -> J.Obj(mapOf("day" to J.Str(localDay(op.str("iso") ?: ""))))
        "notifyGrades" -> {
            val events = (op.entries["events"] as? J.Arr)?.items?.map { e ->
                val o = e as J.Obj
                val data = o.obj("data")?.let { runCatching { parseGrade(it) }.getOrNull() }
                GradeEvent(type = o.str("type") ?: "", data = data)
            } ?: emptyList()
            val devices = (op.entries["devices"] as? J.Arr)?.items?.map { parseDevice(it as J.Obj) } ?: emptyList()
            val failOn = (op.entries["failOn"] as? J.Arr)?.items?.mapNotNull { (it as? J.Str)?.value }?.toSet() ?: emptySet()
            val delivers = op.bool("delivers") ?: true
            val calls = mutableListOf<Triple<String, String, String>>()
            val sender = RecGradeSender(failOn, delivers, calls)
            val logs = mutableListOf<String>()
            val res = if (op.bool("firstRun") == true) {
                notifySyncResult(true, events, devices, sender) { logs.add(it) }
            } else {
                notifyGradeEvents(events, devices, sender) { logs.add(it) }
            }
            J.Obj(
                mapOf(
                    "sent" to J.Num(res.sent.toDouble()),
                    "failed" to J.Num(res.failed.toDouble()),
                    "errors" to J.Arr(res.errors.map { J.Str(it) }),
                    "events" to J.Num(res.events.toDouble()),
                    "devices" to J.Num(res.devices.toDouble()),
                    "calls" to callsJson(calls),
                    "logs" to J.Arr(logs.map { J.Str(it) }),
                ),
            )
        }
        "absenceFingerprint" -> {
            val r = parseRecord(op.obj("record")!!)
            J.Obj(mapOf("fingerprint" to J.Str(absenceFingerprint(r))))
        }
        "newAbsences" -> {
            val previous = (op.entries["previous"] as? J.Arr)?.items?.mapNotNull { (it as? J.Str)?.value } ?: emptyList()
            val nodes = (op.entries["records"] as? J.Arr)?.items?.map { it as J.Obj } ?: emptyList()
            val byId = nodes.associate { (it.str("id") ?: "") to it }
            val fresh = newAbsences(previous, nodes.map { parseRecord(it) })
            J.Arr(fresh.map { byId[it.id] ?: J.Null })
        }
        "formatAbsencePush" -> {
            val p = formatAbsencePush(parseRecord(op.obj("record")!!))
            pushJson(p.title, p.body)
        }
        "revisionId" -> J.Obj(mapOf("id" to J.Str(revisionIdForExam(op.str("examId") ?: ""))))
        "revisionTitle" -> J.Obj(mapOf("title" to J.Str(buildRevisionTitle(parseExam(op.obj("exam")!!)))))
        "shouldPush" -> if (shouldPushForExam(parseExam(op.obj("exam")!!))) J.BoolTrue else J.BoolFalse
        "formatRevisionPush" -> {
            val p = formatRevisionPush(parseExam(op.obj("exam")!!))
            pushJson(p.title, p.body)
        }
        "assemble" -> {
            val exam = parseExam(op.obj("exam")!!)
            val ficheText = op.str("ficheText") ?: ""
            val sources = (op.entries["sources"] as? J.Arr)?.items?.map { (it as? J.Str)?.value ?: "" } ?: emptyList()
            val now = op.str("now") ?: "2026-10-02T06:00:00.000Z"
            try {
                J.Obj(mapOf("sheet" to sheetJson(assembleRevisionSheet(exam, ficheText, sources, now))))
            } catch (err: IllegalArgumentException) {
                J.Obj(mapOf("refus" to J.Str(err.message ?: "")))
            }
        }
        "notifyRevision" -> {
            val sheets = (op.entries["sheets"] as? J.Arr)?.items?.map { parseSheet(it as J.Obj) } ?: emptyList()
            val exams = (op.entries["exams"] as? J.Arr)?.items?.map { parseExam(it as J.Obj) } ?: emptyList()
            val devices = (op.entries["devices"] as? J.Arr)?.items?.map { parseDevice(it as J.Obj) } ?: emptyList()
            val calls = mutableListOf<Triple<String, String, String>>()
            val res = notifyRevisionSheets(sheets, exams.associateBy { it.id }, devices, RecRevisionSender(calls)) {}
            J.Obj(
                mapOf(
                    "sent" to J.Num(res.sent.toDouble()),
                    "failed" to J.Num(res.failed.toDouble()),
                    "sheets" to J.Num(res.sheets.toDouble()),
                    "devices" to J.Num(res.devices.toDouble()),
                    "calls" to callsJson(calls),
                ),
            )
        }
        "kvReset" -> {
            kvStore.map.clear()
            J.Str("ok")
        }
        "kvSave" -> {
            saveRevisionSheet(kvStore, parseSheet(op.obj("sheet")!!))
            J.Str("ok")
        }
        "kvLoad" -> {
            val found = loadRevisionSheet(kvStore, op.str("id") ?: "")
            if (found == null) J.Null else sheetJson(found)
        }
        "kvList" -> J.Arr(listRevisionSheets(kvStore).map { sheetJson(it) })
        "kvRawSet" -> {
            kvStore.map[op.str("key") ?: ""] = (op.str("value") ?: "").toByteArray(StandardCharsets.UTF_8)
            J.Str("ok")
        }
        "kvJson" -> {
            // Aller-retour JSON exact d'une fiche (sérialisation du port seule).
            val back = parseRevisionSheetJson(revisionSheetJson(parseSheet(op.obj("sheet")!!)))
            if (back == null) J.Null else sheetJson(back)
        }
        "pdfLines" -> {
            try {
                J.Obj(mapOf("lines" to J.Arr(revisionPdfLines(parseSheet(op.obj("sheet")!!)).map { J.Str(it) })))
            } catch (err: IllegalArgumentException) {
                J.Obj(mapOf("refus" to J.Str(err.message ?: "")))
            }
        }
        "isAbsence" -> if (isAbsenceRecord(parseRecord(op.obj("record")!!))) J.BoolTrue else J.BoolFalse
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
            stderr.println("pilote: ${err.message}")
            stdout.println("{\"error\":${canonical(J.Str(err.message ?: "inconnu"))}}")
        }
    }
}
