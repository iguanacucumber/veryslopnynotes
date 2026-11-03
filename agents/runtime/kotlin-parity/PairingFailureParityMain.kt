// PairingFailureParityMain.kt — pilote JSON de la cause TYPÉE d'un échec
//
// OUTIL DE TEST uniquement : compilé par la parité (jamais Gradle, jamais l'APK).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.pairingfailure

import fr.veryslopnynotes.data.pairingFailureCause
import fr.veryslopnynotes.pronote.ExpiredObject
import fr.veryslopnynotes.pronote.IpSuspendedError
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import fr.veryslopnynotes.pronote.MFAError
import fr.veryslopnynotes.pronote.PronoteAPIError
import fr.veryslopnynotes.pronote.QRCodeDecryptError
import fr.veryslopnynotes.pronote.RateLimitedError
import fr.veryslopnynotes.pronote.UnexpectedPageError
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Int? = (fields[key] as? JVal.Num)?.value?.toInt()

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun exceptionOf(op: JVal.Obj): Throwable {
    val message = op.str("message") ?: "échec"
    return when (val kind = op.str("kind")) {
        "io" -> IOException(message)
        "rate" -> RateLimitedError()
        "qr" -> QRCodeDecryptError(message)
        "mfa" -> MFAError(message)
        "ip" -> IpSuspendedError(message)
        "unexpected" -> UnexpectedPageError(message)
        "expired" -> ExpiredObject(message)
        "pronote" -> PronoteAPIError(message, op.num("code"), httpStatus = op.num("status"))
        "other" -> IllegalStateException(message)
        else -> throw IllegalArgumentException("pilote: cause inconnue : $kind")
    }
}

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        "cause" -> JVal.Obj(
            linkedMapOf("cause" to JVal.Str(pairingFailureCause(exceptionOf(op)).code)),
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
