// CacheScopeParityMain.kt — pilote JSON du scopage du cache par compte (#407).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-cache-scope.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile les VRAIES classes de
// production `fr.veryslopnynotes.data.CacheScope`, `fr.veryslopnynotes.data.
// AccountIdentity` et `fr.veryslopnynotes.data.FileCacheStore` (logique pure :
// `java.io` seul, aucun import Android) et les pilote ici : les assertions
// portent donc sur du code exécuté, pas sur un miroir TS.
//
// Scénarios rejoués : l'appairage d'un AUTRE compte purge le cache du compte
// précédent, l'appairage du MÊME compte le conserve, la session MORTE purge
// elle aussi, et une lecture en vol ne ressuscite pas un cache purgé.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout, comme les autres pilotes de `agents/runtime/kotlin-parity/`. Les
// erreurs du PILOTE (op inconnue, sid absent) sont préfixées `pilote: ` et
// refusées par le test.
package fr.veryslopnynotes.cachescope

import fr.veryslopnynotes.data.AccountIdentity
import fr.veryslopnynotes.data.CacheScope
import fr.veryslopnynotes.data.FileCacheStore
import fr.veryslopnynotes.data.SessionEpoch
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets
import java.nio.file.Files

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun JVal.Obj.obj(key: String): JVal.Obj? = fields[key] as? JVal.Obj

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

/** Un store de cache + son dossier (comme l'app et le job de fond). */
private class Slot(val id: Int, val dir: File) {
    val store = FileCacheStore(dir)
}

private class Bench {
    private val slots = LinkedHashMap<Int, Slot>()
    private val roots = mutableListOf<File>()
    private var nextId = 1

    fun newSlot(): Slot {
        val root = Files.createTempDirectory("vsn-cache-scope").toFile()
        roots.add(root)
        return register(root)
    }

    private fun register(dir: File): Slot {
        val slot = Slot(nextId++, dir)
        slots[slot.id] = slot
        return slot
    }

    fun slot(op: JVal.Obj, key: String = "sid"): Slot {
        val id = (op.num(key) ?: 0.0).toInt()
        return slots[id] ?: throw IllegalArgumentException("pilote: sid inconnu ($id)")
    }

    fun cleanup() {
        for (root in roots) root.deleteRecursively()
        roots.clear()
        slots.clear()
    }
}

/** Identité d'un compte : endpoint + login (les deux sont fournis par le test). */
private fun identityOf(raw: JVal.Obj?): AccountIdentity? {
    if (raw == null) return null
    return AccountIdentity.of(raw.str("endpoint") ?: "", raw.str("username") ?: "")
}

private class Driver {
    private val bench = Bench()

    fun run(op: JVal.Obj): JVal.Obj = when (op.str("op")) {
        "newStore" -> {
            val slot = bench.newSlot()
            ok("sid" to JVal.Num(slot.id.toDouble()), "dir" to JVal.Str(slot.dir.absolutePath))
        }
        "write" -> {
            val slot = bench.slot(op)
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val payload = op.str("payload") ?: ""
            val at = (op.num("fetchedAt") ?: 0.0).toLong()
            slot.store.save(resource, payload, at, op.str("query") ?: "")
            ok("ok" to JVal.Bool(true))
        }
        "load" -> {
            val slot = bench.slot(op)
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val entry = slot.store.load(resource, op.str("query") ?: "")
            if (entry == null) {
                ok("found" to JVal.Bool(false))
            } else {
                ok(
                    "found" to JVal.Bool(true),
                    "payload" to JVal.Str(entry.payload),
                    "fetchedAt" to JVal.Num(entry.fetchedAt.toDouble()),
                )
            }
        }
        // Appairage : le dépôt purge le cache si le compte a changé.
        "pair" -> {
            val slot = bench.slot(op)
            val purged = CacheScope.onAccountPaired(
                slot.store,
                identityOf(op.obj("previous")),
                identityOf(op.obj("current")),
            )
            ok("purged" to JVal.Bool(purged))
        }
        // Session morte : le cache part avec elle.
        "dead" -> {
            val slot = bench.slot(op)
            CacheScope.onSessionDead(slot.store)
            ok("ok" to JVal.Bool(true))
        }
        // Purge explicite (déconnexion).
        "purge" -> {
            val slot = bench.slot(op)
            CacheScope.purge(slot.store)
            ok("ok" to JVal.Bool(true))
        }
        "epoch" -> ok("epoch" to JVal.Num(SessionEpoch.current().toDouble()))
        // Début d'une lecture : l'époque est capturée AVANT la lecture locale.
        "readBegin" -> ok("epoch" to JVal.Num(SessionEpoch.current().toDouble()))
        // Fin de lecture : l'écriture est gardée par l'époque capturée.
        "readEnd" -> {
            val slot = bench.slot(op)
            val epoch = (op.num("epoch") ?: 0.0).toLong()
            val resource = op.str("resource") ?: throw IllegalArgumentException("pilote: resource absent")
            val payload = op.str("payload") ?: ""
            val at = (op.num("fetchedAt") ?: 0.0).toLong()
            val written = SessionEpoch.writeIfCurrent(epoch) {
                slot.store.save(resource, payload, at, op.str("query") ?: "")
            }
            ok("written" to JVal.Bool(written != null))
        }
        "files" -> {
            val slot = bench.slot(op)
            val names = slot.dir.listFiles()?.map { it.name }?.sorted() ?: emptyList()
            ok("files" to JVal.Arr(names.map { JVal.Str(it) }))
        }
        "cleanup" -> {
            bench.cleanup()
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
