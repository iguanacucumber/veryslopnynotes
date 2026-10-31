// CacheQueryParityMain.kt — pilote JSON du cache par requête.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-cache-query.test.ts` (jamais Gradle, jamais l'APK).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.cachequery

import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.CacheStore
import fr.veryslopnynotes.data.CachedEntry
import fr.veryslopnynotes.data.FileCacheStore
import fr.veryslopnynotes.data.InMemoryCacheStore
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets
import java.nio.file.Files

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun JVal.Obj.bool(key: String): Boolean? = (fields[key] as? JVal.Bool)?.value

private fun JVal.Obj.obj(key: String): JVal.Obj? = fields[key] as? JVal.Obj

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

/** Entrée de cache décrite par le test (null = pas d'entrée du tout). */
private fun entryOf(op: JVal.Obj): CachedEntry? {
    val e = op.obj("entry") ?: return null
    return CachedEntry(
        payload = e.str("payload") ?: "",
        fetchedAt = (e.num("fetchedAt") ?: 0.0).toLong(),
        query = e.str("query") ?: "",
    )
}

private class Driver {
    // Deux magasins VRAIS : le même état qu'en production (un fichier par
    // ressource) et le magasin mémoire des tests.
    private val memory = InMemoryCacheStore()
    private var dir: File? = null

    private fun store(kind: String?): CacheStore {
        if (kind != "file") return memory
        val d = dir ?: Files.createTempDirectory("vsn-cache").toFile().also { dir = it }
        return FileCacheStore(d)
    }

    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        "shouldFetch" -> {
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val query = op.str("query") ?: ""
            val now = (op.num("now") ?: 0.0).toLong()
            val force = op.bool("force") ?: false
            val fetch = CachePolicy.shouldFetch(entryOf(op), resource, query, now, force)
            ok("fetch" to JVal.Bool(fetch))
        }
        "normalizeQuery" -> {
            val query = op.str("query") ?: ""
            ok("query" to JVal.Str(CachePolicy.normalizeQuery(query)))
        }
        // La clé de dédoublonnage d'une lecture en vol : le fait
        // d'ÉCRIRE le cache en fait partie.
        "dedupKey" -> {
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val query = op.str("query") ?: ""
            val save = op.bool("save") ?: false
            ok("key" to JVal.Str(CachePolicy.dedupKey(resource, query, save)))
        }
        "save" -> {
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val payload = op.str("payload") ?: ""
            val fetchedAt = (op.num("fetchedAt") ?: 0.0).toLong()
            val query = op.str("query") ?: ""
            store(op.str("store")).save(resource, payload, fetchedAt, query)
            ok("saved" to JVal.Bool(true))
        }
        "load" -> {
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val query = op.str("query") ?: ""
            val loaded = store(op.str("store")).load(resource, query)
            if (loaded == null) {
                ok("found" to JVal.Bool(false))
            } else {
                ok(
                    "found" to JVal.Bool(true),
                    "query" to JVal.Str(loaded.query),
                    "fetchedAt" to JVal.Num(loaded.fetchedAt.toDouble()),
                    "payload" to JVal.Str(loaded.payload),
                )
            }
        }
        // TOUS les payloads de la ressource (une entrée par requête).
        "payloads" -> {
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val payloads = store(op.str("store")).payloads(resource)
            ok("payloads" to JVal.Arr(payloads.map { JVal.Str(it) }))
        }
        // Purge de la ressource : TOUTES ses entrées.
        "clear" -> {
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            store(op.str("store")).clear(resource)
            ok("ok" to JVal.Bool(true))
        }
        // Purge TOTALE (déconnexion) : plus aucune entrée, nulle part.
        "clearAll" -> {
            store(op.str("store")).clearAll()
            ok("ok" to JVal.Bool(true))
        }
        // Fichier sans requête dans l'en-tête : l'entrée ne répond à aucune
        // requête, elle doit être ignorée.
        "writeLegacy" -> {
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val payload = op.str("payload") ?: ""
            val fetchedAt = (op.num("fetchedAt") ?: 0.0).toLong()
            val d = dir ?: Files.createTempDirectory("vsn-cache").toFile().also { dir = it }
            File(d, "cache_$resource.txt").writeText("$fetchedAt\n$payload")
            ok("written" to JVal.Bool(true))
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
