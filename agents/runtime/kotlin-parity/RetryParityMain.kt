// RetryParityMain.kt — pilote JSON du réessai BORNÉ des lectures idempotentes.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
// Le VRAI `ClientBase.post` est rejoué ; seul `send` est scripté. Le temps
// (attente, horloge) est factice : comptes et échéance sont déterministes.
package fr.veryslopnynotes.retry

import fr.veryslopnynotes.pronote.ClientBase
import fr.veryslopnynotes.pronote.ClientOptions
import fr.veryslopnynotes.pronote.ExpiredObject
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import fr.veryslopnynotes.pronote.PronoteAPIError
import fr.veryslopnynotes.pronote.RateLimitedError
import fr.veryslopnynotes.pronote.RequestCancelled
import fr.veryslopnynotes.pronote.RetryPolicy
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import java.security.cert.CertificateException
import javax.net.ssl.SSLHandshakeException

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun JVal.Obj.arr(key: String): List<JVal> = (fields[key] as? JVal.Arr)?.items ?: emptyList()

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

/** Un pas du scénario : `ok`, ou une erreur d'établissement/reseau. */
private data class Step(val kind: String, val retryAfterMs: Long?)

private fun stepOf(v: JVal): Step {
    val o = v as? JVal.Obj ?: return Step("ok", null)
    val after = (o.fields["retryAfterMs"] as? JVal.Num)?.value?.toLong()
    return Step(o.str("kind") ?: "ok", after)
}

private fun errorFor(step: Step): Exception = when (step.kind) {
    "http401" -> PronoteAPIError("Bad request (http status: 401)", httpStatus = 401)
    "http403" -> PronoteAPIError("Bad request (http status: 403)", httpStatus = 403)
    "http404" -> PronoteAPIError("Bad request (http status: 404)", httpStatus = 404)
    "http500" -> PronoteAPIError("Bad request (http status: 500)", httpStatus = 500, retryAfterMs = step.retryAfterMs)
    "http502" -> PronoteAPIError("Bad request (http status: 502)", httpStatus = 502, retryAfterMs = step.retryAfterMs)
    "http503" -> PronoteAPIError("Bad request (http status: 503)", httpStatus = 503, retryAfterMs = step.retryAfterMs)
    "http504" -> PronoteAPIError("Bad request (http status: 504)", httpStatus = 504, retryAfterMs = step.retryAfterMs)
    "http429" -> RateLimitedError(httpStatus = 429)
    "g10" -> PronoteAPIError("Session expirée", 10, "session expirée")
    "g22" -> ExpiredObject("objet d'une session précédente")
    "g25" -> RateLimitedError()
    "g99" -> PronoteAPIError("Bizarre", 99, "Bizarre")
    "tls" -> SSLHandshakeException("handshake refusé")
    "cert" -> CertificateException("certificat refusé")
    "io" -> java.io.IOException("réseau")
    "timeout" -> SocketTimeoutException("délai dépassé")
    "cancelled" -> RequestCancelled()
    else -> throw IllegalArgumentException("pilote: pas inconnu : ${step.kind}")
}

/**
 * Le TRANSPORT est remplacé : le vrai `post`/`sendWithRetry`/`sendWithRefresh`
 * de production décide des tentatives.
 */
private class ScriptedClient(
    retryPolicy: RetryPolicy,
    private val script: List<Step>,
) : ClientBase(
    "https://etablissement.example/pronote/eleve.html",
    "eleve",
    "secret",
    ClientOptions(retryPolicy = retryPolicy),
) {
    var sends: Int = 0
    var refreshes: Int = 0

    override fun send(functionName: String, postData: Map<String, JVal>): JVal {
        sends += 1
        val step = script.getOrNull(sends - 1) ?: Step("ok", null)
        if (step.kind != "ok") throw errorFor(step)
        return JVal.Obj(linkedMapOf())
    }

    override fun refresh() {
        refreshes += 1
    }
}

private fun catchName(block: () -> Unit): String? = try {
    block()
    null
} catch (e: Exception) {
    e.javaClass.simpleName
}

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        "run" -> {
            val function = op.str("function") ?: "DernieresNotes"
            val script = op.arr("outcomes").map { stepOf(it) }
            var clock = 0L
            val delays = mutableListOf<Long>()
            val policy = RetryPolicy(
                maxAttempts = (op.num("maxAttempts") ?: 3.0).toInt(),
                baseDelayMs = (op.num("baseDelayMs") ?: 250.0).toLong(),
                maxDelayMs = (op.num("maxDelayMs") ?: 2_000.0).toLong(),
                budgetMs = (op.num("budgetMs") ?: 20_000.0).toLong(),
                random = { op.num("random") ?: 1.0 },
                sleep = { ms -> delays.add(ms); clock += ms },
                nowMs = { clock },
            )
            val client = ScriptedClient(policy, script)
            val outcome = catchName { client.post(function, 198.0, null) }
            ok(
                "sends" to JVal.Num(client.sends.toDouble()),
                "refreshes" to JVal.Num(client.refreshes.toDouble()),
                "delays" to JVal.Arr(delays.map { JVal.Num(it.toDouble()) }),
                "error" to (outcome?.let { JVal.Str(it) } ?: JVal.Null),
            )
        }

        // Classification PURE : ce qui mérite un réessai.
        "classify" -> {
            val step = stepOf(op.fields["step"] ?: JVal.Obj(linkedMapOf()))
            ok("transient" to JVal.Bool(RetryPolicy.isTransient(errorFor(step))))
        }

        "delay" -> {
            val policy = RetryPolicy(
                baseDelayMs = (op.num("baseDelayMs") ?: 400.0).toLong(),
                maxDelayMs = (op.num("maxDelayMs") ?: 2_000.0).toLong(),
                random = { op.num("random") ?: 0.0 },
                sleep = {},
                nowMs = { 0L },
            )
            val delay = policy.retryDelayMs(
                (op.num("retryIndex") ?: 1.0).toInt(),
                (op.num("retryAfterMs"))?.toLong(),
                (op.num("remainingMs") ?: 20_000.0).toLong(),
            )
            ok("delay" to (delay?.let { JVal.Num(it.toDouble()) } ?: JVal.Null))
        }

        "parseAfter" -> {
            val parsed = RetryPolicy.parseRetryAfterMs(
                op.str("value") ?: "",
                (op.num("nowMs") ?: 0.0).toLong(),
            )
            ok("ms" to (parsed?.let { JVal.Num(it.toDouble()) } ?: JVal.Null))
        }

        "constants" -> ok(
            "maxAttempts" to JVal.Num(RetryPolicy.DEFAULT_MAX_ATTEMPTS.toDouble()),
            "baseDelayMs" to JVal.Num(RetryPolicy.DEFAULT_BASE_DELAY_MS.toDouble()),
            "maxDelayMs" to JVal.Num(RetryPolicy.DEFAULT_MAX_DELAY_MS.toDouble()),
            "budgetMs" to JVal.Num(RetryPolicy.DEFAULT_BUDGET_MS.toDouble()),
        )

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
