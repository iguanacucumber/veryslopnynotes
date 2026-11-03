// SecureWindowParityMain.kt — pilote JSON de la décision `FLAG_SECURE`.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/android-secure-window.test.ts`
// (jamais Gradle, jamais l'APK).
//
//   {"op":"secure","debug":true}  → {"secure":false}
//   {"op":"secure","debug":false} → {"secure":true}
package fr.veryslopnynotes.securewindow

import fr.veryslopnynotes.app.secureWindowRequired
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.bool(key: String): Boolean = when (val v = fields[key]) {
    null -> throw IllegalArgumentException("pilote: $key absent")
    is JVal.Bool -> v.value
    else -> throw IllegalArgumentException("pilote: $key n'est pas un booléen")
}

private class Driver {
    fun run(op: JVal.Obj): JVal {
        val name = (op.fields["op"] as? JVal.Str)?.value
            ?: throw IllegalArgumentException("pilote: op absent")
        return when (name) {
            "secure" -> JVal.Obj(
                linkedMapOf("secure" to JVal.Bool(secureWindowRequired(op.bool("debug")))),
            )
            else -> throw IllegalArgumentException("pilote: opération inconnue : $name")
        }
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
