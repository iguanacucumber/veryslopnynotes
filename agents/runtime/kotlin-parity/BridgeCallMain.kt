// BridgeCallMain.kt — pilote JSON de l'admission d'un appel du pont.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/android-bridge-call.test.ts` (jamais Gradle, jamais l'APK).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.bridgecall

import fr.veryslopnynotes.app.BridgeEarlySink
import fr.veryslopnynotes.app.handleBridgeEarly
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.bool(key: String): Boolean? = (fields[key] as? JVal.Bool)?.value

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun obj(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

/** Le sink qui ENREGISTRE chaque réponse : le test compte les appels. */
private class RecordingSink : BridgeEarlySink {
    val replies = mutableListOf<JVal>()

    override fun reject(requestId: String, code: String, message: String) {
        replies.add(
            obj(
                "kind" to JVal.Str("reject"),
                "requestId" to JVal.Str(requestId),
                "code" to JVal.Str(code),
                "message" to JVal.Str(message),
            ),
        )
    }

    override fun resolveOk(requestId: String) {
        replies.add(obj("kind" to JVal.Str("resolveOk"), "requestId" to JVal.Str(requestId)))
    }

    override fun cancel(requestId: String, paramsJson: String) {
        replies.add(
            obj(
                "kind" to JVal.Str("cancel"),
                "requestId" to JVal.Str(requestId),
                "params" to JVal.Str(paramsJson),
            ),
        )
    }
}

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        "early" -> {
            val requestId = op.str("requestId") ?: throw IllegalArgumentException("pilote: requestId absent")
            val method = op.str("method") ?: throw IllegalArgumentException("pilote: method absent")
            val params = op.str("params") ?: ""
            val closed = op.bool("closed") ?: false
            val sink = RecordingSink()
            val handled = handleBridgeEarly(requestId, method, params, closed, sink)
            obj(
                "handled" to JVal.Bool(handled),
                "replies" to JVal.Arr(sink.replies),
            )
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
            // `Exception` et pas `Throwable` : une `Error` ici tuerait le
            // pilote, et le harnais le verrait (pas un faux vert).
            val name = e.javaClass.simpleName
            stderr.println("port: $name: ${e.message}")
            stdout.println(Json.stringify(err(name, e.message)))
        }
    }
}
