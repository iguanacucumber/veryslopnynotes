// LlmTransportParityMain.kt — pilote JSON des règles PURES du transport LLM.
//
// OUTIL DE TEST uniquement (jamais compilé par Gradle, jamais dans l'APK) :
// `tests/unit/android-llm-client.test.ts` compile la VRAIE source de production
// `android/data/.../LlmTransport.kt` et la pilote ici, sans réseau : la borne
// de lecture et le classement d'une panne sont donc prouvés sur du code
// exécuté, pas sur un miroir TS.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne.
//   - {"op":"read","bytes":600000,"max":524288}
//       → {"ok":false,"error":"ResponseTooLargeException","max":524288,"pulled":…}
//   - {"op":"fault","error":"call_timeout"} → {"fault":"TIMEOUT","message":"…"}
//   - {"op":"tooLargeMessage","max":524288} → {"message":"…"}
//   - {"op":"constants"} → {"maxResponseBytes":524288,"maxRetryBodyBytes":262144}
//   - {"op":"completion","choices":1,"finish":"stop","content":"…"}
//       → {"ok":true,"text":"…"} ou {"ok":false,"fault":"EMPTY","message":"…"}
//   - {"op":"completionMessages"} → les messages de refus (bornés, français)
//   - {"op":"retry","bytes":2700000,"consumed":false} → {"allowed":false,"max":…}
package fr.veryslopnynotes.llmtransport

import fr.veryslopnynotes.data.LlmCompletion
import fr.veryslopnynotes.data.LlmCompletionFault
import fr.veryslopnynotes.data.MAX_RESPONSE_BYTES
import fr.veryslopnynotes.data.MAX_RETRY_BODY_BYTES
import fr.veryslopnynotes.data.ResponseTooLargeException
import fr.veryslopnynotes.data.classifyTransportError
import fr.veryslopnynotes.data.readBounded
import fr.veryslopnynotes.data.readCompletion
import fr.veryslopnynotes.data.responseTooLargeMessage
import fr.veryslopnynotes.data.retryAllowed
import fr.veryslopnynotes.data.transportFaultMessage
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStream
import java.io.InputStreamReader
import java.io.InterruptedIOException
import java.io.PrintStream
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import javax.net.ssl.SSLHandshakeException

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value
private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value
private fun JVal.Obj.requireStr(key: String): String =
    str(key) ?: throw IllegalArgumentException("pilote: $key absent")

private fun ok(vararg pairs: Pair<String, JVal>): String = Json.stringify(JVal.Obj(linkedMapOf(*pairs)))
private fun ko(vararg pairs: Pair<String, JVal>): String =
    ok("ok" to JVal.Bool(false), *pairs)

/** Flux synthétique qui COMPTE les octets réellement tirés par le lecteur. */
private class CountingStream(private val total: Int) : InputStream() {
    var pulled = 0
        private set
    private var pos = 0

    override fun read(): Int {
        if (pos >= total) return -1
        pos++
        pulled++
        return 'a'.code
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
        if (pos >= total) return -1
        val n = minOf(len, total - pos)
        for (i in 0 until n) b[off + i] = 'a'.code.toByte()
        pos += n
        pulled += n
        return n
    }
}

private fun faultOf(kind: String): Throwable = when (kind) {
    "socket_timeout" -> SocketTimeoutException("timeout")
    "read_timeout" -> SocketTimeoutException("Read timed out")
    "call_timeout" -> InterruptedIOException("timeout")
    "wrapped_timeout" -> IOException("connexion", SocketTimeoutException("connect timed out"))
    "ssl" -> SSLHandshakeException("certificate verify failed")
    "io" -> IOException("broken pipe")
    else -> RuntimeException("boom")
}

private fun handle(op: JVal.Obj): String = when (val name = op.requireStr("op")) {
    "constants" -> ok(
        "maxResponseBytes" to JVal.Num(MAX_RESPONSE_BYTES.toDouble()),
        "maxRetryBodyBytes" to JVal.Num(MAX_RETRY_BODY_BYTES.toDouble()),
    )

    "completion" -> {
        val choices = op.num("choices")?.toInt() ?: 0
        val finish = op.str("finish")
        val content = op.str("content")
        when (val verdict = readCompletion(choices, finish, content)) {
            is LlmCompletion.Text -> ok(
                "ok" to JVal.Bool(true),
                "text" to JVal.Str(verdict.value),
            )
            is LlmCompletion.Refused -> ko(
                "fault" to JVal.Str(verdict.fault.name),
                "message" to JVal.Str(verdict.fault.message),
            )
        }
    }

    "completionMessages" -> ok(
        "messages" to JVal.Arr(LlmCompletionFault.values().map { JVal.Str(it.message) }),
    )

    "retry" -> {
        val bytes = op.num("bytes")?.toInt() ?: throw IllegalArgumentException("pilote: bytes absent")
        val consumed = (op.fields["consumed"] as? JVal.Bool)?.value ?: false
        ok(
            "allowed" to JVal.Bool(retryAllowed(bytes, consumed)),
            "max" to JVal.Num(MAX_RETRY_BODY_BYTES.toDouble()),
        )
    }

    "read" -> {
        val bytes = op.num("bytes")?.toInt() ?: throw IllegalArgumentException("pilote: bytes absent")
        val max = op.num("max")?.toInt() ?: MAX_RESPONSE_BYTES
        val stream = CountingStream(bytes)
        try {
            val text = readBounded(stream, max)
            ok(
                "ok" to JVal.Bool(true),
                "length" to JVal.Num(text.length.toDouble()),
                "pulled" to JVal.Num(stream.pulled.toDouble()),
            )
        } catch (e: ResponseTooLargeException) {
            ko(
                "error" to JVal.Str("ResponseTooLargeException"),
                "max" to JVal.Num(e.maxBytes.toDouble()),
                "pulled" to JVal.Num(stream.pulled.toDouble()),
            )
        }
    }

    "fault" -> {
        val error = faultOf(op.requireStr("error"))
        val fault = classifyTransportError(error)
        ok(
            "fault" to JVal.Str(fault.name),
            "message" to JVal.Str(transportFaultMessage(fault)),
        )
    }

    "tooLargeMessage" -> {
        val max = op.num("max")?.toInt() ?: MAX_RESPONSE_BYTES
        ok("message" to JVal.Str(responseTooLargeMessage(max)))
    }

    else -> throw IllegalArgumentException("pilote: op inconnue « $name »")
}

fun main() {
    val stdin = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    val stdout = PrintStream(System.out, true, StandardCharsets.UTF_8.name())
    val stderr = PrintStream(System.err, true, StandardCharsets.UTF_8.name())
    while (true) {
        val line = stdin.readLine() ?: break
        if (line.isBlank()) continue
        try {
            stdout.println(handle(Json.parse(line) as JVal.Obj))
        } catch (e: Exception) {
            stderr.println("port: ${e.javaClass.simpleName}: ${e.message}")
            stdout.println(
                ko(
                    "error" to JVal.Str(e.javaClass.simpleName),
                    "message" to JVal.Str(e.message ?: "inconnu"),
                ),
            )
        }
    }
}
