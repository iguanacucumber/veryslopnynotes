// JsonDepthMain.kt — pilote de la BORNE DE PROFONDEUR du `Json` embarqué (#414).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-json-depth.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile la VRAIE source de
// production `fr.veryslopnynotes.pronote.Json` et la pilote ici : les
// assertions portent donc sur du code exécuté, pas sur un miroir TS.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout, comme les autres pilotes de `agents/runtime/kotlin-parity/`.
//   - `{"op":"parse","text":"…"}` → `{"ok":true}` ou
//     `{"ok":false,"error":"<classe>","message":"…"}`
//
// POINT CLÉ : le pilote attrape `Throwable` et NON `Exception`. Un
// `StackOverflowError` est une `Error` : le `catch (e: Exception)` du `main`
// ne l'attraperait pas, le JVM mourrait, et le test ne verrait qu'une trame de
// dialogue coupée — sans le NOM de l'erreur, donc sans preuve. Ici le nom de
// classe remonte tel quel (`StackOverflowError` ou `JsonError`) : c'est
// exactement ce que le test compare (#414).
package fr.veryslopnynotes.jsondepth

import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun run(op: JVal.Obj): JVal.Obj {
    return when (op.str("op")) {
        "parse" -> {
            val text = op.str("text") ?: throw IllegalArgumentException("pilote: text absent")
            try {
                Json.parse(text)
                JVal.Obj(linkedMapOf("ok" to JVal.Bool(true)))
            } catch (e: Throwable) {
                JVal.Obj(
                    linkedMapOf(
                        "ok" to JVal.Bool(false),
                        "error" to JVal.Str(e.javaClass.simpleName),
                        "message" to JVal.Str(e.message ?: "inconnu"),
                    ),
                )
            }
        }
        else -> throw IllegalArgumentException("pilote: opération inconnue : ${op.str("op")}")
    }
}

fun main() {
    val stdin = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    val stdout = PrintStream(System.out, true, StandardCharsets.UTF_8.name())
    val stderr = PrintStream(System.err, true, StandardCharsets.UTF_8.name())
    while (true) {
        val line = stdin.readLine() ?: break
        if (line.isBlank()) continue
        try {
            stdout.println(Json.stringify(run(Json.parse(line) as JVal.Obj)))
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
