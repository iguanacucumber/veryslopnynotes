// EventDedupeParityMain.kt — pilote JSON de la déduplication (kind, id) (#645).
//
// OUTIL DE TEST uniquement : compilé par
// `tests/unit/kotlin-payload-dedupe.test.ts` (jamais par Gradle, jamais dans
// l'APK). Le test compile la VRAIE source de production `core/EventDedupe.kt`
// et la pilote ici : les assertions portent sur le code EXÉCUTÉ, pas sur la
// forme de `PronotePayloads.kt` (`org.json`, hors harnais).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout, comme les autres pilotes de `agents/runtime/kotlin-parity/`.
//   - `{"op":"dedupe","events":[{"kind":"absence","id":"12"}, …]}`
//     → `{"keys":[…],"kept":[…],"counts":{"absence":1,"late":1}}`
//   - `{"op":"key","kind":"absence","id":"12"}`
//     → `{"key":"absence:12"}`
package fr.veryslopnynotes.eventdedupe

import fr.veryslopnynotes.core.JsonValue
import fr.veryslopnynotes.core.dedupe
import fr.veryslopnynotes.core.eventKey
import fr.veryslopnynotes.core.jsonStrOf
import fr.veryslopnynotes.core.parseJsonValue
import fr.veryslopnynotes.core.stringifyJson
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private data class Event(val kind: String, val id: String)

private fun obj(vararg pairs: Pair<String, JsonValue>): JsonValue.Obj =
    JsonValue.Obj(linkedMapOf(*pairs))

private fun eventValue(e: Event): JsonValue.Obj =
    obj("kind" to JsonValue.Str(e.kind), "id" to JsonValue.Str(e.id))

private fun eventsOf(op: JsonValue.Obj): List<Event> {
    val arr = op.fields["events"] as? JsonValue.Arr
        ?: throw IllegalArgumentException("pilote: events absent")
    return arr.items.map { raw ->
        Event(
            kind = jsonStrOf(raw, "kind") ?: throw IllegalArgumentException("pilote: kind absent"),
            id = jsonStrOf(raw, "id") ?: throw IllegalArgumentException("pilote: id absent"),
        )
    }
}

private fun driver(op: JsonValue.Obj): JsonValue = when (op.fields["op"]?.let { (it as? JsonValue.Str)?.value }) {
    "key" -> {
        val kind = jsonStrOf(op, "kind") ?: throw IllegalArgumentException("pilote: kind absent")
        val id = jsonStrOf(op, "id") ?: throw IllegalArgumentException("pilote: id absent")
        obj("key" to JsonValue.Str(eventKey(kind, id)))
    }
    "dedupe" -> {
        val events = eventsOf(op)
        val kept = dedupe(events) { eventKey(it.kind, it.id) }
        // Les compteurs sont calculés depuis la liste DÉDUPLIQUÉE, jamais
        // depuis la liste brute.
        val counts = LinkedHashMap<String, JsonValue>()
        val tally = LinkedHashMap<String, Int>()
        for (e in kept) tally[e.kind] = (tally[e.kind] ?: 0) + 1
        for ((kind, n) in tally) counts[kind] = JsonValue.Num(n.toDouble())
        obj(
            "keys" to JsonValue.Arr(kept.map { JsonValue.Str(eventKey(it.kind, it.id)) }),
            "kept" to JsonValue.Arr(kept.map { eventValue(it) }),
            "counts" to JsonValue.Obj(counts),
        )
    }
    else -> throw IllegalArgumentException("pilote: opération inconnue")
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
