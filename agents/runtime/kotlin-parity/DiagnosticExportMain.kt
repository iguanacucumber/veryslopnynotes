// DiagnosticExportMain.kt — pilote JSON du diagnostic de support (#855).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-diagnostic-export.test.ts`
// (jamais Gradle, jamais l'APK).
package fr.veryslopnynotes.data

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

private fun JVal.Obj.str(key: String): String = (fields[key] as? JVal.Str)?.value ?: ""

private fun JVal.Obj.num(key: String): Int =
    ((fields[key] as? JVal.Num)?.value ?: 0.0).toInt()

private fun driver(op: JVal.Obj): JVal {
    if (op.str("op") != "build") throw IllegalArgumentException("pilote: opération inconnue")
    val json = buildDiagnostic(
        DiagnosticInput(
            generatedAt = op.str("generatedAt"),
            appVersion = op.str("appVersion"),
            androidVersion = op.str("androidVersion"),
            androidApi = op.num("androidApi"),
            webViewVersion = op.str("webViewVersion"),
            errorCode = op.str("errorCode"),
            resource = op.str("resource"),
            classLevel = op.str("classLevel"),
            authState = op.str("authState"),
        ),
    )
    return obj("json" to str(json), "ok" to JVal.Bool(true))
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
