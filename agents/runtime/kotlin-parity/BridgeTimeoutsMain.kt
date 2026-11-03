// BridgeTimeoutsMain.kt — pilote JSON des budgets du pont.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-bridge-timeouts.test.ts`
// (jamais Gradle, jamais l'APK).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.bridgetimeouts

import fr.veryslopnynotes.app.AwaitOutcome
import fr.veryslopnynotes.app.BridgeTimeouts
import fr.veryslopnynotes.app.BridgeWait
import fr.veryslopnynotes.data.RequestCancellation
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets
import java.util.concurrent.CountDownLatch

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        "timeouts" -> ok(
            "REQUEST_DEADLINE_MS" to JVal.Num(BridgeTimeouts.REQUEST_DEADLINE_MS.toDouble()),
            "AWAIT_DEFAULT_MS" to JVal.Num(BridgeTimeouts.AWAIT_DEFAULT_MS.toDouble()),
            "AWAIT_MANUAL_MS" to JVal.Num(BridgeTimeouts.AWAIT_MANUAL_MS.toDouble()),
            "ATTACHMENT_BUDGET_MS" to JVal.Num(BridgeTimeouts.ATTACHMENT_BUDGET_MS.toDouble()),
            "AWAIT_LLM_MS" to JVal.Num(BridgeTimeouts.AWAIT_LLM_MS.toDouble()),
            "HOMEWORK_LLM_TIMEOUT_MS" to JVal.Num(BridgeTimeouts.HOMEWORK_LLM_TIMEOUT_MS.toDouble()),
            "AWAIT_PHOTO_MS" to JVal.Num(BridgeTimeouts.AWAIT_PHOTO_MS.toDouble()),
            "MAX_NATIVE_WAIT_MS" to JVal.Num(BridgeTimeouts.MAX_NATIVE_WAIT_MS.toDouble()),
            "MAX_RESOURCE_REQUESTS" to JVal.Num(BridgeTimeouts.MAX_RESOURCE_REQUESTS.toDouble()),
            "MAX_RESOURCE_DEADLINE_MS" to JVal.Num(BridgeTimeouts.MAX_RESOURCE_DEADLINE_MS.toDouble()),
            "resources" to JVal.Obj(
                linkedMapOf(
                    *BridgeTimeouts.RESOURCE_KEYS.map { key ->
                        key to JVal.Num(BridgeTimeouts.resourceDeadlineMs(key).toDouble())
                    }.toTypedArray(),
                ),
            ),
        )
        "wait" -> {
            val latch = CountDownLatch(1)
            val cancellation = RequestCancellation()
            val cancelAfterMs = (op.num("cancelAfterMs") ?: -1.0).toLong()
            val countDownAfterMs = (op.num("countDownAfterMs") ?: -1.0).toLong()
            if (cancelAfterMs >= 0) {
                Thread {
                    Thread.sleep(cancelAfterMs)
                    cancellation.cancel()
                }.start()
            }
            if (countDownAfterMs >= 0) {
                Thread {
                    Thread.sleep(countDownAfterMs)
                    latch.countDown()
                }.start()
            }
            val started = System.nanoTime()
            val outcome = BridgeWait.await(latch, (op.num("timeoutMs") ?: 5000.0).toLong(), cancellation)
            val elapsed = (System.nanoTime() - started) / 1_000_000L
            ok(
                "outcome" to JVal.Str(outcome.name.lowercase()),
                "elapsedMs" to JVal.Num(elapsed.toDouble()),
                "done" to JVal.Bool(outcome == AwaitOutcome.DONE),
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
