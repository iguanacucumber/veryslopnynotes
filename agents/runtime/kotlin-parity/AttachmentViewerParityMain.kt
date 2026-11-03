// AttachmentViewerParityMain.kt — pilote JSON de l'autorité FileProvider et du
// refus « aucun ouvreur » (#878).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/android-attachment-viewer.test.ts`
// (jamais Gradle, jamais l'APK).
//
//   - `{"applicationId":"fr.example","canResolve":true}`  → autorité dérivée, pas d'erreur
//   - `{"applicationId":"fr.example","canResolve":false}` → message « aucun ouvreur »
package fr.veryslopnynotes.attachmentviewer

import fr.veryslopnynotes.app.attachmentProviderAuthority
import fr.veryslopnynotes.app.viewerLaunchError
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.text(key: String): String = when (val v = fields[key]) {
    is JVal.Str -> v.value
    else -> throw IllegalArgumentException("pilote: $key absent ou non textuel")
}

private fun JVal.Obj.bool(key: String): Boolean = when (val v = fields[key]) {
    is JVal.Bool -> v.value
    else -> throw IllegalArgumentException("pilote: $key absent ou non booléen")
}

fun main() {
    val stdin = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    val stdout = PrintStream(System.out, true, StandardCharsets.UTF_8.name())
    val stderr = PrintStream(System.err, true, StandardCharsets.UTF_8.name())
    while (true) {
        val line = stdin.readLine() ?: break
        if (line.isBlank()) continue
        try {
            val op = Json.parse(line) as JVal.Obj
            val applicationId = op.text("applicationId")
            val error = viewerLaunchError(op.bool("canResolve"))
            stdout.println(
                Json.stringify(
                    JVal.Obj(
                        linkedMapOf(
                            "authority" to JVal.Str(attachmentProviderAuthority(applicationId)),
                            "error" to (error?.let { JVal.Str(it) } ?: JVal.Null),
                        ),
                    ),
                ),
            )
        } catch (e: Exception) {
            stderr.println("port: ${e.javaClass.simpleName}: ${e.message}")
            stdout.println(
                Json.stringify(
                    JVal.Obj(
                        linkedMapOf(
                            "error" to JVal.Str(e.javaClass.simpleName),
                            "message" to JVal.Str(e.message ?: "inconnu"),
                        ),
                    ),
                ),
            )
        }
    }
}
