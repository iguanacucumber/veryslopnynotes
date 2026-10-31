// CorpusParityMain.kt — pilote JSON du replay corpus réel.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-corpus-parity.test.ts` (jamais Gradle, jamais l'APK).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.corpusparity

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

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

/** Tri canonique : clés d'objet triées (ordre UTF-16, comme `sort` TS), tableaux intacts. */
private fun sortKeys(value: JVal): JVal = when (value) {
    is JVal.Obj -> JVal.Obj(LinkedHashMap(value.fields.toSortedMap().mapValues { (_, v) -> sortKeys(v) }))
    is JVal.Arr -> JVal.Arr(value.items.map { sortKeys(it) })
    else -> value
}

fun main() {
    val stdin = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    val stdout = PrintStream(System.out, true, StandardCharsets.UTF_8.name())
    val stderr = PrintStream(System.err, true, StandardCharsets.UTF_8.name())
    while (true) {
        val line = stdin.readLine() ?: break
        if (line.isBlank()) continue
        try {
            val op = Json.parse(line) as? JVal.Obj
                ?: throw IllegalArgumentException("pilote: objet attendu")
            when (op.str("op")) {
                "corpusCanon" -> {
                    val text = op.str("text")
                        ?: throw IllegalArgumentException("pilote: text absent")
                    stdout.println(Json.stringify(ok("canon" to sortKeys(Json.parse(text)))))
                }
                else -> throw IllegalArgumentException("pilote: opération inconnue : ${op.str("op")}")
            }
        } catch (e: Exception) {
            val name = e.javaClass.simpleName
            stderr.println("port: $name: ${e.message}")
            stdout.println(Json.stringify(err(name, e.message)))
        }
    }
}
