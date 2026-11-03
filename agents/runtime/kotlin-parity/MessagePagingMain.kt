// MessagePagingMain.kt — pilote JSON de la pagination des messages.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-message-paging.test.ts`
// (jamais Gradle, jamais l'APK). Compte les TÉLÉCHARGEMENTS du pager avec un
// `fetch` synthétique : aucune requête réseau, aucune horloge réelle.
package fr.veryslopnynotes.messagepaging

import fr.veryslopnynotes.core.MessagePaging
import fr.veryslopnynotes.core.ThreadMessagePager
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String, fallback: Int): Int =
    ((fields[key] as? JVal.Num)?.value ?: fallback.toDouble()).toInt()

private fun JVal.Obj.nums(key: String): List<Int> =
    (fields[key] as? JVal.Arr)?.items?.mapNotNull { (it as? JVal.Num)?.value?.toInt() } ?: emptyList()

private fun JVal.Obj.strs(key: String): List<String> =
    (fields[key] as? JVal.Arr)?.items?.mapNotNull { (it as? JVal.Str)?.value } ?: emptyList()

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf(
        "error" to JVal.Str(name),
        "message" to JVal.Str(message ?: "inconnu"),
    ),
)

private fun run(op: JVal.Obj): JVal = when (op.str("op")) {
    // Une page par `before` fourni (null = fin du fil). `requests` mesure le
    // coût réseau du pager, pas le nombre de pages.
    "pager" -> {
        val total = op.num("total", 120).coerceAtLeast(0)
        val size = op.num("size", MessagePaging.PAGE_SIZE).coerceAtLeast(1)
        var requests = 0
        val pager = ThreadMessagePager<Int>(pageSize = size, maxEntries = op.num("maxEntries", 3))
        val pages = op.nums("befores").map { before ->
            val page = pager.page("fil", before) {
                requests++
                (0 until total).toList()
            }
            JVal.Obj(
                linkedMapOf(
                    "items" to JVal.Num(page.items.size.toDouble()),
                    "first" to JVal.Num((page.items.firstOrNull() ?: -1).toDouble()),
                    "last" to JVal.Num((page.items.lastOrNull() ?: -1).toDouble()),
                    "start" to JVal.Num(page.start.toDouble()),
                    "total" to JVal.Num(page.total.toDouble()),
                    "hasMore" to JVal.Bool(page.hasMore),
                ),
            )
        }
        JVal.Obj(
            linkedMapOf(
                "requests" to JVal.Num(requests.toDouble()),
                "pages" to JVal.Arr(pages),
            ),
        )
    }
    // Lot d'enrichissement : `requests` = identifiants réellement demandés.
    "enrich" -> {
        val batch = MessagePaging.enrichBatch(
            op.strs("visible"),
            op.strs("already").toSet(),
            op.num("max", MessagePaging.MAX_VISIBLE_ENRICH),
        )
        JVal.Obj(
            linkedMapOf(
                "requests" to JVal.Num(batch.size.toDouble()),
                "ids" to JVal.Arr(batch.map { JVal.Str(it) }),
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
            stdout.println(Json.stringify(run(Json.parse(line) as JVal.Obj)))
        } catch (e: Exception) {
            stderr.println("port: ${e.javaClass.simpleName}: ${e.message}")
            stdout.println(Json.stringify(err(e.javaClass.simpleName, e.message)))
        }
    }
}
