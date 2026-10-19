// CacheEpochParityMain.kt — pilote JSON du cache et de l'epoch de session (#364).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-cache-epoch.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile les VRAIES classes de
// production `fr.veryslopnynotes.data.SessionEpoch` et
// `fr.veryslopnynotes.data.FileCacheStore` (logique pure : `java.io` seul,
// aucun import Android) et les pilote ici : les assertions du critère #364
// portent donc sur du code exécuté, pas sur un miroir TS.
//
// Scénarios rejoués : une lecture EN VOL traverse une déconnexion (le cache
// doit rester vide sur le disque), deux écrivains concurrents sur le MÊME
// dossier (le fichier relu doit toujours être parsable), une lecture normale
// (le cache est écrit).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout, comme les autres pilotes de `agents/runtime/kotlin-parity/`. Les
// erreurs du PILOTE (op inconnue, sid absent) sont préfixées `pilote: ` et
// refusées par le test.
package fr.veryslopnynotes.cacheepoch

import fr.veryslopnynotes.data.FileCacheStore
import fr.veryslopnynotes.data.SessionEpoch
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

/**
 * Un store + son dossier. Le worker de fond a sa PROPRE instance sur le même
 * dossier que l'app : c'est exactement le cas que #364 visait (deux
 * écrivains, un seul dossier).
 */
private class Slot(val id: Int, val dir: File) {
    val store = FileCacheStore(dir)
}

private class Bench {
    private val slots = LinkedHashMap<Int, Slot>()
    private val roots = mutableListOf<File>()
    private var nextId = 1

    fun newSlot(): Slot {
        val root = Files.createTempDirectory("vsn-cache-epoch").toFile()
        roots.add(root)
        return register(root)
    }

    /** Seconde instance sur le MÊME dossier (l'app + le worker de fond). */
    fun sameDir(slot: Slot): Slot = register(slot.dir)

    private fun register(dir: File): Slot {
        val slot = Slot(nextId++, dir)
        slots[slot.id] = slot
        return slot
    }

    fun slot(op: JVal.Obj, key: String = "sid"): Slot {
        val id = (op.num(key) ?: 0.0).toInt()
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
            val slot = bench.newSlot()
            ok("sid" to JVal.Num(slot.id.toDouble()), "dir" to JVal.Str(slot.dir.absolutePath))
        }
        "newStoreSameDir" -> {
            val slot = bench.sameDir(bench.slot(op))
            ok("sid" to JVal.Num(slot.id.toDouble()))
        }
        "epoch" -> ok("epoch" to JVal.Num(SessionEpoch.current().toDouble()))
        "write" -> {
            val slot = bench.slot(op)
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val payload = op.str("payload") ?: ""
            val at = (op.num("fetchedAt") ?: 0.0).toLong()
            // #365 : l'entree porte la requete qui l'a produite.
            slot.store.save(resource, payload, at, op.str("query") ?: "")
            ok("ok" to JVal.Bool(true))
        }
        // Début d'une lecture : l'époque est capturée AVANT la lecture locale.
        "readBegin" -> ok("epoch" to JVal.Num(SessionEpoch.current().toDouble()))
        // Fin de lecture : l'écriture est gardée par l'époque capturée.
        "readEnd" -> {
            val slot = bench.slot(op)
            val epoch = (op.num("epoch") ?: 0.0).toLong()
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val payload = op.str("payload") ?: ""
            val at = (op.num("fetchedAt") ?: 0.0).toLong()
            val written = SessionEpoch.writeIfCurrent(epoch) {
                slot.store.save(resource, payload, at, op.str("query") ?: "")
            }
            ok("written" to JVal.Bool(written != null))
        }
        // Déconnexion : invalidation de l'époque ET purge, même section critique.
        "logout" -> {
            val slot = bench.slot(op)
            SessionEpoch.invalidate { slot.store.clearAll() }
            ok("epoch" to JVal.Num(SessionEpoch.current().toDouble()))
        }
        "load" -> {
            val slot = bench.slot(op)
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val entry = slot.store.load(resource)
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
        // Contenu BRUT du fichier : le format sur disque est figé par le test.
        "raw" -> {
            val slot = bench.slot(op)
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val file = File(slot.dir, "cache_$resource.txt")
            val content = if (file.exists()) file.readText() else ""
            ok("exists" to JVal.Bool(file.exists()), "content" to JVal.Str(content))
        }
        "files" -> {
            val slot = bench.slot(op)
            val names = slot.dir.listFiles()?.map { it.name }?.sorted() ?: emptyList()
            ok("files" to JVal.Arr(names.map { JVal.Str(it) }))
        }
        "concurrent" -> concurrent(op)
        "cleanup" -> {
            bench.cleanup()
            ok("ok" to JVal.Bool(true))
        }
        else -> throw IllegalArgumentException("pilote: opération inconnue : ${op.str("op")}")
    }

    /**
     * Deux écrivains concurrents (deux instances, un dossier) et un lecteur qui
     * relit le fichier SANS prendre le verrou : c'est lui qui voit le fichier
     * à moitié écrit si l'écriture n'est pas atomique.
     */
    private fun concurrent(op: JVal.Obj): JVal.Obj {
        val a = bench.slot(op, "a")
        val b = bench.slot(op, "b")
        val resource = op.str("resource") ?: "grades"
        val rounds = (op.num("rounds") ?: 20.0).toInt().coerceAtLeast(1)
        val size = (op.num("size") ?: 32768.0).toInt().coerceAtLeast(1)
        // Payloads distincts et reconnaissables : un fichier entrelacé
        // n'appartient à aucun d'eux, un fichier tronqué n'est pas parsable.
        val payloads = (0 until rounds).map { i -> "{\"w\":\"$i\",\"pad\":\"" + "x".repeat(size) + "\"}" }
        val known = payloads.toHashSet()
        val file = File(a.dir, "cache_$resource.txt")
        val reads = AtomicInteger()
        val bad = AtomicInteger()
        val mixed = AtomicInteger()
        val running = AtomicBoolean(true)
        val start = CountDownLatch(1)
        val reader = Thread {
            start.await()
            while (running.get()) {
                if (!file.exists()) continue
                val text = try {
                    file.readText()
                } catch (_: Exception) {
                    ""
                }
                reads.incrementAndGet()
                val cut = text.indexOf('\n')
                // #365 : l'en-tete est « fetchedAt<TAB>requete » : l'horodatage
                // est ce qui precede le TAB.
                val head = if (cut < 0) null else text.substring(0, cut)
                val ts = head?.substringBefore('\t')?.toLongOrNull()
                val payload = if (cut < 0) null else text.substring(cut + 1)
                if (ts == null || payload == null) bad.incrementAndGet()
                else if (!known.contains(payload)) mixed.incrementAndGet()
            }
        }
        reader.isDaemon = true
        reader.start()
        val writers = (0 until 4).map { w ->
            Thread {
                start.await()
                for (i in 0 until rounds) {
                    val idx = (w * rounds + i) % payloads.size
                    val store = if (w % 2 == 0) a.store else b.store
                    store.save(resource, payloads[idx], 1000L + idx, "")
                }
            }
        }
        for (w in writers) w.start()
        start.countDown()
        for (w in writers) w.join()
        running.set(false)
        reader.join(2000)
        return ok(
            "reads" to JVal.Num(reads.get().toDouble()),
            "bad" to JVal.Num(bad.get().toDouble()),
            "mixed" to JVal.Num(mixed.get().toDouble()),
        )
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
