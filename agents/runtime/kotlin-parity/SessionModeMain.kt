// SessionModeMain.kt — pilote JSON du mode d'ouverture d'une session.
//
// OUTIL DE TEST uniquement (jamais Gradle, jamais l'APK). Le test compile la
// VRAIE source de production `fr.veryslopnynotes.data.SessionMode` (logique
// pure : aucun import Android) et la pilote ici.
//
// CE QUE ÇA PROUVE. Une session persistée se rouvre par son jeton (appairage
// QR) ou par son identifiant (établissement de démonstration). Le mode est
// decisão AU MOMENT DE LA RESTAURATION, à partir de la valeur persistée : une
// valeur absente ou inconnue doit rester « jeton » — sinon une session
// enregistrée avant l'existence de la démonstration se rouvrirait par
// identifiant, et une valeur corrompue pourrait choisir un mode au hasard.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout (comme les autres pilotes de `agents/runtime/kotlin-parity/`).
package fr.veryslopnynotes.sessionmode

import fr.veryslopnynotes.data.SessionMode
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        // Le mode de réouverture d'une session persistée.
        "mode" -> ok("mode" to JVal.Str(SessionMode.of(op.str("stored"))))
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
