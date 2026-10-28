// AiContextMain.kt — pilote JSON de l'assembleur de contexte IA (#628).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-ai-context.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile la VRAIE source de
// production `core/AiContext.kt` (pure, sans réseau ni Android) et la pilote
// ici : priorité, budgets, déduplication, troncature signalée, refus vide et
// parité des points d'entrée portent donc sur du code EXÉCUTÉ.
package fr.veryslopnynotes.aicontext

import fr.veryslopnynotes.core.AiContext
import fr.veryslopnynotes.core.AiContextEntry
import fr.veryslopnynotes.core.AiContextItem
import fr.veryslopnynotes.core.AiContextResult
import fr.veryslopnynotes.core.AiContextType
import fr.veryslopnynotes.core.Homework
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.objs(key: String): List<JVal.Obj> =
    (fields[key] as? JVal.Arr)?.items?.mapNotNull { it as? JVal.Obj } ?: emptyList()

private fun err(name: String, message: String?): JVal.Obj =
    JVal.Obj(linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")))

private fun typeOf(wire: String): AiContextType =
    AiContextType.entries.firstOrNull { it.wire == wire }
        ?: throw IllegalArgumentException("pilote: type de source inconnu : $wire")

private fun entryOf(wire: String): AiContextEntry =
    AiContextEntry.entries.firstOrNull { it.wire == wire }
        ?: throw IllegalArgumentException("pilote: point d'entrée inconnu : $wire")

private fun itemOf(o: JVal.Obj): AiContextItem = AiContextItem(
    type = typeOf(o.str("type") ?: "assignment"),
    label = o.str("label") ?: "",
    text = o.str("text") ?: "",
)

private fun resultJson(result: AiContextResult): JVal.Obj = JVal.Obj(
    linkedMapOf(
        "entry" to JVal.Str(result.entry.wire),
        "totalChars" to JVal.Num(result.totalChars.toDouble()),
        "sources" to JVal.Arr(
            result.sources.map { source ->
                JVal.Obj(
                    linkedMapOf(
                        "type" to JVal.Str(source.type.wire),
                        "label" to JVal.Str(source.label),
                        "text" to JVal.Str(source.text),
                        "chars" to JVal.Num(source.text.length.toDouble()),
                        "originalChars" to JVal.Num(source.originalChars.toDouble()),
                        "truncated" to JVal.Bool(source.truncated),
                    ),
                )
            },
        ),
        "omitted" to JVal.Arr(
            result.omitted.map { omitted ->
                JVal.Obj(
                    linkedMapOf(
                        "type" to JVal.Str(omitted.type.wire),
                        "label" to JVal.Str(omitted.label),
                        "reason" to JVal.Str(omitted.reason.wire),
                    ),
                )
            },
        ),
        "refusal" to (result.refusal?.let { refusal ->
            JVal.Obj(
                linkedMapOf(
                    "code" to JVal.Str(refusal.code),
                    "message" to JVal.Str(refusal.message),
                    "actions" to JVal.Arr(refusal.actions.map { JVal.Str(it) }),
                ),
            )
        } ?: JVal.Null),
    ),
)

private fun driver(op: JVal.Obj): JVal = when (op.str("op")) {
    "budget" -> JVal.Obj(
        linkedMapOf(
            "maxSources" to JVal.Num(AiContext.MAX_SOURCES.toDouble()),
            "maxSourceChars" to JVal.Num(AiContext.MAX_SOURCE_CHARS.toDouble()),
            "maxTotalChars" to JVal.Num(AiContext.MAX_TOTAL_CHARS.toDouble()),
            "maxHistoryItems" to JVal.Num(AiContext.MAX_HISTORY_ITEMS.toDouble()),
            "maxLabelChars" to JVal.Num(AiContext.MAX_LABEL_CHARS.toDouble()),
            "refusalCode" to JVal.Str(AiContext.REFUSAL_CODE),
        ),
    )
    "label" -> {
        val type = typeOf(op.str("type") ?: "course")
        val title = op.str("title") ?: ""
        JVal.Obj(linkedMapOf("label" to JVal.Str(AiContext.labelFor(type, title))))
    }
    "assemble" -> {
        val entry = entryOf(op.str("entry") ?: "homework")
        val items = op.objs("items").map { itemOf(it) }
        resultJson(AiContext.assembleFor(entry, items))
    }
    "valid" -> {
        // Vérifie la compatibilité avec le contrat devoirs (I5) : les sources
        // produites doivent passer `Homework.isRequestValid` telles quelles.
        val result = AiContext.assembleFor(AiContextEntry.HOMEWORK, op.objs("items").map { itemOf(it) })
        val sources = result.sources.map { it.toHomeworkSource() }
        JVal.Obj(
            linkedMapOf(
                "valid" to JVal.Bool(Homework.isRequestValid("q", sources, "synthetic-key")),
                "count" to JVal.Num(sources.size.toDouble()),
            ),
        )
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
            stdout.println(Json.stringify(driver(Json.parse(line) as JVal.Obj)))
        } catch (e: Exception) {
            val name = e.javaClass.simpleName
            stderr.println("port: $name: ${e.message}")
            stdout.println(Json.stringify(err(name, e.message)))
        }
    }
}
