// BridgeErrorsParityMain.kt — pilote JSON de la traduction d'un échec natif
// en REJET de pont (#394).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/android-bridge-error.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile la VRAIE source de
// production `app/BridgeErrors.kt` (logique pure : ni Android ni réseau) et la
// pilote ici : les assertions portent donc sur du code EXÉCUTÉ, pas sur un
// miroir TS.
//
// Le point du pilote : un `Error` (et non une `Exception`) levé pendant un
// appel du pont. Le pont doit le transformer en REJET ; l'exception ne doit
// JAMAIS s'échapper (elle tuerait le fil du worker SANS `resolve` ni
// `reject` : la promesse JS resterait pendante).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout (comme les autres pilotes de `agents/runtime/kotlin-parity/`). Les
// erreurs du PILOTE (op inconnue, champ absent) sont préfixées `pilote: ` et
// refusées par le harnais.
package fr.veryslopnynotes.bridgeerror

import fr.veryslopnynotes.app.BridgeFailure
import fr.veryslopnynotes.app.bridgeCallOutcome
import fr.veryslopnynotes.app.bridgeErrorFor
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

/** L'échec natif à déclencher, selon son genre. */
private fun throwableFor(kind: String, message: String): Throwable = when (kind) {
    "error" -> Error(message)
    "out_of_memory" -> OutOfMemoryError(message)
    "stack_overflow" -> StackOverflowError(message)
    "runtime" -> RuntimeException(message)
    "bridge_failure" -> BridgeFailure("bad_request", message)
    else -> throw IllegalArgumentException("pilote: genre inconnu : $kind")
}

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        // Un appel du pont qui lève : le pont doit répondre par un REJET.
        "call" -> {
            val kind = op.str("kind") ?: throw IllegalArgumentException("pilote: kind absent")
            val message = op.str("message") ?: "échec natif"
            val outcome = bridgeCallOutcome { throw throwableFor(kind, message) }
            if (outcome == null) {
                JVal.Obj(linkedMapOf("rejected" to JVal.Bool(false)))
            } else {
                JVal.Obj(
                    linkedMapOf(
                        "rejected" to JVal.Bool(true),
                        "code" to JVal.Str(outcome.code),
                        "message" to JVal.Str(outcome.message),
                    ),
                )
            }
        }
        // La traduction seule, sans l'appel.
        "error" -> {
            val kind = op.str("kind") ?: throw IllegalArgumentException("pilote: kind absent")
            val message = op.str("message") ?: "échec natif"
            val outcome = bridgeErrorFor(throwableFor(kind, message))
            JVal.Obj(
                linkedMapOf(
                    "code" to JVal.Str(outcome.code),
                    "message" to JVal.Str(outcome.message),
                ),
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
