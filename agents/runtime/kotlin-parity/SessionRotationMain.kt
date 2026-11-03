// SessionRotationMain.kt — pilote JSON du jeton tourné (#867).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-session-rotation.test.ts`
// (jamais Gradle, jamais l'APK). Le store est un faux `KeyValueStore` : le test
// écrit une session avec l'ANCIEN jeton, applique la rotation, puis REDIT le
// contenu dans un store neuf — le démarrage à froid lit ce que le disque a.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.sessionrotation

import fr.veryslopnynotes.data.AccountIdentity
import fr.veryslopnynotes.data.KeyValueStore
import fr.veryslopnynotes.data.RotatedTokenWrite
import fr.veryslopnynotes.data.SessionMode
import fr.veryslopnynotes.data.SessionRecordStore
import fr.veryslopnynotes.data.StoredSession
import fr.veryslopnynotes.data.WriteResult
import fr.veryslopnynotes.data.saveRotatedToken
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String = (fields[key] as? JVal.Str)?.value ?: ""

private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun JVal.Obj.bool(key: String): Boolean = (fields[key] as? JVal.Bool)?.value ?: false

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

/** Faux stockage : la panne se commande, le contenu reste observable. */
private class BenchStore : KeyValueStore {
    val values = LinkedHashMap<String, String>()
    var failCommit = false

    override fun getString(key: String): String? = values[key]

    override fun commit(values: Map<String, String>): Boolean {
        if (failCommit) return false
        this.values.putAll(values)
        return true
    }

    override fun clear(): Boolean {
        values.clear()
        return true
    }
}

private class Slot(seed: Map<String, String> = emptyMap()) {
    val backing = BenchStore().also { it.values.putAll(seed) }
    val sessions = SessionRecordStore(backing)
}

private fun JVal.Obj.session(): StoredSession = StoredSession(
    endpointUrl = str("endpointUrl").ifEmpty { "https://etab.exemple/eleve" },
    username = str("username").ifEmpty { "eleve.a" },
    password = str("password").ifEmpty { "jeton-ancien" },
    uuid = str("uuid").ifEmpty { "uuid-factice" },
    clientIdentifier = str("clientIdentifier").takeIf { it.isNotEmpty() },
    schoolUrl = str("schoolUrl").ifEmpty { "https://etab.exemple" },
    mode = str("mode").ifEmpty { SessionMode.JETON },
)

private fun result(value: WriteResult, vararg extra: Pair<String, JVal>): JVal.Obj = when (value) {
    is WriteResult.Written -> ok("result" to JVal.Str("written"), *extra)
    is WriteResult.Failed -> ok("result" to JVal.Str("failed"), "reason" to JVal.Str(value.reason), *extra)
    is WriteResult.Refused -> ok("result" to JVal.Str("refused"), "reason" to JVal.Str(value.reason), *extra)
    is WriteResult.EpochRefused -> ok("result" to JVal.Str("epoch_refused"), *extra)
}

private class Driver {
    private val slots = LinkedHashMap<Int, Slot>()
    private var nextId = 1

    private fun slot(op: JVal.Obj): Slot {
        val id = (op.num("sid") ?: 0.0).toInt()
        return slots[id] ?: throw IllegalArgumentException("pilote: sid inconnu ($id)")
    }

    private fun newSlot(seed: Map<String, String> = emptyMap()): Int {
        val id = nextId++
        slots[id] = Slot(seed)
        return id
    }

    fun run(op: JVal.Obj): JVal.Obj = when (op.str("op")) {
        "newStore" -> ok("sid" to JVal.Num(newSlot().toDouble()))
        "seed" -> result(slot(op).sessions.save(op.session()))
        // Redémarrage : un store NEUF ne reçoit que les octets persistés.
        "coldStart" -> ok("sid" to JVal.Num(newSlot(slot(op).backing.values.toMap()).toDouble()))
        "rotate" -> {
            val expected = AccountIdentity.of(op.str("endpointUrl"), op.str("username"))
                ?: throw IllegalArgumentException("pilote: identité attendue incomplète")
            result(saveRotatedToken(slot(op).sessions, expected, op.str("token")))
        }
        "load" -> {
            val found = slot(op).sessions.load()
            if (found == null) {
                ok("found" to JVal.Bool(false))
            } else {
                ok(
                    "found" to JVal.Bool(true),
                    "username" to JVal.Str(found.username),
                    "token" to JVal.Str(found.password),
                )
            }
        }
        "setFail" -> {
            slot(op).backing.failCommit = op.bool("commit")
            ok("ok" to JVal.Bool(true))
        }
        "report" -> {
            RotatedTokenWrite.report(
                if (op.str("result") == "written") WriteResult.Written else WriteResult.Failed("test"),
            )
            ok("failed" to JVal.Bool(RotatedTokenWrite.failed()))
        }
        "reset" -> {
            RotatedTokenWrite.reset()
            ok("failed" to JVal.Bool(RotatedTokenWrite.failed()))
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
