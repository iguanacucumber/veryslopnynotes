// BridgeExecutorsMain.kt — pilote JSON des exécuteurs du pont.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-bridge-executors.test.ts` (jamais Gradle, jamais l'APK).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.bridgeexec

import fr.veryslopnynotes.app.BridgeExecutors
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets
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

/**
 * Une instance d'exécuteurs et ce qu'on observe dessus.
 *
 * `callsMax` / `llmMax` = nombre de travaux lents en vol au PLUSIEUR, par
 * file : une file bornée à deux fils ne peut pas en faire tourner trois à la
 * fois (le troisième ATTEND un fil libre).
 */
private class ExecState {
    val executors = BridgeExecutors()
    val gate = CountDownLatch(1)
    val started = AtomicInteger()
    val callsInflight = AtomicInteger()
    val llmInflight = AtomicInteger()
    val callsMax = AtomicInteger()
    val llmMax = AtomicInteger()
    val threads = CopyOnWriteArrayList<String>()

    /** Délai (ms) entre la soumission et le DÉBUT d'exécution de l'appel court. */
    @Volatile
    var shortDelayMs = -1L

    @Volatile
    var shortThread = ""

    @Volatile
    var shortDaemon = false

    /** Travaux lents : ils démarrent, puis attendent la libération. */
    fun submitSlow(count: Int, method: String) {
        val llm = method in BridgeExecutors.LLM_METHODS
        repeat(count) {
            executors.workerFor(method).execute {
                val now = if (llm) llmInflight.incrementAndGet() else callsInflight.incrementAndGet()
                if (llm) llmMax.accumulateAndGet(now) { a, b -> maxOf(a, b) }
                else callsMax.accumulateAndGet(now) { a, b -> maxOf(a, b) }
                started.incrementAndGet()
                threads.add(Thread.currentThread().name)
                gate.await(30, TimeUnit.SECONDS)
                if (llm) llmInflight.decrementAndGet() else callsInflight.decrementAndGet()
            }
        }
    }

    /** Appel court : il mesure combien de temps il a attendu son fil. */
    fun submitShort(method: String) {
        val sent = System.currentTimeMillis()
        executors.workerFor(method).execute {
            shortDelayMs = System.currentTimeMillis() - sent
            val t = Thread.currentThread()
            shortThread = t.name
            shortDaemon = t.isDaemon
        }
    }
}

private class Driver {
    private var nextId = 1
    private val states = mutableMapOf<Int, ExecState>()

    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        "execNew" -> {
            val qid = nextId++
            states[qid] = ExecState()
            ok("qid" to JVal.Num(qid.toDouble()))
        }
        "execSlow" -> {
            val s = state(op)
            s.submitSlow((op.num("count") ?: 1.0).toInt(), op.str("method") ?: "resources.load")
            ok("ok" to JVal.Bool(true))
        }
        "execWaitStarted" -> {
            val s = state(op)
            val want = (op.num("want") ?: 1.0).toInt()
            val timeout = (op.num("timeoutMs") ?: 5000.0).toLong()
            val deadline = System.currentTimeMillis() + timeout
            while (s.started.get() < want && System.currentTimeMillis() < deadline) Thread.sleep(5)
            ok(
                "started" to JVal.Num(s.started.get().toDouble()),
                "timedOut" to JVal.Bool(s.started.get() < want),
            )
        }
        "execShort" -> {
            state(op).submitShort(op.str("method") ?: "app.back")
            ok("ok" to JVal.Bool(true))
        }
        "execWaitShort" -> {
            val s = state(op)
            val timeout = (op.num("timeoutMs") ?: 5000.0).toLong()
            val deadline = System.currentTimeMillis() + timeout
            while (s.shortDelayMs < 0 && System.currentTimeMillis() < deadline) Thread.sleep(5)
            ok(
                "delayMs" to JVal.Num(s.shortDelayMs.toDouble()),
                "thread" to JVal.Str(s.shortThread),
                "daemon" to JVal.Bool(s.shortDaemon),
                "timedOut" to JVal.Bool(s.shortDelayMs < 0),
            )
        }
        "execStats" -> {
            val s = state(op)
            ok(
                "started" to JVal.Num(s.started.get().toDouble()),
                "callsMax" to JVal.Num(s.callsMax.get().toDouble()),
                "llmMax" to JVal.Num(s.llmMax.get().toDouble()),
                "threads" to JVal.Arr(s.threads.map { JVal.Str(it) }),
            )
        }
        "execRelease" -> {
            state(op).gate.countDown()
            ok("ok" to JVal.Bool(true))
        }
        "execShutdown" -> {
            state(op).executors.shutdown()
            ok("ok" to JVal.Bool(true))
        }
        else -> throw IllegalArgumentException("pilote: opération inconnue : ${op.str("op")}")
    }

    private fun state(op: JVal.Obj): ExecState =
        states[(op.num("qid") ?: 0.0).toInt()] ?: throw IllegalArgumentException("pilote: qid inconnu")
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
