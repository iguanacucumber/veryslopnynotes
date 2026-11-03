// CacheBoundsParityMain.kt — pilote JSON des bornes du cache.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-cache-bounds.test.ts` (jamais Gradle, jamais l'APK).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.cachebounds

import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.CacheStore
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

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private class Slot(val id: Int, val dir: File?, val store: CacheStore)

private class Bench {
    private val slots = LinkedHashMap<Int, Slot>()
    private val roots = mutableListOf<File>()
    private var nextId = 1

    fun newSlot(kind: String): Slot {
        val slot = if (kind == "memory") {
            Slot(nextId++, null, InMemoryCacheStore())
        } else {
            val root = Files.createTempDirectory("vsn-cache-bounds").toFile()
            roots.add(root)
            Slot(nextId++, root, FileCacheStore(root))
        }
        slots[slot.id] = slot
        return slot
    }

    fun slot(op: JVal.Obj): Slot {
        val id = (op.num("sid") ?: 0.0).toInt()
        return slots[id] ?: throw IllegalArgumentException("pilote: sid inconnu ($id)")
    }

    fun cleanup() {
        for (root in roots) root.deleteRecursively()
        roots.clear()
        slots.clear()
    }
}

private class Driver {
    private val bench = Bench()

    fun run(op: JVal.Obj): JVal.Obj = when (op.str("op")) {
        "newStore" -> {
            val slot = bench.newSlot(op.str("kind") ?: "file")
            ok("sid" to JVal.Num(slot.id.toDouble()))
        }
        "budgets" -> ok(
            "maxPayloadBytes" to JVal.Num(CachePolicy.MAX_PAYLOAD_BYTES.toDouble()),
            "maxTotalBytes" to JVal.Num(CachePolicy.MAX_TOTAL_BYTES.toDouble()),
        )
        "maxEntries" -> {
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            ok("maxEntries" to JVal.Num(CachePolicy.maxEntriesFor(resource).toDouble()))
        }
        "save" -> {
            val slot = bench.slot(op)
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val payload = op.str("payload") ?: ""
            val fetchedAt = (op.num("fetchedAt") ?: 0.0).toLong()
            slot.store.save(resource, payload, fetchedAt, op.str("query") ?: "")
            ok("saved" to JVal.Bool(true))
        }
        "load" -> {
            val slot = bench.slot(op)
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val loaded = slot.store.load(resource, op.str("query") ?: "")
            if (loaded == null) {
                ok("found" to JVal.Bool(false))
            } else {
                ok(
                    "found" to JVal.Bool(true),
                    "payload" to JVal.Str(loaded.payload),
                    "fetchedAt" to JVal.Num(loaded.fetchedAt.toDouble()),
                )
            }
        }
        "payloads" -> {
            val slot = bench.slot(op)
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            ok("payloads" to JVal.Arr(slot.store.payloads(resource).map { JVal.Str(it) }))
        }
        "freshPayloads" -> {
            val slot = bench.slot(op)
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val now = (op.num("now") ?: 0.0).toLong()
            ok("payloads" to JVal.Arr(slot.store.freshPayloads(resource, now).map { JVal.Str(it) }))
        }
        "files" -> {
            val slot = bench.slot(op)
            val names = slot.dir?.listFiles()?.map { it.name }?.sorted() ?: emptyList()
            ok("files" to JVal.Arr(names.map { JVal.Str(it) }))
        }
        // Fichier brut : simule une entrée d'une version antérieure, sans
        // passer par la validation d'écriture.
        "writeRaw" -> {
            val slot = bench.slot(op)
            val dir = slot.dir ?: throw IllegalArgumentException("pilote: writeRaw sur mémoire")
            val name = op.str("name") ?: throw IllegalArgumentException("pilote: name absent")
            File(dir, name).writeText(op.str("content") ?: "")
            ok("written" to JVal.Bool(true))
        }
        "cleanup" -> {
            bench.cleanup()
            ok("ok" to JVal.Bool(true))
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
