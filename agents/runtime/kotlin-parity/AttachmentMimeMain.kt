// AttachmentMimeMain.kt — pilote JSON du type MIME des pièces jointes.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/attachment-mime.test.ts` (jamais Gradle, jamais l'APK).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
//
//   - `{"name":"consignes.html"}` → `{"ok":true,"mime":"text/plain"}`
package fr.veryslopnynotes.attachmentmime

import fr.veryslopnynotes.app.mimeOf
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

fun main() {
    val stdin = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    val stdout = PrintStream(System.out, true, StandardCharsets.UTF_8.name())
    val stderr = PrintStream(System.err, true, StandardCharsets.UTF_8.name())
    while (true) {
        val line = stdin.readLine() ?: break
        if (line.isBlank()) continue
        try {
            val op = Json.parse(line) as JVal.Obj
            val name = op.str("name") ?: throw IllegalArgumentException("pilote: name absent")
            stdout.println(
                Json.stringify(
                    JVal.Obj(linkedMapOf("ok" to JVal.Bool(true), "mime" to JVal.Str(mimeOf(name)))),
                ),
            )
        } catch (e: Exception) {
            stderr.println("port: ${e.javaClass.simpleName}: ${e.message}")
            stdout.println(
                Json.stringify(
                    JVal.Obj(
                        linkedMapOf(
                            "ok" to JVal.Bool(false),
                            "error" to JVal.Str(e.javaClass.simpleName),
                            "message" to JVal.Str(e.message ?: "inconnu"),
                        ),
                    ),
                ),
            )
        }
    }
}
