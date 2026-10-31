// LessonNotesMain.kt — pilote JSON du cahier de cours.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-lesson-notes.test.ts` (jamais Gradle, jamais l'APK).
package fr.veryslopnynotes.core

import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.arr(key: String): List<JVal.Obj> =
    (fields[key] as? JVal.Arr)?.items?.mapNotNull { it as? JVal.Obj } ?: emptyList()

private fun noteOf(op: JVal.Obj): LessonNote = LessonNote(
    id = op.str("id") ?: "../../etc/passwd",
    subject = op.str("subject") ?: "",
    title = op.str("title") ?: "",
    text = op.str("text") ?: "",
    createdAt = op.str("createdAt") ?: "2026-10-19T08:00:00Z",
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private fun err(name: String, message: String?): JVal.Obj =
    JVal.Obj(linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")))

private fun driver(op: JVal.Obj): JVal = when (op.str("op")) {
    "valid" -> ok("valid" to JVal.Bool(LessonNote.isValid(noteOf(op))))
    "forSubject" -> {
        val notes = op.arr("notes").map { noteOf(it) }
        val subject = op.str("subject") ?: ""
        ok("ids" to JVal.Arr(LessonNotes.forSubject(notes, subject).map { JVal.Str(it.id) }))
    }
    "sources" -> {
        val notes = op.arr("notes").map { noteOf(it) }
        val subject = op.str("subject") ?: ""
        val sources = LessonNotes.sources(notes, subject)
        ok(
            "labels" to JVal.Arr(sources.map { JVal.Str(it.label) }),
            "texts" to JVal.Arr(sources.map { JVal.Str(it.text) }),
            "count" to JVal.Num(sources.size.toDouble()),
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
            val name = e.javaClass.simpleName
            stderr.println("port: $name: ${e.message}")
            stdout.println(Json.stringify(err(name, e.message)))
        }
    }
}
