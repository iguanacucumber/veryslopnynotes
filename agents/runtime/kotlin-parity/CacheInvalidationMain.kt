// CacheInvalidationMain.kt — pilote JSON de l'invalidation du cache (#369).
//
// OUTIL DE TEST uniquement : compilé par
// `tests/unit/kotlin-cache-invalidation.test.ts` (jamais par Gradle, jamais
// dans l'APK). Le test compile la VRAIE logique de production
// (`fr.veryslopnynotes.data.CachePolicy`, `OfflineCache`, `WeekWindow` — pure,
// sans Android ni org.json) et la pilote ici.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout, comme les autres pilotes de `agents/runtime/kotlin-parity/`. Les
// erreurs du PILOTE sont préfixées `pilote: ` et refusées par le test.
//
// Ce que le test observe (le vrai comportement du code exécuté) :
// - `invalidate` : l'entrée de cache d'une ressource cesse d'être servie
//   comme fraîche après une écriture confirmée (donc relecture) ;
// - `window` : la fenêtre de recherche du toggle ET de l'affichage (la même
//   fonction) couvre la semaine demandée, et rien au-delà.
package fr.veryslopnynotes.cacheinvalid

import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.InMemoryCacheStore
import fr.veryslopnynotes.data.assignmentWindow
import fr.veryslopnynotes.data.writeAndInvalidate
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets
import java.time.LocalDateTime

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun JVal.Obj.arr(key: String): List<JVal> = (fields[key] as? JVal.Arr)?.items ?: emptyList()

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

/** Ce que l'écran voit d'une entrée de cache : servie ? périmée ? relecture ? */
private fun view(store: InMemoryCacheStore, resource: String, now: Long): JVal.Obj {
    val entry = store.load(resource, "")
    return ok(
        "served" to JVal.Bool(entry != null),
        "stale" to JVal.Bool(entry != null && CachePolicy.isStale(resource, entry.fetchedAt, now)),
        "shouldFetch" to JVal.Bool(CachePolicy.shouldFetch(entry, resource, "", now, false)),
    )
}

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        // Écriture locale : confirmée -> l'entrée de cache part ; refusée ->
        // l'entrée reste (rien n'a été écrit).
        "write" -> {
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val now = (op.num("now") ?: 1_700_000_000_000.0).toLong()
            val fails = (op.num("fails") ?: 0.0) != 0.0
            val store = InMemoryCacheStore()
            store.save(resource, "{\"assignments\":[]}", now, "")
            val before = view(store, resource, now)
            var error: String? = null
            try {
                writeAndInvalidate(store, resource) {
                    if (fails) throw IllegalStateException("écriture refusée")
                }
            } catch (e: Exception) {
                error = e.javaClass.simpleName
            }
            // Ressource voisine : l'invalidation est CIBLÉE (les autres
            // entrées du cache ne partent pas avec).
            val other = op.str("other")
            var otherView: JVal.Obj? = null
            if (other != null) {
                store.save(other, "{\"discussions\":[]}", now, "")
                otherView = view(store, other, now)
            }
            ok(
                "before" to before,
                "after" to view(store, resource, now),
                "error" to JVal.Str(error ?: ""),
                "other" to (otherView ?: JVal.Obj(linkedMapOf())),
            )
        }
        // Fenêtre de lecture : la semaine demandée, ou le repli -7/+21 jours.
        "window" -> {
            val weekStart = op.str("weekStart")
            val now = LocalDateTime.parse(op.str("now") ?: "2026-10-19T12:00:00")
            val (from, to) = assignmentWindow(weekStart, now)
            val inside = mutableListOf<JVal>()
            val outside = mutableListOf<JVal>()
            for (due in op.arr("due")) {
                val raw = (due as? JVal.Str)?.value ?: continue
                val date = LocalDateTime.parse(raw)
                val bucket = if (!date.isBefore(from) && !date.isAfter(to)) inside else outside
                bucket.add(JVal.Str(raw))
            }
            ok(
                "from" to JVal.Str(from.toString()),
                "to" to JVal.Str(to.toString()),
                "inside" to JVal.Arr(inside),
                "outside" to JVal.Arr(outside),
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
            val name = e.javaClass.simpleName
            stderr.println("port: $name: ${e.message}")
            stdout.println(Json.stringify(err(name, e.message)))
        }
    }
}
