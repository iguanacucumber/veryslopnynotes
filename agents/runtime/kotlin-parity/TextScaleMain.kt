// TextScaleMain.kt — pilote JSON des tailles de texte.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/android-text-scale.test.ts`
// (jamais Gradle, jamais l'APK).
//
//   - `{"op":"zoom","preference":"SYSTEM","fontScale":2}` → `{"zoom":200}`
//   - `{"op":"parse","raw":"125"}`                       → `{"value":"125"}`
//   - `{"op":"wire","raw":"inconnu"}`                    → `{"value":"SYSTEM"}`
package fr.veryslopnynotes.textscale

import fr.veryslopnynotes.core.TextScale
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.textOrNull(key: String): String? = when (val v = fields[key]) {
    null -> throw IllegalArgumentException("pilote: $key absent")
    is JVal.Null -> null
    is JVal.Str -> v.value
    is JVal.Num -> v.value.toString()
    else -> throw IllegalArgumentException("pilote: $key n'est pas un texte")
}

private class Driver {
    fun run(op: JVal.Obj): JVal {
        val name = (op.fields["op"] as? JVal.Str)?.value
            ?: throw IllegalArgumentException("pilote: op absent")
        return when (name) {
            "zoom" -> {
                val preference = op.textOrNull("preference")
                val fontScale = (op.fields["fontScale"] as? JVal.Num)?.value?.toFloat()
                    ?: throw IllegalArgumentException("pilote: fontScale absent")
                JVal.Obj(linkedMapOf("zoom" to JVal.Num(TextScale.zoom(preference, fontScale).toDouble())))
            }
            "parse" -> JVal.Obj(linkedMapOf("value" to nullable(TextScale.parse(op.textOrNull("raw")))))
            "wire" -> JVal.Obj(linkedMapOf("value" to JVal.Str(TextScale.wire(op.textOrNull("raw")))))
            else -> throw IllegalArgumentException("pilote: opération inconnue : $name")
        }
    }

    private fun nullable(value: String?): JVal = value?.let { JVal.Str(it) } ?: JVal.Null
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
