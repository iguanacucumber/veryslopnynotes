// PacingParityMain.kt — pilote JSON du seau à jetons et de la file cadencée.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-pacing.test.ts`.
package fr.veryslopnynotes.pacing

import fr.veryslopnynotes.data.FileCooldownStore
import fr.veryslopnynotes.data.LocalRequestQueue
import fr.veryslopnynotes.data.QueueOutcome
import fr.veryslopnynotes.data.QueuePacer
import fr.veryslopnynotes.data.SchoolPacer
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import fr.veryslopnynotes.pronote.RateLimitedError
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private fun nums(values: List<Long>): JVal = JVal.Arr(values.map { JVal.Num(it.toDouble()) })

/** Horloge factice : `sleep` avance le temps au lieu d'attendre. */
private class FakeTime {
    var now: Long = 0L
    val sleeps = mutableListOf<Long>()

    fun sleep(ms: Long) {
        sleeps.add(ms)
        now += ms
    }
}

private class Driver {
    private fun pacer(
        time: FakeTime,
        capacity: Int = 1,
        refillMs: Long = 1_000L,
        jitterMs: Long = 0L,
        random: Double = 0.0,
        store: fr.veryslopnynotes.data.CooldownStore? = null,
    ): SchoolPacer = SchoolPacer(
        capacity = capacity,
        refillMs = refillMs,
        jitterMs = jitterMs,
        clock = { time.now },
        sleep = time::sleep,
        random = { random },
    ).also { it.attachStore(store) }

    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        // Trois tours : le premier passe, les deux suivants attendent le seau.
        "bucket" -> {
            val time = FakeTime()
            val p = pacer(time)
            val starts = mutableListOf<Long>()
            repeat(3) {
                p.awaitTurn()
                starts.add(time.now)
            }
            ok("starts" to nums(starts), "sleeps" to nums(time.sleeps))
        }

        // La gigue décale les tours SUIVANTS, jamais le premier.
        "jitter" -> {
            val time = FakeTime()
            val p = pacer(time, jitterMs = 200L, random = 0.5)
            val starts = mutableListOf<Long>()
            repeat(3) {
                p.awaitTurn()
                starts.add(time.now)
            }
            ok("starts" to nums(starts), "sleeps" to nums(time.sleeps))
        }

        // Un cooldown plus court ne raccourcit jamais une fenêtre déjà armée.
        "cooldown" -> {
            val time = FakeTime()
            val p = pacer(time)
            p.armCooldown(5_000L)
            val first = p.remainingCooldownMs()
            p.armCooldown(2_000L)
            val kept = p.remainingCooldownMs()
            p.awaitTurn()
            ok(
                "first" to JVal.Num(first.toDouble()),
                "kept" to JVal.Num(kept.toDouble()),
                "waited" to nums(time.sleeps),
            )
        }

        // `Retry-After` est un plancher ; absent, la fenêtre par défaut s'arme.
        "onFailure" -> {
            val time = FakeTime()
            val p = pacer(time)
            p.onFailure(RateLimitedError(retryAfterMs = 300_000L))
            val retryAfter = p.remainingCooldownMs()
            val time2 = FakeTime()
            val p2 = pacer(time2)
            p2.onFailure(RateLimitedError())
            val fallback = p2.remainingCooldownMs()
            ok("retryAfter" to JVal.Num(retryAfter.toDouble()), "fallback" to JVal.Num(fallback.toDouble()))
        }

        // Deux instances successives = redémarrage : la fenêtre survit.
        "persist" -> {
            val dir = Files.createTempDirectory("pacing").toFile()
            val file = java.io.File(dir, "cooldown")
            val first = FakeTime()
            val p1 = pacer(first, store = FileCooldownStore(file))
            p1.armCooldown(12_000L)
            val second = FakeTime()
            val p2 = pacer(second, store = FileCooldownStore(file))
            val remaining = p2.remainingCooldownMs()
            file.writeText("pas-un-nombre")
            val afterCorruption = pacer(FakeTime(), store = FileCooldownStore(file)).remainingCooldownMs()
            dir.deleteRecursively()
            ok("remaining" to JVal.Num(remaining.toDouble()), "corrupt" to JVal.Num(afterCorruption.toDouble()))
        }

        // La file appelle le pacer UNE fois par travail, et un seul à la fois.
        "queue" -> {
            val turns = AtomicInteger()
            val workCalls = AtomicInteger()
            val maxConcurrent = AtomicInteger()
            val inflight = AtomicInteger()
            val callbacks = CopyOnWriteArrayList<String>()
            val pacer = object : QueuePacer {
                override fun awaitTurn() {
                    turns.incrementAndGet()
                }

                override fun onFailure(cause: Throwable) {}
            }
            val queue = LocalRequestQueue<String>().also { it.attachPacer(pacer) }
            val total = 20
            val done = CountDownLatch(total)
            for (i in 0 until total) {
                queue.submit(
                    "key|$i",
                    work = {
                        val now = inflight.incrementAndGet()
                        maxConcurrent.accumulateAndGet(now) { a, b -> maxOf(a, b) }
                        workCalls.incrementAndGet()
                        try {
                            Thread.sleep(5)
                            "ok|$i"
                        } finally {
                            inflight.decrementAndGet()
                        }
                    },
                    deliver = { o ->
                        callbacks.add(if (o is QueueOutcome.Ok) o.value else "failed")
                        done.countDown()
                    },
                )
            }
            done.await(10, TimeUnit.SECONDS)
            ok(
                "turns" to JVal.Num(turns.get().toDouble()),
                "workCalls" to JVal.Num(workCalls.get().toDouble()),
                "maxConcurrent" to JVal.Num(maxConcurrent.get().toDouble()),
                "callbacks" to JVal.Num(callbacks.size.toDouble()),
            )
        }

        // File + VRAI seau : les départs sont espacés, jamais chevauchés.
        "pacedQueue" -> {
            val starts = CopyOnWriteArrayList<Long>()
            val maxConcurrent = AtomicInteger()
            val inflight = AtomicInteger()
            val done = CountDownLatch(6)
            val queue = LocalRequestQueue<String>().also {
                it.attachPacer(
                    SchoolPacer(
                        capacity = 1,
                        refillMs = 30L,
                        jitterMs = 0L,
                        clock = { System.nanoTime() / 1_000_000L },
                        sleep = { ms -> if (ms > 0L) Thread.sleep(ms) },
                        random = { 0.0 },
                    ),
                )
            }
            repeat(6) { i ->
                queue.submit(
                    "paced|$i",
                    work = {
                        starts.add(System.nanoTime() / 1_000_000L)
                        val now = inflight.incrementAndGet()
                        maxConcurrent.accumulateAndGet(now) { a, b -> maxOf(a, b) }
                        try {
                            Thread.sleep(2)
                            "ok"
                        } finally {
                            inflight.decrementAndGet()
                        }
                    },
                    deliver = { done.countDown() },
                )
            }
            done.await(10, TimeUnit.SECONDS)
            val gaps = starts.sorted().zipWithNext { a, b -> b - a }
            ok(
                "maxConcurrent" to JVal.Num(maxConcurrent.get().toDouble()),
                "gaps" to nums(gaps),
                "served" to JVal.Num(starts.size.toDouble()),
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
