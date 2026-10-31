// SubjectPrefParityMain.kt — pilote JSON des règles de matière.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/android-subject-pref.test.ts` (jamais Gradle, jamais l'APK).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.subjectpref

import fr.veryslopnynotes.app.subjectPrefIssueMessage
import fr.veryslopnynotes.data.SubjectPrefField
import fr.veryslopnynotes.data.SubjectPrefInput
import fr.veryslopnynotes.data.SubjectPrefRules
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String = (fields[key] as? JVal.Str)?.value ?: ""

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private class Driver {
    fun run(op: JVal.Obj): JVal.Obj = when (op.str("op")) {
        // Lecture d'une matière venue du pont : conforme (bornée) ou refusée.
        "read" -> {
            val input = SubjectPrefRules.read(
                subject = op.str("subject"),
                color = op.str("color"),
                emoji = op.str("emoji"),
                label = op.str("label"),
            )
            when (input) {
                is SubjectPrefInput.Valid -> ok(
                    "ok" to JVal.Bool(true),
                    "subject" to JVal.Str(input.subject),
                    "color" to JVal.Str(input.color ?: ""),
                    "emoji" to JVal.Str(input.emoji ?: ""),
                    "label" to JVal.Str(input.label ?: ""),
                )
                is SubjectPrefInput.Invalid -> ok(
                    "ok" to JVal.Bool(false),
                    "field" to JVal.Str(input.field.name),
                    "message" to JVal.Str(subjectPrefIssueMessage(input.field)),
                )
            }
        }
        // Bornes partagées : le pont et le dépôt doivent lire les MÊMES.
        "limits" -> ok(
            "subject" to JVal.Num(SubjectPrefRules.MAX_SUBJECT_CHARS.toDouble()),
            "emoji" to JVal.Num(SubjectPrefRules.MAX_EMOJI_CHARS.toDouble()),
            "label" to JVal.Num(SubjectPrefRules.MAX_LABEL_CHARS.toDouble()),
            "color" to JVal.Num(SubjectPrefRules.MAX_COLOR_CHARS.toDouble()),
        )
        // Phrase de refus d'un champ : bornée, en français, sans la saisie.
        "message" -> {
            val name = op.str("field")
            val field = SubjectPrefField.entries.firstOrNull { it.name == name }
                ?: throw IllegalArgumentException("pilote: champ inconnu ($name)")
            ok("message" to JVal.Str(subjectPrefIssueMessage(field)))
        }
        else -> throw IllegalArgumentException("pilote: opération inconnue : ${op.str("op")}")
    }
}

fun main() {
    val stdin = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    val stdout = PrintStream(System.out, true, StandardCharsets.UTF_8.name())
    val stderr = PrintStream(System.err, true, StandardCharsets.UTF_8.name())
    val driver = Driver()
    while (true) {
        val line = stdin.readLine() ?: break
        if (line.isBlank()) continue
        try {
            stdout.println(Json.stringify(driver.run(Json.parse(line) as JVal.Obj)))
        } catch (e: Exception) {
            val name = e.javaClass.simpleName
            stderr.println("port: $name: ${e.message}")
            stdout.println(Json.stringify(err(name, e.message)))
        }
    }
}
