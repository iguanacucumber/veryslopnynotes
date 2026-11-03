// SerializedUpdateMain.kt — pilote JSON de la sérialisation des mises à jour.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-serialized-update.test.ts`
// (jamais Gradle, jamais l'APK).
//
// Deux preuves, sur le code de PRODUCTION compilé :
//  - `counter` : N fils font une lecture-modification-écriture sous
//    `SerializedUpdate` ; aucun incrément perdu et jamais deux entrées à la fois.
//  - `notes` : N fils enregistrent une note distincte dans le VRAI
//    `LessonNotesRepository`, avec un store dont la lecture est LENTE (tous les
//    fils lisent le même état si le verrou ne couvre pas la relecture).
package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.LessonNote
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

/**
 * Store dont la LECTURE est lente : sans verrou de dépôt, tous les fils lisent
 * la même liste vide avant que le premier n'ait écrit, et les ajouts se
 * perdent les uns après les autres.
 */
private class DelayStore(private val delayMs: Long) : LessonNotesLocalStore {
    @Volatile
    private var notes: List<LessonNote> = emptyList()

    override fun load(): List<LessonNote> {
        val snapshot = notes
        if (delayMs > 0) Thread.sleep(delayMs)
        return snapshot
    }

    @Synchronized
    override fun save(notes: List<LessonNote>, epoch: Long): Boolean {
        this.notes = notes
        return true
    }

    @Synchronized
    override fun clear(): Boolean {
        notes = emptyList()
        return true
    }
}

private class Driver {
    fun run(op: JVal.Obj): JVal.Obj = when (op.str("op")) {
        "counter" -> counter(op)
        "notes" -> notes(op)
        "notesUnlocked" -> notesUnlocked(op)
        else -> throw IllegalArgumentException("pilote: opération inconnue : ${op.str("op")}")
    }

    /** Incréments concurrents sous le verrou : aucun perdu, un seul entrant. */
    private fun counter(op: JVal.Obj): JVal.Obj {
        val threads = ((op.num("threads") ?: 8.0).toInt()).coerceIn(2, 32)
        val rounds = ((op.num("rounds") ?: 20.0).toInt()).coerceAtLeast(1)
        val lock = SerializedUpdate()
        var value = 0
        val inside = AtomicInteger(0)
        val maxInside = AtomicInteger(0)
        val gate = CountDownLatch(1)
        val ready = CountDownLatch(threads)

        val workers = (0 until threads).map {
            Thread {
                ready.countDown()
                gate.await()
                repeat(rounds) {
                    lock.run {
                        val now = inside.incrementAndGet()
                        while (true) {
                            val seen = maxInside.get()
                            if (now <= seen || maxInside.compareAndSet(seen, now)) break
                        }
                        val current = value
                        // Fenêtre ouverte exprès entre la lecture et l'écriture.
                        Thread.sleep(1)
                        value = current + 1
                        inside.decrementAndGet()
                    }
                }
            }
        }
        for (worker in workers) worker.start()
        ready.await()
        gate.countDown()
        for (worker in workers) worker.join()
        return ok(
            "value" to JVal.Num(value.toDouble()),
            "expected" to JVal.Num((threads * rounds).toDouble()),
            "maxInside" to JVal.Num(maxInside.get().toDouble()),
        )
    }

    /** Ajouts concurrents dans le vrai dépôt : toutes les notes survivent. */
    private fun notes(op: JVal.Obj): JVal.Obj {
        val count = ((op.num("threads") ?: 8.0).toInt())
            .coerceIn(2, fr.veryslopnynotes.core.LessonNotes.MAX_PER_SUBJECT)
        val delayMs = (op.num("delayMs") ?: 50.0).toLong().coerceAtLeast(0L)
        val repo = LessonNotesRepository(DelayStore(delayMs))
        val gate = CountDownLatch(1)
        val ready = CountDownLatch(count)

        val workers = (0 until count).map { i ->
            Thread {
                ready.countDown()
                gate.await()
                repo.save("", "Maths", "Titre $i", "Texte $i", 0L)
            }
        }
        for (worker in workers) worker.start()
        ready.await()
        gate.countDown()
        for (worker in workers) worker.join()

        val stored = repo.notes()
        return ok(
            "count" to JVal.Num(stored.size.toDouble()),
            "expected" to JVal.Num(count.toDouble()),
            "distinct" to JVal.Num(stored.map { it.id }.distinct().size.toDouble()),
        )
    }

    /**
     * Le MÊME store, SANS le verrou de dépôt : c'est la perte de mise à jour
     * que le test doit détecter. Il ne tourne que pour prouver que le scénario
     * est sensible (jamais dans le chemin de production).
     */
    private fun notesUnlocked(op: JVal.Obj): JVal.Obj {
        val count = ((op.num("threads") ?: 8.0).toInt()).coerceIn(2, 8)
        val delayMs = (op.num("delayMs") ?: 50.0).toLong().coerceAtLeast(0L)
        val store = DelayStore(delayMs)
        val gate = CountDownLatch(1)
        val ready = CountDownLatch(count)

        val workers = (0 until count).map { i ->
            Thread {
                ready.countDown()
                gate.await()
                val current = store.load()
                val note = LessonNote(
                    id = "n$i",
                    subject = "Maths",
                    title = "Titre $i",
                    text = "Texte $i",
                    createdAt = "2026-10-19T08:00:00Z",
                )
                store.save(current + note, 0L)
            }
        }
        for (worker in workers) worker.start()
        ready.await()
        gate.countDown()
        for (worker in workers) worker.join()
        return ok(
            "count" to JVal.Num(store.load().size.toDouble()),
            "expected" to JVal.Num(count.toDouble()),
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
