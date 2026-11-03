// SessionStoreParityMain.kt — pilote JSON du store de session (#862).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-session-store.test.ts`
// (jamais Gradle, jamais l'APK). Le disque est un faux `KeyValueStore` partagé
// entre le store dégradé et le store sain du « lancement suivant » : le test
// prouve qu'une session déconnectée en mode dégradé ne ressuscite pas.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.sessionstore

import fr.veryslopnynotes.data.KeyValueStore
import fr.veryslopnynotes.data.ResilientSessionStore
import fr.veryslopnynotes.data.SecureStorage
import fr.veryslopnynotes.data.SessionLoad
import fr.veryslopnynotes.data.SessionRecordStore
import fr.veryslopnynotes.data.SessionStore
import fr.veryslopnynotes.data.StoredSession
import fr.veryslopnynotes.data.WriteResult
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private fun strings(values: Collection<String>): JVal.Arr = JVal.Arr(values.map { JVal.Str(it) })

private fun result(value: WriteResult): String = when (value) {
    is WriteResult.Written -> "written"
    is WriteResult.Failed -> "failed"
    is WriteResult.Refused -> "refused"
    is WriteResult.EpochRefused -> "epoch_refused"
}

private fun outcome(value: SessionLoad): String = when (value) {
    SessionLoad.Absent -> "absent"
    is SessionLoad.Complete -> "complete"
    is SessionLoad.Incomplete -> "incomplete"
}

private fun session(): StoredSession = StoredSession(
    endpointUrl = "https://etab.exemple/eleve",
    username = "eleve.a",
    password = "jeton-factice",
    uuid = "uuid-factice",
    clientIdentifier = null,
    schoolUrl = "https://etab.exemple",
)

/** Le fichier chiffré simulé : même contenu partagé entre deux « lancements ». */
private class DiskStore : KeyValueStore {
    val values = LinkedHashMap<String, String>()
    var failClear = false

    override fun getString(key: String): String? = values[key]

    override fun commit(values: Map<String, String>): Boolean {
        this.values.putAll(values)
        return true
    }

    override fun clear(): Boolean {
        if (failClear) return false
        values.clear()
        return true
    }
}

/** Un store sain dont l'effacement échoue : le fichier reste l'autorité. */
private class ClearFails(private val disk: DiskStore) : SessionStore {
    private val records = SessionRecordStore(disk)

    override fun save(session: StoredSession): WriteResult = records.save(session)

    override fun load(): StoredSession? = records.load()

    override fun loadOutcome(): SessionLoad = records.loadOutcome()

    override fun clear(): WriteResult = WriteResult.Failed("session non effacée")
}

/** Un store qui lâche APRÈS l'init (Keystore invalidé en cours de process). */
private class ThrowingStore : SessionStore {
    override fun save(session: StoredSession): WriteResult = throw IllegalStateException("keystore")

    override fun load(): StoredSession? = throw IllegalStateException("keystore")

    override fun loadOutcome(): SessionLoad = throw IllegalStateException("keystore")

    override fun clear(): WriteResult = throw IllegalStateException("keystore")
}

private fun seededDisk(): DiskStore = DiskStore().also {
    check(SessionRecordStore(it).save(session()).ok)
}

private class Driver {
    fun run(op: JVal.Obj): JVal.Obj = when (op.fields["op"]?.let { (it as? JVal.Str)?.value }) {
        // Keystore mort au démarrage : le repli efface le chiffré. Logout en
        // dégradé, puis lancement sain : plus rien.
        "degraded-logout-healthy" -> {
            val disk = seededDisk()
            var discards = 0
            val degraded = ResilientSessionStore(null) {
                discards++
                disk.values.clear()
                true
            }
            val afterFallback = disk.values.keys.toList()
            val logout = degraded.clear()
            val nextLaunch = SessionRecordStore(disk).loadOutcome()
            ok(
                "discards" to JVal.Num(discards.toDouble()),
                "afterFallbackKeys" to strings(afterFallback),
                "logout" to JVal.Str(result(logout)),
                "nextLaunch" to JVal.Str(outcome(nextLaunch)),
                "health" to JVal.Str(SecureStorage.health().name),
            )
        }
        // Le premier effacement échoue : le logout doit RÉESSAYER et le dire.
        "degraded-logout-retry" -> {
            val disk = seededDisk()
            var attempts = 0
            val degraded = ResilientSessionStore(null) {
                attempts++
                if (attempts >= 2) {
                    disk.values.clear()
                    true
                } else {
                    false
                }
            }
            val afterFallback = disk.values.keys.toList()
            val logout = degraded.clear()
            val nextLaunch = SessionRecordStore(disk).loadOutcome()
            ok(
                "attempts" to JVal.Num(attempts.toDouble()),
                "afterFallbackKeys" to strings(afterFallback),
                "logout" to JVal.Str(result(logout)),
                "nextLaunch" to JVal.Str(outcome(nextLaunch)),
            )
        }
        // Effacement impossible : l'ancienne session reste, et l'échec remonte.
        "clear-failure" -> {
            val disk = seededDisk()
            var discards = 0
            val store = ResilientSessionStore(ClearFails(disk)) {
                discards++
                false
            }
            val logout = store.clear()
            val found = store.load()
            val nextLaunch = SessionRecordStore(disk).loadOutcome()
            ok(
                "discards" to JVal.Num(discards.toDouble()),
                "logout" to JVal.Str(result(logout)),
                "found" to JVal.Bool(found != null),
                "nextLaunch" to JVal.Str(outcome(nextLaunch)),
            )
        }
        // `commit()` d'effacement raté, mais le fichier part quand même : le
        // logout est durable et le prochain lancement ne voit rien.
        "clear-failure-disk-deleted" -> {
            val disk = seededDisk()
            disk.failClear = true
            var discards = 0
            val store = ResilientSessionStore(SessionRecordStore(disk)) {
                discards++
                disk.values.clear()
                true
            }
            val logout = store.clear()
            val nextLaunch = SessionRecordStore(disk).loadOutcome()
            ok(
                "discards" to JVal.Num(discards.toDouble()),
                "logout" to JVal.Str(result(logout)),
                "nextLaunch" to JVal.Str(outcome(nextLaunch)),
            )
        }
        // Le Keystore lâche après l'init : la lecture retombe en mémoire,
        // efface le chiffré, et un lancement sain ne ressuscite rien.
        "load-throws" -> {
            val disk = seededDisk()
            var discards = 0
            val store = ResilientSessionStore(ThrowingStore()) {
                discards++
                disk.values.clear()
                true
            }
            val before = store.loadOutcome()
            val nextLaunch = SessionRecordStore(disk).loadOutcome()
            ok(
                "discards" to JVal.Num(discards.toDouble()),
                "status" to JVal.Str(outcome(before)),
                "nextLaunch" to JVal.Str(outcome(nextLaunch)),
                "health" to JVal.Str(SecureStorage.health().name),
            )
        }
        "cleanup" -> ok("ok" to JVal.Bool(true))
        else -> throw IllegalArgumentException("pilote: opération inconnue")
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
