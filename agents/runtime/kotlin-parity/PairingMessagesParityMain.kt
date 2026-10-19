// PairingMessagesParityMain.kt — pilote JSON de la table des messages
// d'appairage (#396).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/android-pairing-message.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile la VRAIE source de
// production `app/PairingMessages.kt` (logique pure : ni Android ni réseau) et
// la pilote ici : les assertions portent donc sur du code EXÉCUTÉ, pas sur un
// miroir TS.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout (comme les autres pilotes de `agents/runtime/kotlin-parity/`). Les
// erreurs du PILOTE (op inconnue, champ absent) sont préfixées `pilote: ` et
// refusées par le harnais.
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
