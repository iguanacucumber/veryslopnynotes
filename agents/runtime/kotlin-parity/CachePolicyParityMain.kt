// CachePolicyParityMain.kt — pilote JSON de la politique de fraîcheur (#372).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-cache-policy.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile la VRAIE classe de
// production `fr.veryslopnynotes.data.CachePolicy` (logique pure : ni Android
// ni réseau) et la pilote ici — le verdict « périmé » (badge) et la décision
// « relecture du client local » portent donc sur du code EXÉCUTÉ, pas sur un
// miroir TS.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout (comme les autres pilotes de `agents/runtime/kotlin-parity/`). Les
// erreurs du PILOTE (op inconnue, champ absent) sont préfixées `pilote: ` et
// refusées par le test.
package fr.veryslopnynotes.cachepolicy

import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.CachedEntry
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun JVal.Obj.bool(key: String): Boolean? = (fields[key] as? JVal.Bool)?.value

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        "isStale" -> {
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val fetchedAt = (op.num("fetchedAt") ?: 0.0).toLong()
            val now = (op.num("now") ?: 0.0).toLong()
            ok("stale" to JVal.Bool(CachePolicy.isStale(resource, fetchedAt, now)))
        }
        "shouldFetch" -> {
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val fetchedAt = (op.num("fetchedAt") ?: 0.0).toLong()
            val now = (op.num("now") ?: 0.0).toLong()
            val force = op.bool("force") ?: false
            // #365 : la requête fait partie de l'identité de l'entrée.
            val query = op.str("query") ?: ""
            val entry = if (op.bool("entry") ?: false) CachedEntry("payload", fetchedAt, query) else null
            ok("fetch" to JVal.Bool(CachePolicy.shouldFetch(entry, resource, query, now, force)))
        }
        "ttl" -> {
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            ok("ttl" to JVal.Num(CachePolicy.ttlFor(resource).toDouble()))
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
