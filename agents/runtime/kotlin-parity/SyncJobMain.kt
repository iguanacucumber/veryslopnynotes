// SyncJobMain.kt — pilote JSON de la décision du job de fond (#406).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-sync-worker.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile la VRAIE classe de
// production `fr.veryslopnynotes.data.SyncJobOutcome` (logique pure : aucun
// import Android) et la pilote ici : « pas de session » doit valoir RÉESSAI,
// jamais un succès qui n'a rien fait.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout (comme les autres pilotes de `agents/runtime/kotlin-parity/`). Les
// erreurs du PILOTE (op inconnue, champ absent) sont préfixées `pilote: ` et
// refusées par le test.
package fr.veryslopnynotes.syncjob

import fr.veryslopnynotes.data.SyncJobOutcome
import fr.veryslopnynotes.data.syncJobOutcome
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

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        // La session lisible ou non : c'est la SEULE entrée de la décision.
        "outcome" -> {
            val session: String? = if (op.bool("hasSession") ?: false) "session" else null
            when (val outcome = syncJobOutcome(session)) {
                is SyncJobOutcome.Retry -> ok("outcome" to JVal.Str("retry"))
                is SyncJobOutcome.Refresh -> ok(
                    "outcome" to JVal.Str("refresh"),
                    "session" to JVal.Str(outcome.session),
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
