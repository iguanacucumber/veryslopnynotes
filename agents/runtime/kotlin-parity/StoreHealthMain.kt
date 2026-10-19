// StoreHealthMain.kt — pilote JSON de l'état du stockage chiffré (#401).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-store-health.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile la VRAIE source de
// production `fr.veryslopnynotes.data.StoreHealth` (logique pure : aucun
// import Android) et la pilote ici.
//
// CE QUE ÇA PROUVE. L'appel au Keystore a besoin du SDK : il reste dans le
// `catch` des stores (`SessionStores.newStore` / `LlmKeys.newStore`). Ce que
// le port exécute, c'est la DÉCISION et l'ÉTAT qu'elle produit :
//   - le Keystore répond  -> AVAILABLE (rien à signaler) ;
//   - le Keystore échoue  -> UNAVAILABLE : un état EXPLICITE, plus un silence.
// Un source guard (côté TS) vérifie que les deux `catch` appellent bien
// `SecureStorage.markUnavailable()` : sans lui, la décision pure serait
// orpheline et l'échec resterait muet.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout (comme les autres pilotes de `agents/runtime/kotlin-parity/`). Les
// erreurs du PILOTE (op inconnue, champ absent) sont préfixées `pilote: ` et
// refusées par le test.
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
