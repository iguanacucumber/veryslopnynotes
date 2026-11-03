// CacheStorageClockParityMain.kt — pilote JSON du stockage plein et de l'horloge.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-cache-storage-clock.test.ts` (jamais Gradle, jamais l'APK).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.cachestorage

import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.CacheScope
import fr.veryslopnynotes.data.FileCacheStore
import fr.veryslopnynotes.data.OfflineArtifacts
import fr.veryslopnynotes.data.SessionEpoch
import fr.veryslopnynotes.data.weekWindow
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.File
import java.io.IOException
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

/**
 * Un store + son dossier `offline/`. [mode] change le writer APRÈS coup : les
 * tests écrivent d'abord une entrée saine, puis injectent la panne.
 */
private class Slot(val id: Int, val dir: File, var mode: String) {
    val store = FileCacheStore(
        dir,
        { target, bytes ->
            when (mode) {
                "fail" -> throw IOException("No space left on device")
                "partial" -> {
                    target.writeBytes(bytes.copyOf(maxOf(1, bytes.size / 2)))
                    throw IOException("No space left on device")
                }
                else -> target.writeBytes(bytes)
            }
        },
    )
}

private class Bench {
    private val slots = LinkedHashMap<Int, Slot>()
    private val roots = mutableListOf<File>()
    private var nextId = 1

    fun newSlot(mode: String): Slot {
        val root = Files.createTempDirectory("vsn-cache-storage-clock").toFile()
        roots.add(root)
        val slot = Slot(nextId++, root, mode)
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
            val slot = bench.newSlot(op.str("mode") ?: "ok")
            ok("sid" to JVal.Num(slot.id.toDouble()))
        }
        "setMode" -> {
            val slot = bench.slot(op)
            slot.mode = op.str("mode") ?: "ok"
            ok("mode" to JVal.Str(slot.mode))
        }
        "save" -> {
            val slot = bench.slot(op)
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            slot.store.save(
                resource,
                op.str("payload") ?: "",
                (op.num("fetchedAt") ?: 0.0).toLong(),
                op.str("query") ?: "",
            )
            ok("saved" to JVal.Bool(true))
        }
        "load" -> {
            val slot = bench.slot(op)
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val entry = slot.store.load(resource, op.str("query") ?: "")
            if (entry == null) {
                ok("found" to JVal.Bool(false))
            } else {
                ok(
                    "found" to JVal.Bool(true),
                    "payload" to JVal.Str(entry.payload),
                    "fetchedAt" to JVal.Num(entry.fetchedAt.toDouble()),
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
            ok("files" to JVal.Arr((slot.dir.listFiles()?.map { it.name }?.sorted() ?: emptyList()).map { JVal.Str(it) }))
        }
        "stale" -> {
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            ok(
                "stale" to JVal.Bool(
                    CachePolicy.isStale(
                        resource,
                        (op.num("fetchedAt") ?: 0.0).toLong(),
                        (op.num("now") ?: 0.0).toLong(),
                    ),
                ),
            )
        }
        "shouldFetch" -> {
            val slot = bench.slot(op)
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val query = op.str("query") ?: ""
            val now = (op.num("now") ?: 0.0).toLong()
            ok(
                "fetch" to JVal.Bool(
                    CachePolicy.shouldFetch(slot.store.load(resource, query), resource, query, now, false),
                ),
            )
        }
        "isExpired" -> ok(
            "expired" to JVal.Bool(
                CachePolicy.isExpired(
                    (op.num("ttl") ?: 0.0).toLong(),
                    (op.num("at") ?: 0.0).toLong(),
                    (op.num("now") ?: 0.0).toLong(),
                ),
            ),
        )
        "purge" -> {
            val slot = bench.slot(op)
            ok("cleared" to JVal.Bool(CacheScope.purge(slot.store)))
        }
        // Fenêtre EDT : lundi 00:00 Paris -> lundi suivant 00:00 − 1 ms.
        "window" -> {
            val win = weekWindow(op.str("weekStart"))
                ?: throw IllegalArgumentException("pilote: semaine illisible")
            ok("from" to JVal.Num(win.first.toDouble()), "to" to JVal.Num(win.second.toDouble()))
        }
        // Écriture HORS CacheStore : le writer est injecté pour simuler le disque plein.
        "artifactWrite" -> {
            val slot = bench.slot(op)
            val name = op.str("name") ?: "subject_prefs.json"
            val content = op.str("content") ?: "[]"
            val epoch = SessionEpoch.current()
            val file = File(slot.dir, name)
            val written = when (op.str("mode") ?: "ok") {
                "fail" -> OfflineArtifacts.writeText(file, content, epoch) { _, _ ->
                    throw IOException("No space left on device")
                }
                "partial" -> OfflineArtifacts.writeText(file, content, epoch) { target, bytes ->
                    target.writeBytes(bytes.copyOf(maxOf(1, bytes.size / 2)))
                    throw IOException("No space left on device")
                }
                else -> OfflineArtifacts.writeText(file, content, epoch)
            }
            ok("written" to JVal.Bool(written))
        }
        "artifactRead" -> {
            val slot = bench.slot(op)
            val name = op.str("name") ?: "subject_prefs.json"
            val file = File(slot.dir, name)
            ok(
                "exists" to JVal.Bool(file.isFile),
                "content" to JVal.Str(if (file.isFile) file.readText() else ""),
            )
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
