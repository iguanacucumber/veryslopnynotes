// LocalQueueParityMain.kt — pilote JSON de la file d'attente locale (#310).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-local-queue.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile la VRAIE classe de
// production `fr.veryslopnynotes.data.LocalRequestQueue` (logique pure, sans
// Android) et la pilote ici : les deux assertions du critère #310 — au plus
// 1 appel client concurrent ; requêtes identiques en vol = 1 appel, N callbacks
// servis — portent donc sur du code exécuté, pas sur un miroir TS.
//
// #403 : le pilote connaît aussi la file PARTAGÉE (`ClientQueue`), celle que
// l'interface ET le job de fond utilisent. Les scénarios sont les mêmes
// (travaux GATED : on empile, on libère, on observe).
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
//
// #530 : `fail` fait JETER le travail (`exception` ou `error`) : le pilote
// observe alors ce que la file LIVRE aux callbacks (un échec, pas un silence).
// `type: "int"` pose un travail d'un AUTRE type sous la MÊME clé : c'est la
// collision qui fait jeter le cast interne de `ClientQueue`.
package fr.veryslopnynotes.localqueue

import fr.veryslopnynotes.data.ClientQueue
import fr.veryslopnynotes.data.LocalRequestQueue
import fr.veryslopnynotes.data.QueueOutcome
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

/** Marqueur « l'attente a dépassé son délai » (résultat absent). */
private const val TIMEOUT = "__timeout__"

/**
 * L'échec que le travail simulé jette (`exception` ou `error`), ou `null`.
 *
 * `error` = un `Error` (OOM) : ce n'est PAS une `Exception`, et l'issue
 * #530 le veut traité comme les autres.
 */
private fun failureOf(kind: String?): Throwable? = when (kind) {
    null -> null
    "exception" -> IllegalStateException("travail en échec")
    "error" -> OutOfMemoryError("mémoire épuisée")
    else -> throw IllegalArgumentException("pilote: échec inconnu : $kind")
}

/** Ce que la file livre : la valeur, ou l'échec (classe de la cause). */
private fun describe(o: QueueOutcome<*>): String = when (o) {
    is QueueOutcome.Ok -> o.value.toString()
    is QueueOutcome.Failed -> "failed:${o.cause.javaClass.simpleName}"
}

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
    fun submit(key: String, workMs: Long, fail: String?) {
        val boom = failureOf(fail)
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
                try {
                    gate.await(10, TimeUnit.SECONDS)
                    if (workMs > 0) Thread.sleep(workMs)
                    if (boom != null) throw boom
                    "$key#$n"
                } finally {
                    inflight.decrementAndGet()
                }
            },
            deliver = { o -> callbacks.add(describe(o)) },
        )
    }
}

/**
 * État observé de la file PARTAGÉE (`ClientQueue`) : ce que le test compare.
 *
 * Mêmes ressorts que `QueueState` : les travaux sont GATED (ils n'ont lieu
 * qu'après `sharedRelease`), donc les scénarios sont déterministes — on
 * empile les soumissions, on libère, on observe. Un chevauchement — s'il y en
 * avait un — serait TOUJOURS vu (`maxConcurrent`).
 */
private class SharedState {
    val workCalls = AtomicInteger()
    val inflight = AtomicInteger()
    val maxConcurrent = AtomicInteger()
    val executed = CopyOnWriteArrayList<String>()
    val callbacks = CopyOnWriteArrayList<String>()
    val gate = CountDownLatch(1)

    /** Un travail « lecture client » : compte, bloque sur le verrou, dure. */
    fun body(key: String, workMs: Long, boom: Throwable? = null): String {
        val now = inflight.incrementAndGet()
        maxConcurrent.accumulateAndGet(now) { a, b -> maxOf(a, b) }
        workCalls.incrementAndGet()
        executed.add(key)
        try {
            gate.await(10, TimeUnit.SECONDS)
            if (workMs > 0) Thread.sleep(workMs)
            if (boom != null) throw boom
            return key
        } finally {
            inflight.decrementAndGet()
        }
    }

    /**
     * Le MÊME travail, mais d'un AUTRE type : le cast interne de
     * `ClientQueue` jette alors (collision de clés).
     */
    fun bodyInt(key: String, workMs: Long): Int {
        body(key, workMs)
        return 1
    }
}

private class Driver {
    private var nextId = 1
    private val queues = mutableMapOf<Int, QueueState>()

    /** La file PARTAGÉE (`ClientQueue`) : un seul état, observé par le test. */
    private var shared = SharedState()
    private var nextAwaitId = 1
    private val awaitResults = ConcurrentHashMap<Int, String>()

    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        "queueNew" -> {
            val qid = nextId++
            queues[qid] = QueueState()
            ok("qid" to JVal.Num(qid.toDouble()))
        }
        "queueSubmit" -> {
            val state = state(op)
            val key = op.str("key") ?: throw IllegalArgumentException("pilote: key absent")
            state.submit(key, (op.num("workMs") ?: 0.0).toLong(), op.str("fail"))
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
        // --- File PARTAGÉE (`ClientQueue`) : l'interface ET le job de fond ---

        "sharedNew" -> {
            shared = SharedState()
            ok("ok" to JVal.Bool(true))
        }
        "sharedSubmit" -> {
            val key = op.str("key") ?: throw IllegalArgumentException("pilote: key absent")
            val workMs = (op.num("workMs") ?: 0.0).toLong()
            val boom = failureOf(op.str("fail"))
            val s = shared
            if (op.str("type") == "int") {
                // Un AUTRE type sous la MÊME clé : la file dédoublonne, donc le
                // cast interne jette (collision de clés).
                ClientQueue.submit(
                    key,
                    work = { s.bodyInt(key, workMs) },
                    deliver = { o -> s.callbacks.add(describe(o)) },
                )
            } else {
                ClientQueue.submit(
                    key,
                    work = { s.body(key, workMs, boom) },
                    deliver = { o -> s.callbacks.add(describe(o)) },
                )
            }
            // Le travail a DÉMARRÉ (et il attend le verrou) : le test peut
            // empiler la lecture suivante sans course.
            val deadline = System.currentTimeMillis() + 5000
            while (s.workCalls.get() == 0 && System.currentTimeMillis() < deadline) Thread.sleep(5)
            ok("ok" to JVal.Bool(true))
        }
        "sharedAwait" -> {
            val key = op.str("key") ?: throw IllegalArgumentException("pilote: key absent")
            val workMs = (op.num("workMs") ?: 0.0).toLong()
            val boom = failureOf(op.str("fail"))
            val timeoutMs = (op.num("timeoutMs") ?: 5000.0).toLong()
            val id = nextAwaitId++
            val s = shared
            // L'attente BLOQUE : elle part dans un fil à part, sinon le
            // pilote ne pourrait plus libérer le verrou de la file.
            val t = Thread {
                val outcome = ClientQueue.submitAndAwait(key, timeoutMs) { s.body(key, workMs, boom) }
                awaitResults[id] = outcome?.let { describe(it) } ?: TIMEOUT
            }
            t.isDaemon = true
            t.start()
            ok("id" to JVal.Num(id.toDouble()))
        }
        "sharedAwaitResult" -> {
            val id = (op.num("id") ?: 0.0).toInt()
            val timeout = (op.num("timeoutMs") ?: 5000.0).toLong()
            val deadline = System.currentTimeMillis() + timeout
            while (!awaitResults.containsKey(id) && System.currentTimeMillis() < deadline) Thread.sleep(5)
            val value = awaitResults[id]
            if (value == null) {
                ok("timedOut" to JVal.Bool(true))
            } else {
                ok("timedOut" to JVal.Bool(value == TIMEOUT), "value" to JVal.Str(value))
            }
        }
        "sharedRelease" -> {
            shared.gate.countDown()
            ok("released" to JVal.Bool(true))
        }
        "sharedWait" -> {
            val want = (op.num("callbacks") ?: 0.0).toInt()
            val timeout = (op.num("timeoutMs") ?: 5000.0).toLong()
            val deadline = System.currentTimeMillis() + timeout
            while (shared.callbacks.size < want && System.currentTimeMillis() < deadline) Thread.sleep(5)
            ok(
                "served" to JVal.Num(shared.callbacks.size.toDouble()),
                "timedOut" to JVal.Bool(shared.callbacks.size < want),
            )
        }
        "sharedStats" -> {
            val s = shared
            ok(
                "workCalls" to JVal.Num(s.workCalls.get().toDouble()),
                "maxConcurrent" to JVal.Num(s.maxConcurrent.get().toDouble()),
                "inflight" to JVal.Num(s.inflight.get().toDouble()),
                "executed" to JVal.Arr(s.executed.map { JVal.Str(it) }),
                "callbacks" to JVal.Arr(s.callbacks.map { JVal.Str(it) }),
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
