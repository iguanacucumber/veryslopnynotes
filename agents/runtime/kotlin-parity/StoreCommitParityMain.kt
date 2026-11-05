// StoreCommitParityMain.kt — pilote JSON des écritures persistées (#890).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-store-commit.test.ts`
// (jamais Gradle, jamais l'APK). Le stockage est un faux `KeyValueStore` : le
// test injecte un `commit()` en échec et vérifie que RIEN n'est enregistré en
// douce, que l'ancienne valeur survit et que la bascule est annulée.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.storecommit

import fr.veryslopnynotes.core.ServerConfig
import fr.veryslopnynotes.core.ServerUrlResult
import fr.veryslopnynotes.data.AccountRegistry
import fr.veryslopnynotes.data.AccountSessionCommit
import fr.veryslopnynotes.data.KeyValueStore
import fr.veryslopnynotes.data.ServerChoice
import fr.veryslopnynotes.data.SessionEpoch
import fr.veryslopnynotes.data.SessionAuthentication
import fr.veryslopnynotes.data.SessionLoad
import fr.veryslopnynotes.data.SessionMode
import fr.veryslopnynotes.data.SessionRecordStore
import fr.veryslopnynotes.data.StoredSession
import fr.veryslopnynotes.data.WriteResult
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
    var failClear = false
    var failCommitAfter: Int? = null
    var commitCalls = 0

    override fun getString(key: String): String? = values[key]

    override fun commit(values: Map<String, String>): Boolean {
        if (failCommit) return false
        val after = failCommitAfter
        if (after != null && commitCalls >= after) return false
        commitCalls++
        this.values.putAll(values)
        return true
    }

    override fun clear(): Boolean {
        if (failClear) return false
        values.clear()
        return true
    }
}

private class Slot {
    val sessionStore = BenchStore()
    val accountStore = BenchStore()
    val serverStore = BenchStore()
    val sessions = SessionRecordStore(sessionStore)
    val accounts = AccountRegistry(accountStore)
    val server = ServerChoice(serverStore)
    val commit = AccountSessionCommit(sessions, accounts)
}

private fun JVal.Obj.session(): StoredSession = StoredSession(
    endpointUrl = str("endpointUrl").ifEmpty { "https://etab.exemple/eleve" },
    username = str("username").ifEmpty { "eleve.a" },
    password = str("password").ifEmpty { "jeton-factice" },
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

    fun run(op: JVal.Obj): JVal.Obj = when (op.str("op")) {
        "newStore" -> {
            val id = nextId++
            slots[id] = Slot()
            ok("sid" to JVal.Num(id.toDouble()))
        }
        "setFail" -> {
            val target = slot(op)
            val store = when (op.str("target")) {
                "accounts" -> target.accountStore
                "server" -> target.serverStore
                else -> target.sessionStore
            }
            if (op.fields.containsKey("commit")) store.failCommit = op.bool("commit")
            if (op.fields.containsKey("clear")) store.failClear = op.bool("clear")
            if (op.fields.containsKey("commitAfter")) {
                // Compteur REMIS À ZÉRO : « le prochain commit réussit, celui
                // d'après échoue » décrit la panne de la restauration.
                store.failCommit = false
                store.commitCalls = 0
                store.failCommitAfter = (op.num("commitAfter") ?: 0.0).toInt()
            }
            ok("ok" to JVal.Bool(true))
        }
        "accountAdd" -> result(slot(op).accounts.add(op.str("id")))
        "accountRecord" -> result(slot(op).accounts.record(op.str("id")))
        "accountSelect" -> result(slot(op).accounts.select(op.str("id")))
        "accountClear" -> result(slot(op).accounts.clear())
        "accountCurrent" -> ok("current" to JVal.Str(slot(op).accounts.current() ?: ""))
        "accountCount" -> ok(
            "count" to JVal.Num(slot(op).accounts.count(op.bool("hasSession")).toDouble()),
        )
        "sessionSave" -> result(slot(op).sessions.save(op.session()))
        "sessionClear" -> result(slot(op).sessions.clear())
        "sessionLoad" -> {
            val found = slot(op).sessions.load()
            if (found == null) {
                ok("found" to JVal.Bool(false))
            } else {
                ok(
                    "found" to JVal.Bool(true),
                    "username" to JVal.Str(found.username),
                    "uuid" to JVal.Str(found.uuid),
                )
            }
        }
        "sessionLoadOutcome" -> when (val loaded = slot(op).sessions.loadOutcome()) {
            SessionLoad.Absent -> ok("status" to JVal.Str("absent"))
            is SessionLoad.Complete -> ok(
                "status" to JVal.Str("complete"),
                "username" to JVal.Str(loaded.session.username),
            )
            is SessionLoad.Incomplete -> ok(
                "status" to JVal.Str("incomplete"),
                "missing" to JVal.Arr(loaded.missing.map { JVal.Str(it) }),
                "cleared" to JVal.Bool(loaded.cleared),
            )
        }
        "sessionRemove" -> {
            slot(op).sessionStore.values.remove(op.str("key"))
            ok("ok" to JVal.Bool(true))
        }
        "sessionBlank" -> {
            slot(op).sessionStore.values[op.str("key")] = ""
            ok("ok" to JVal.Bool(true))
        }
        "sessionKeys" -> ok(
            "keys" to JVal.Arr(slot(op).sessionStore.values.keys.map { JVal.Str(it) }),
        )
        "authGaps" -> ok(
            "missing" to JVal.Arr(
                SessionAuthentication.missing(op.bool("loggedIn"), op.bool("infoReady"))
                    .map { JVal.Str(it) },
            ),
        )
        // Bascule d'un compte DÉJÀ appairé : la session et le compte courant
        // servent de point de comparaison après une panne injectée.
        "seed" -> {
            val target = slot(op)
            val saved = target.sessions.save(op.session())
            if (!saved.ok) return result(saved)
            val id = op.str("accountId").ifEmpty { "compte.a" }
            result(target.accounts.record(id), "current" to JVal.Str(id))
        }
        "switch" -> {
            val target = slot(op)
            val accountId = op.str("accountId").ifEmpty { "compte.b" }
            val epoch = op.num("epoch")?.toLong()
            val value = if (epoch == null) {
                target.commit.switchTo(op.session(), accountId)
            } else {
                target.commit.switchTo(op.session(), accountId, epoch)
            }
            val loaded = target.sessions.load()
            result(
                value,
                "current" to JVal.Str(target.accounts.current() ?: ""),
                "username" to JVal.Str(loaded?.username ?: ""),
            )
        }
        "invalidateEpoch" -> {
            SessionEpoch.invalidate {}
            ok("epoch" to JVal.Num(SessionEpoch.current().toDouble()))
        }
        "serverSave" -> {
            when (val validated = ServerConfig.validateBaseUrl(op.str("raw"))) {
                is ServerUrlResult.Ok -> result(
                    slot(op).server.save(validated),
                    "baseUrl" to JVal.Str(validated.baseUrl),
                )
                is ServerUrlResult.Rejected ->
                    ok("result" to JVal.Str("refused"), "message" to JVal.Str(validated.message))
            }
        }
        "serverBase" -> ok("baseUrl" to JVal.Str(slot(op).server.baseUrl(op.str("seed"))))
        "cleanup" -> {
            slots.clear()
            ok("ok" to JVal.Bool(true))
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
