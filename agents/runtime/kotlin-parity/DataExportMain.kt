// DataExportMain.kt — pilote JSON de l'export portable (#857).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-data-export.test.ts`
// (jamais Gradle, jamais l'APK).
package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.LessonNote
import fr.veryslopnynotes.core.TeacherChatMessage
import fr.veryslopnynotes.core.TeacherChatSourceMeta
import fr.veryslopnynotes.core.TeacherThread
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun obj(vararg pairs: Pair<String, JVal>): JVal.Obj {
    val fields = LinkedHashMap<String, JVal>()
    for ((key, value) in pairs) fields[key] = value
    return JVal.Obj(fields)
}

private fun str(value: String): JVal = JVal.Str(value)

private fun num(value: Int): JVal = JVal.Num(value.toDouble())

private fun arr(values: List<JVal>): JVal = JVal.Arr(values)

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.arr(key: String): List<JVal.Obj> =
    (fields[key] as? JVal.Arr)?.items?.mapNotNull { it as? JVal.Obj } ?: emptyList()

private fun JVal.Obj.strings(key: String): List<String> =
    (fields[key] as? JVal.Arr)?.items?.mapNotNull { (it as? JVal.Str)?.value } ?: emptyList()

private fun JVal.Obj.obj(key: String): JVal.Obj? = fields[key] as? JVal.Obj

private fun noteOf(node: JVal.Obj): LessonNote = LessonNote(
    id = node.str("id") ?: "",
    subject = node.str("subject") ?: "",
    title = node.str("title") ?: "",
    text = node.str("text") ?: "",
    createdAt = node.str("createdAt") ?: "",
)

private fun messageOf(node: JVal.Obj): TeacherChatMessage = TeacherChatMessage(
    role = node.str("role") ?: "",
    text = node.str("text") ?: "",
    sources = node.strings("sources"),
    unsourced = (node.fields["unsourced"] as? JVal.Bool)?.value ?: false,
    context = node.arr("context").map {
        TeacherChatSourceMeta(
            type = it.str("type") ?: "",
            label = it.str("label") ?: "",
            chars = ((it.fields["chars"] as? JVal.Num)?.value ?: 0.0).toInt(),
            truncated = (it.fields["truncated"] as? JVal.Bool)?.value ?: false,
        )
    },
    summaryChars = ((node.fields["summaryChars"] as? JVal.Num)?.value ?: 0.0).toInt(),
)

private fun chatOf(node: JVal.Obj?): TeacherThread =
    TeacherThread(
        subject = node?.str("subject") ?: "",
        messages = node?.arr("messages")?.map { messageOf(it) } ?: emptyList(),
    )

private fun manualOf(node: JVal.Obj?): ManualSnapshot? {
    if (node == null) return null
    return ManualSnapshot(
        classLabel = node.str("classLabel") ?: "",
        subjects = node.strings("subjects"),
        disabledSubjects = node.strings("disabledSubjects"),
        docs = node.arr("docs").map {
            ManualDocSnapshot(
                title = it.str("title") ?: "",
                subject = it.str("subject") ?: "",
                page = ((it.fields["page"] as? JVal.Num)?.value ?: 0.0).toInt(),
                excerpt = it.str("excerpt") ?: "",
            )
        },
    )
}

private fun subjectOf(node: JVal.Obj): SubjectSnapshot = SubjectSnapshot(
    subject = node.str("subject") ?: "",
    color = node.str("color")?.takeIf { it.isNotEmpty() },
    emoji = node.str("emoji")?.takeIf { it.isNotEmpty() },
    label = node.str("label")?.takeIf { it.isNotEmpty() },
    updatedAt = node.str("updatedAt") ?: "",
)

private fun summary(doc: ExportDocument): JVal.Obj = obj(
    "schemaVersion" to num(doc.manifest.schemaVersion),
    "exportedAt" to str(doc.exportedAt),
    "gradeCount" to num(doc.grades.size),
    "gradeIds" to arr(doc.grades.map { str(it.str("id") ?: "") }),
    "noteIds" to arr(doc.notes.map { str(it.id) }),
    "noteTexts" to arr(doc.notes.map { str(it.text) }),
    "chatSubject" to str(doc.teacherChat.subject),
    "chatTexts" to arr(doc.teacherChat.messages.map { str(it.text) }),
    "manualClass" to str(doc.manual?.classLabel ?: ""),
    "manualDocs" to num(doc.manual?.docs?.size ?: 0),
    "manualExcerpts" to arr(doc.manual?.docs?.map { str(it.excerpt) } ?: emptyList()),
    "subjectNames" to arr(doc.subjects.map { str(it.subject) }),
    "readIds" to arr(doc.newsReadIds.map { str(it) }),
    "sections" to arr(
        doc.manifest.sections.map {
            obj("name" to str(it.name), "count" to num(it.count), "skipped" to num(it.skipped))
        },
    ),
    "withheld" to arr(doc.manifest.withheld.map { str(it) }),
)

private fun driver(op: JVal.Obj): JVal = when (op.str("op")) {
    "build" -> {
        val input = ExportInput(
            exportedAt = op.str("exportedAt") ?: "2026-11-03T00:00:00Z",
            grades = op.strings("grades"),
            notes = op.arr("notes").map { noteOf(it) },
            teacherChat = chatOf(op.obj("teacherChat")),
            manual = manualOf(op.obj("manual")),
            subjects = op.arr("subjects").map { subjectOf(it) },
            newsReadIds = op.strings("newsReadIds"),
        )
        val json = buildDataExport(input)
        val parsed = parseDataExport(json)
        obj(
            "json" to str(json),
            "bytes" to num(json.toByteArray(Charsets.UTF_8).size),
            "ok" to JVal.Bool(parsed != null),
            "summary" to (parsed?.let { summary(it) } ?: JVal.Null),
        )
    }
    "parse" -> {
        val raw = op.str("json") ?: ""
        val parsed = parseDataExport(raw)
        obj(
            "ok" to JVal.Bool(parsed != null),
            "summary" to (parsed?.let { summary(it) } ?: JVal.Null),
        )
    }
    else -> throw IllegalArgumentException("pilote: opération inconnue : ${op.str("op")}")
}

fun main() {
    val stdin = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    val stdout = PrintStream(System.out, true, StandardCharsets.UTF_8.name())
    val stderr = PrintStream(System.err, true, StandardCharsets.UTF_8.name())
    while (true) {
        val line = stdin.readLine() ?: break
        if (line.isBlank()) continue
        try {
            stdout.println(Json.stringify(driver(Json.parse(line) as JVal.Obj)))
        } catch (e: Exception) {
            stderr.println("port: ${e.javaClass.simpleName}: ${e.message}")
            stdout.println(
                Json.stringify(
                    obj(
                        "error" to str(e.javaClass.simpleName),
                        "message" to str(e.message ?: "inconnu"),
                    ),
                ),
            )
        }
    }
}
