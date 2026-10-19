// SecurityAlertParityMain.kt — pilote JSON du filtre anti-injection (#415).
//
// OUTIL DE TEST uniquement : compilé par
// `tests/unit/android-security-alert.test.ts` (jamais par Gradle, jamais dans
// l'APK). Le test compile la VRAIE source de production
// (`core/SecurityAlert.kt`) et la pilote ici : les assertions portent donc sur
// du code exécuté, pas sur un miroir TS.
//
// Protocole : une operation JSON par ligne sur stdin, une reponse par ligne sur
// stdout (comme les autres pilotes de `agents/runtime/kotlin-parity/`). Une
// erreur du PORT revient en `{"error":…}` : c'est un resultat attendu par le
// test, pas une panne du pilote. Les erreurs du PILOTE sont prefixees
// `pilote: ` et refusent par le harnais.
package fr.veryslopnynotes.securityalert

import fr.veryslopnynotes.core.JsonValue
import fr.veryslopnynotes.core.SecurityAlert
import fr.veryslopnynotes.core.parseJsonValue
import fr.veryslopnynotes.core.stringifyJson
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
            when (op.str("op")) {
                // Balayage d'un texte local : la voie de production.
                "scan" -> {
                    val text = op.str("text") ?: throw IllegalArgumentException("pilote: text absent")
                    val source = op.str("source") ?: "news"
                    val alerts = SecurityAlert.scanTextsForInjections(
                        listOf(SecurityAlert.ScannableText(source, text)),
                    )
                    val items = alerts.map { alert ->
                        obj(
                            "id" to JsonValue.Str(alert.id),
                            "kind" to JsonValue.Str(alert.kind),
                            "excerpt" to JsonValue.Str(alert.excerpt),
                            "source" to JsonValue.Str(alert.source),
                        )
                    }
                    stdout.println(
                        stringifyJson(
                            obj(
                                "ok" to JsonValue.Bool(true),
                                "count" to JsonValue.Num(alerts.size.toDouble()),
                                "alerts" to JsonValue.Arr(items),
                            ),
                        ),
                    )
                }
                else -> throw IllegalArgumentException("pilote: operation inconnue : ${op.str("op")}")
            }
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
