// WebViewAccountStorageMain.kt — pilote JSON du script de purge du DOM storage.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-webview-storage.test.ts`
// (jamais Gradle, jamais l'APK). Le test EXÉCUTE le script rendu sur un
// `localStorage` factice : la liste blanche d'apparence est réellement vérifiée.
package fr.veryslopnynotes.webviewstorage

import fr.veryslopnynotes.app.WebViewAccountStorage
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.strings(key: String): List<String>? =
    (fields[key] as? JVal.Arr)?.items?.mapNotNull { (it as? JVal.Str)?.value }

private class Driver {
    fun run(op: JVal.Obj): JVal = when ((op.fields["op"] as? JVal.Str)?.value) {
        "script" -> {
            val keep = op.strings("keep")
            val script = if (keep == null) {
                WebViewAccountStorage.clearScript()
            } else {
                WebViewAccountStorage.clearScript(keep)
            }
            JVal.Obj(
                linkedMapOf(
                    "script" to JVal.Str(script),
                    "appearance" to JVal.Arr(
                        WebViewAccountStorage.APPEARANCE_KEYS.map { JVal.Str(it) },
                    ),
                ),
            )
        }
        else -> throw IllegalArgumentException("pilote: opération inconnue")
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
