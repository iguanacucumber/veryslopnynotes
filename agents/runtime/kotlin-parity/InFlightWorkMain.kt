// InFlightWorkMain.kt — pilote JSON du travail long annulable (IA/photo/profil).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-inflight-work.test.ts`.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne.
package fr.veryslopnynotes.inflight

import fr.veryslopnynotes.data.InFlight
import fr.veryslopnynotes.data.InFlightWork
import fr.veryslopnynotes.data.RequestCancellation
import fr.veryslopnynotes.data.SessionEpoch
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicInteger

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun JVal.Obj.bool(key: String): Boolean? = (fields[key] as? JVal.Bool)?.value

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

/** Un travail long et son fil différé, observés depuis le pilote. */
private class WorkState {
    val cancellation = RequestCancellation()
    val cancelActions = AtomicInteger()
    val hookActions = AtomicInteger()

    @Volatile
    var work: InFlightWork? = null

    @Volatile
    private var worker: Thread? = null

    @Volatile
    var sendAllowed = true

    @Volatile
    var deliveryAllowed = true

    @Volatile
    var delivered = false

    @Volatile
    var finished = false

    @Volatile
    var interrupted = false

    @Volatile
    var alive = false

    fun begin(requestId: String) {
        cancellation.onCancel { hookActions.incrementAndGet() }
        val current = InFlight.start(requestId, SessionEpoch.current())
        current.onCancel {
            cancelActions.incrementAndGet()
            worker?.interrupt()
        }
        current.onCancel { cancellation.cancel() }
        work = current
    }

    /** Réponse retardée : elle tente d'envoyer puis de livrer APRÈS le délai. */
    fun delayed(delayMs: Long, stubborn: Boolean) {
        val thread = Thread {
            try {
                Thread.sleep(delayMs)
            } catch (_: InterruptedException) {
                interrupted = true
                // Fil coupé : plus d'envoi ni de livraison.
                sendAllowed = false
                deliveryAllowed = false
                // `stubborn` simule un fil qui ignore l'interruption : même lui
                // ne doit pas livrer, l'époque et le travail sont annulés.
                if (!stubborn) return@Thread
            }
            val current = work ?: return@Thread
            sendAllowed = current.canSend()
            deliveryAllowed = current.canDeliver()
            if (deliveryAllowed) {
                delivered = true
                InFlight.finish(current.requestId)
            }
            finished = true
        }
        worker = thread
        thread.start()
    }

    fun await(timeoutMs: Long) {
        worker?.join(timeoutMs)
        alive = worker?.isAlive == true
    }

    fun snapshot(epoch: Long): JVal.Obj = ok(
        "epoch" to JVal.Num(epoch.toDouble()),
        "currentEpoch" to JVal.Num(SessionEpoch.current().toDouble()),
        "sendAllowed" to JVal.Bool(sendAllowed),
        "deliveryAllowed" to JVal.Bool(deliveryAllowed),
        "delivered" to JVal.Bool(delivered),
        "finished" to JVal.Bool(finished),
        "interrupted" to JVal.Bool(interrupted),
        "alive" to JVal.Bool(alive),
        "cancelActions" to JVal.Num(cancelActions.get().toDouble()),
        "hookActions" to JVal.Num(hookActions.get().toDouble()),
        "cancelled" to JVal.Bool(work?.isCancelled == true),
        "active" to JVal.Num(InFlight.active().toDouble()),
    )
}

private class Driver {
    private var nextId = 1
    private val states = mutableMapOf<Int, WorkState>()

    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        "begin" -> {
            val id = nextId++
            val state = WorkState()
            state.begin(op.str("requestId") ?: "req-$id")
            states[id] = state
            ok("id" to JVal.Num(id.toDouble()), "epoch" to JVal.Num(SessionEpoch.current().toDouble()))
        }
        "delayed" -> {
            val state = state(op)
            state.delayed(
                (op.num("delayMs") ?: 150.0).toLong().coerceAtLeast(0L),
                op.bool("stubborn") ?: false,
            )
            ok("ok" to JVal.Bool(true))
        }
        "logout" -> {
            val state = state(op)
            SessionEpoch.invalidate {}
            InFlight.cancelAll()
            ok(
                "epoch" to JVal.Num(SessionEpoch.current().toDouble()),
                "cancelled" to JVal.Num(state.cancelActions.get().toDouble()),
            )
        }
        "await" -> {
            val state = state(op)
            state.await((op.num("timeoutMs") ?: 2000.0).toLong())
            val current = state.work
            state.snapshot(current?.epoch ?: SessionEpoch.current())
        }
        "snapshot" -> {
            val state = state(op)
            state.snapshot(SessionEpoch.current())
        }
        "reset" -> {
            InFlight.cancelAll()
            SessionEpoch.invalidate {}
            ok("active" to JVal.Num(InFlight.active().toDouble()))
        }
        else -> throw IllegalArgumentException("pilote: opération inconnue : ${op.str("op")}")
    }

    private fun state(op: JVal.Obj): WorkState =
        states[(op.num("id") ?: 0.0).toInt()] ?: throw IllegalArgumentException("pilote: id inconnu")
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
