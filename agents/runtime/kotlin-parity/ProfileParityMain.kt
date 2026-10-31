// ProfileParityMain.kt — pilote JSON du validateur de profil.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-profile-parity.test.ts` (jamais Gradle, jamais l'APK).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.core

import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private fun err(name: String, message: String?): JVal.Obj =
    JVal.Obj(linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")))

/** Opérations : borne et verdict du validateur de profil, tels que l'app les applique. */
private fun driver(op: JVal.Obj): JVal = when (op.str("op")) {
    // La borne du libellé de période (constante du noyau).
    "periodNameMax" -> ok("max" to JVal.Num(UserProfileRules.MAX_PERIOD_NAME.toDouble()))
    // Verdict « profil accepté » pour un libellé de période donné.
    "profileValid" -> {
        val profile = UserProfile(
            accountId = op.str("accountId") ?: "acc-fake-1",
            displayName = op.str("displayName") ?: "Nom Exemple",
            periodName = op.str("periodName") ?: "",
        )
        ok("ok" to JVal.Bool(UserProfileRules.isValid(profile)))
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
            stdout.println(Json.stringify(driver(Json.parse(line) as JVal.Obj)))
        } catch (e: Exception) {
            val name = e.javaClass.simpleName
            stderr.println("port: $name: ${e.message}")
            stdout.println(Json.stringify(err(name, e.message)))
        }
    }
}
