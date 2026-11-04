// AppIdentityMain.kt — pilote JSON de l'empreinte SHA-256 d'un certificat.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/android-app-identity.test.ts`
// (jamais Gradle, jamais l'APK).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne.
package fr.veryslopnynotes.appidentity

import fr.veryslopnynotes.app.certificateSha256
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun hexBytes(hex: String): ByteArray {
    require(hex.length % 2 == 0) { "pilote: hexadécimal de longueur impaire" }
    return ByteArray(hex.length / 2) { index ->
        hex.substring(index * 2, index * 2 + 2).toInt(16).toByte()
    }
}

private fun run(op: JVal.Obj): JVal = when (op.str("op")) {
    "fingerprint" -> {
        val der = hexBytes(op.str("derHex") ?: "")
        JVal.Obj(linkedMapOf("fingerprint" to JVal.Str(certificateSha256(der))))
    }
    else -> throw IllegalArgumentException("pilote: opération inconnue : ${op.str("op")}")
}

fun main() {
    val stdin = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    val stdout = PrintStream(System.out, true, StandardCharsets.UTF_8.name())
    val stderr = PrintStream(System.err, true, StandardCharsets.UTF_8.name())
    while (true) {
        val line = stdin.readLine() ?: break
        if (line.isBlank()) continue
        try {
            stdout.println(Json.stringify(run(Json.parse(line) as JVal.Obj)))
        } catch (e: Exception) {
            stderr.println("port: ${e.javaClass.simpleName}: ${e.message}")
            stdout.println(
                Json.stringify(
                    JVal.Obj(
                        linkedMapOf(
                            "error" to JVal.Str(e.javaClass.simpleName),
                            "message" to JVal.Str(e.message ?: "inconnu"),
                        ),
                    ),
                ),
            )
        }
    }
}
