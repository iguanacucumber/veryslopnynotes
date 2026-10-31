// StoreHealthMain.kt — pilote JSON de l'état du stockage chiffré.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-store-health.test.ts` (jamais Gradle, jamais l'APK).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.storehealth

import fr.veryslopnynotes.data.SecureStorage
import fr.veryslopnynotes.data.storeHealth
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.bool(key: String): Boolean? = (fields[key] as? JVal.Bool)?.value

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        // La décision pure : le Keystore a-t-il répondu ?
        "decision" -> {
            val available = op.bool("keystoreAvailable") ?: false
            ok("health" to JVal.Str(storeHealth(available).name))
        }
        // L'état du process, tel que le pont le publie.
        "state" -> ok("health" to JVal.Str(SecureStorage.health().name))
        // L'échec du Keystore : le `catch` des stores appelle ça. L'état
        // doit devenir EXPLICITE (et le rester).
        "fail" -> {
            SecureStorage.markUnavailable()
            ok("health" to JVal.Str(SecureStorage.health().name))
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
