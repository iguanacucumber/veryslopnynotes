// PairingMessagesParityMain.kt — pilote JSON de la table des messages
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/android-pairing-message.test.ts` (jamais Gradle, jamais l'APK).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.pairingmessage

import fr.veryslopnynotes.app.pairingFailureMessage
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        "message" -> {
            val code = op.str("code") ?: throw IllegalArgumentException("pilote: code absent")
            JVal.Obj(linkedMapOf("message" to JVal.Str(pairingFailureMessage(code))))
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
