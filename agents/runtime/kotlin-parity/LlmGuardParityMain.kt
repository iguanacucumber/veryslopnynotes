// LlmGuardParityMain.kt — pilote JSON de la garde I4 (#409).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-llm-guard.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile la VRAIE source de
// production `core/LlmGuard.kt` (logique pure : ni Android ni réseau) et la
// pilote ici : les assertions portent donc sur du code EXÉCUTÉ, pas sur un
// miroir TS.
//
// Deux opérations :
//   - `prompt` : la garde d'entrée (`assertNoSecretsInPrompt`) sur un prompt
//     réel (system + donnée externe délimitée à nonce) ;
//   - `output` : la garde de sortie (`validateTextOutput`).
//
// Les REFUS du PORT reviennent en `{"ok":false,"kind":…,"message":…}` : c'est
// un résultat attendu, pas une panne. Aucun secret n'est écrit en clair ici :
// les faux secrets sont assemblés par le TEST, à l'exécution.
package fr.veryslopnynotes.llmguard

import fr.veryslopnynotes.core.JsonValue
import fr.veryslopnynotes.core.SecretDetectedException
import fr.veryslopnynotes.core.assertNoSecretsInPrompt
import fr.veryslopnynotes.core.buildSafePrompt
import fr.veryslopnynotes.core.markExternal
import fr.veryslopnynotes.core.parseJsonValue
import fr.veryslopnynotes.core.stringifyJson
import fr.veryslopnynotes.core.validateTextOutput
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JsonValue.Obj.str(key: String): String? = (fields[key] as? JsonValue.Str)?.value

private fun obj(vararg pairs: Pair<String, JsonValue>): JsonValue.Obj =
    JsonValue.Obj(linkedMapOf(*pairs))

/** Consigne neutre : la garde doit juger le CONTENU, pas la consigne. */
private const val SYSTEM = "Tu aides aux devoirs. Reponds en francais."

/** Verdict de la garde : passe, ou refuse avec le TYPE du secret. */
private fun verdict(e: SecretDetectedException): JsonValue.Obj = obj(
    "ok" to JsonValue.Bool(false),
    "kind" to JsonValue.Str(e.kind.name),
    "label" to JsonValue.Str(e.kind.label),
    // Le message de l'exception : il dit POURQUOI, jamais le secret.
    "message" to JsonValue.Str(e.message ?: ""),
    // La phrase que l'app affiche a l'eleve (meme table fermee).
    "refusal" to JsonValue.Str(fr.veryslopnynotes.core.secretRefusalMessage(e.kind)),
)

private fun driver(op: JsonValue.Obj): JsonValue = when (op.str("op")) {
    "prompt" -> {
        val text = op.str("text") ?: throw IllegalArgumentException("pilote: text absent")
        // Le prompt reel : consigne + donnee externe delimitee a nonce (I6).
        val data = listOf(markExternal(text))
        val safe = buildSafePrompt(SYSTEM, data)
        try {
            assertNoSecretsInPrompt(safe, data)
            obj("ok" to JsonValue.Bool(true))
        } catch (e: SecretDetectedException) {
            verdict(e)
        }
    }
    "output" -> {
        val text = op.str("text") ?: throw IllegalArgumentException("pilote: text absent")
        try {
            validateTextOutput(text)
            obj("ok" to JsonValue.Bool(true))
        } catch (e: SecretDetectedException) {
            verdict(e)
        }
    }
    else -> throw IllegalArgumentException("pilote: opération inconnue : ${op.str("op")}")
}

fun main() {
    val stdin = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    val stdout = PrintStream(System.out, true, StandardCharsets.UTF_8.name())
    val stderr = PrintStream(System.err, true, StandardCharsets.UTF_8.name())
    while (true) {
        val line = stdin.readLine() ?: break
        if (line.isBlank()) continue
        try {
            stdout.println(stringifyJson(driver(parseJsonValue(line) as JsonValue.Obj)))
        } catch (e: Exception) {
            val name = e.javaClass.simpleName
            stderr.println("port: $name: ${e.message}")
            stdout.println(
                stringifyJson(
                    obj(
                        "error" to JsonValue.Str(name),
                        "message" to JsonValue.Str(e.message ?: "inconnu"),
                    ),
                ),
            )
        }
    }
}
