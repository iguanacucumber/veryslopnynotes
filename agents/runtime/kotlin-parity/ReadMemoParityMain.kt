// ReadMemoParityMain.kt — pilote JSON de la mémo des lectures identiques (#473).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-read-memo.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile le VRAI client de
// production (`fr.veryslopnynotes.pronote.ClientBase`) et le pilote ici.
//
// Le pilote provides un client dont l'ENVOI est un STUB qui compte les
// requêtes : le vrai `post` (enveloppe, mémo, rejeu après `refresh`) est
// rejoué, sans réseau et sans établissement.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout (comme les autres pilotes de `agents/runtime/kotlin-parity/`).
package fr.veryslopnynotes.readmemo

import fr.veryslopnynotes.pronote.ClientBase
import fr.veryslopnynotes.pronote.ClientOptions
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import fr.veryslopnynotes.pronote.ReadMemo
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun JVal.Obj.bool(key: String): Boolean? = (fields[key] as? JVal.Bool)?.value

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

/**
 * Client de test : l'envoi est un STUB qui compte les requêtes.
 *
 * Le `post` de PRODUCTION est rejoué tel quel (enveloppe `{Signature, data}`,
 * mémo des lectures, rejeu après `refresh`) — seul le transport est remplacé.
 */
private class CountingClient(memoize: Boolean) : ClientBase(
    "https://etablissement.example/pronote/eleve.html",
    "eleve",
    "secret",
    ClientOptions(memoizeReads = memoize),
) {
    var sends: Int = 0
    val functions: MutableList<String> = mutableListOf()

    /** Le prochain envoi échoue (le test « une erreur n'est jamais mémoïsée »). */
    var failNext: Boolean = false

    override fun send(functionName: String, postData: Map<String, JVal>): JVal {
        sends++
        functions.add(functionName)
        if (failNext) {
            failNext = false
            throw IllegalStateException("reseau parti")
        }
        return JVal.Obj(
            linkedMapOf(
                "dataSec" to JVal.Obj(
                    linkedMapOf("data" to JVal.Obj(linkedMapOf("N" to JVal.Str(functionName)))),
                ),
            ),
        )
    }
}

private class Driver {
    /** Horloge de la mémo (injectée : le TTL se rejoue sans attendre 60 s). */
    private var now: Long = 0L

    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        // La mémo est-elle activée par DÉFAUT ? Non : le harnais de parité
        // compare le fil de la référence TS, il doit rester inchangé.
        "default" -> {
            val client = CountingClient(false)
            ok("memoEnabled" to JVal.Bool(client.readMemo != null))
        }
        "run" -> {
            val memoize = op.bool("memoize") ?: false
            val client = CountingClient(memoize)
            if (memoize) {
                // Mémo de test : horloge injectée, sinon le TTL exigerait
                // d'attendre une vraie minute.
                client.readMemo = ReadMemo(clock = { now })
            }
            val requests = (op.fields["requests"] as? JVal.Arr)?.items ?: emptyList()
            for (raw in requests) {
                val req = raw as? JVal.Obj ?: continue
                req.num("now")?.let { now = it.toLong() }
                if (req.bool("fail") == true) client.failNext = true
                val function = req.str("function") ?: throw IllegalArgumentException("pilote: function absent")
                val onglet = req.num("onglet")
                val payload = (req.fields["payload"] as? JVal.Obj)?.fields
                try {
                    client.post(function, onglet, payload)
                } catch (_: Exception) {
                    // L'échec est le résultat attendu du test : on continue.
                }
            }
            ok(
                "sends" to JVal.Num(client.sends.toDouble()),
                "functions" to JVal.Arr(client.functions.map { JVal.Str(it) }),
                "memoSize" to JVal.Num((client.readMemo?.size ?: 0).toDouble()),
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
