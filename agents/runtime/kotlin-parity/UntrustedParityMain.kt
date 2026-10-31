// UntrustedParityMain.kt — pilote JSON du marquage Untrusted.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/android-untrusted.test.ts` (jamais Gradle, jamais l'APK).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.untrusted

import fr.veryslopnynotes.core.JsonValue
import fr.veryslopnynotes.core.buildRevisionPrompt
import fr.veryslopnynotes.core.markExternal
import fr.veryslopnynotes.core.parseJsonValue
import fr.veryslopnynotes.core.stringifyJson
import fr.veryslopnynotes.core.wrapUntrusted
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JsonValue.Obj.str(key: String): String? = (fields[key] as? JsonValue.Str)?.value

private fun obj(vararg pairs: Pair<String, JsonValue>): JsonValue.Obj =
    JsonValue.Obj(linkedMapOf(*pairs))

fun main() {
    val stdin = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    val stdout = PrintStream(System.out, true, StandardCharsets.UTF_8.name())
    val stderr = PrintStream(System.err, true, StandardCharsets.UTF_8.name())
    while (true) {
        val line = stdin.readLine() ?: break
        if (line.isBlank()) continue
        try {
            val op = parseJsonValue(line) as JsonValue.Obj
            val content = op.str("content") ?: throw IllegalArgumentException("pilote: content absent")
            val nonce = op.str("nonce")
            val res = when (op.str("op")) {
                // Prompt complet : la voie de production (AiPrompts -> buildSafePrompt).
                "prompt" -> {
                    val safe = buildRevisionPrompt(listOf(content), nonce)
                    obj(
                        "ok" to JsonValue.Bool(true),
                        "body" to JsonValue.Str(safe.body),
                        "nonce" to JsonValue.Str(safe.nonce),
                    )
                }
                // Bloc seul (wrapUntrusted) : le nonce y est obligatoire.
                "wrap" -> {
                    val n = nonce ?: throw IllegalArgumentException("pilote: nonce absent")
                    val block = wrapUntrusted(markExternal(content), n)
                    obj(
                        "ok" to JsonValue.Bool(true),
                        "body" to JsonValue.Str(block),
                        "nonce" to JsonValue.Str(n),
                    )
                }
                else -> throw IllegalArgumentException("pilote: operation inconnue : ${op.str("op")}")
            }
            stdout.println(stringifyJson(res))
        } catch (e: Exception) {
            stderr.println("port: ${e.javaClass.simpleName}: ${e.message}")
            stdout.println(
                stringifyJson(
                    obj(
                        "error" to JsonValue.Str(e.javaClass.simpleName),
                        "message" to JsonValue.Str(e.message ?: "inconnu"),
                    ),
                ),
            )
        }
    }
}
