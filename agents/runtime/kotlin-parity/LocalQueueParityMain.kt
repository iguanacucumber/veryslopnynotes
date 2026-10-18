// LocalQueueParityMain.kt — pilote JSON de la file d'attente locale (#310).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-local-queue.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile la VRAIE classe de
// production `fr.veryslopnynotes.data.LocalRequestQueue` (logique pure, sans
// Android) et la pilote ici : les deux assertions du critère #310 — au plus
// 1 appel client concurrent ; requêtes identiques en vol = 1 appel, N callbacks
// servis — portent donc sur du code exécuté, pas sur un miroir TS.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout, comme les autres pilotes de `agents/runtime/kotlin-parity/`. Les
// erreurs du PILOTE (op inconnue, `qid`/`key` absent) sont préfixées `pilote: `
// et refusées par le test.
//
// Le « client » simulé est GATED : le travail soumis ne démarre qu'après
// `queueRelease`. Les scénarios sont donc déterministes (aucun sleep de course) :
// on empile les soumissions, on libère, on observe. `workMs` fait durer chaque
// appel pour qu'un chevauchement — s'il y en avait un — soit TOUJOURS vu.
package fr.veryslopnynotes.localqueue

import fr.veryslopnynotes.data.LocalRequestQueue
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap
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
 * État observé d'une file : ce que le test compare aux attentes.
 *
 * `executed` = ordre de DÉMARRAGE des travaux ; `callbacks` = résultats
 * livrés. Chaque exécution porte son numéro par clé (`key#1`, `key#2`…) : deux
 * callbacks dédoublonnés reçoivent le MÊME numéro (un rejeu donnerait `#2`).
 */
private class QueueState {
    val queue = LocalRequestQueue<String>()
    val workCalls = AtomicInteger()
    val inflight = AtomicInteger()
    val maxConcurrent = AtomicInteger()
    val executed = CopyOnWriteArrayList<String>()
    val callbacks = CopyOnWriteArrayList<String>()
    val execCounts = ConcurrentHashMap<String, AtomicInteger>()
    val gate = CountDownLatch(1)

    @Volatile
    var workerThread = ""

    @Volatile
    var workerDaemon = false

    /** Soumission « lecture client » : simule un appel bloquant sur le client. */
    fun submit(key: String, workMs: Long) {
        queue.submit(
            key,
            work = {
                val now = inflight.incrementAndGet()
                maxConcurrent.accumulateAndGet(now) { a, b -> maxOf(a, b) }
                workCalls.incrementAndGet()
                executed.add(key)
                val n = execCounts.computeIfAbsent(key) { AtomicInteger() }.incrementAndGet()
                val t = Thread.currentThread()
                workerThread = t.name
                workerDaemon = t.isDaemon
                gate.await(10, TimeUnit.SECONDS)
                if (workMs > 0) Thread.sleep(workMs)
                inflight.decrementAndGet()
                "$key#$n"
            },
            deliver = { callbacks.add(it) },
        )
    }
}

private class Driver {
    private var nextId = 1
    private val queues = mutableMapOf<Int, QueueState>()

    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        "queueNew" -> {
            val qid = nextId++
            queues[qid] = QueueState()
            ok("qid" to JVal.Num(qid.toDouble()))
        }
        "queueSubmit" -> {
            val state = state(op)
            val key = op.str("key") ?: throw IllegalArgumentException("pilote: key absent")
            state.submit(key, (op.num("workMs") ?: 0.0).toLong())
            ok("ok" to JVal.Bool(true))
        }
        "queueRelease" -> {
            state(op).gate.countDown()
            ok("released" to JVal.Bool(true))
        }
        "queueWait" -> {
            val state = state(op)
            val want = (op.num("callbacks") ?: 0.0).toInt()
            val timeout = (op.num("timeoutMs") ?: 5000.0).toLong()
            val deadline = System.currentTimeMillis() + timeout
            while (state.callbacks.size < want && System.currentTimeMillis() < deadline) Thread.sleep(5)
            ok(
                "served" to JVal.Num(state.callbacks.size.toDouble()),
                "timedOut" to JVal.Bool(state.callbacks.size < want),
            )
        }
        "queueStats" -> {
            val s = state(op)
            ok(
                "workCalls" to JVal.Num(s.workCalls.get().toDouble()),
                "maxConcurrent" to JVal.Num(s.maxConcurrent.get().toDouble()),
                "executed" to JVal.Arr(s.executed.map { JVal.Str(it) }),
                "callbacks" to JVal.Arr(s.callbacks.map { JVal.Str(it) }),
                "thread" to JVal.Str(s.workerThread),
                "daemon" to JVal.Bool(s.workerDaemon),
            )
        }
        else -> throw IllegalArgumentException("pilote: opération inconnue : ${op.str("op")}")
    }

    private fun state(op: JVal.Obj): QueueState =
        queues[(op.num("qid") ?: 0.0).toInt()] ?: throw IllegalArgumentException("pilote: qid inconnu")
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
