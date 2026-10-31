// SessionRepairParityMain.kt — pilote JSON de la réparation d'une session MORTE.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-session-repair.test.ts` (jamais Gradle, jamais l'APK).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.sessionrepair

import fr.veryslopnynotes.data.DeviceAuth
import fr.veryslopnynotes.data.FileCacheStore
import fr.veryslopnynotes.data.PronoteSession
import fr.veryslopnynotes.data.SessionRepair
import fr.veryslopnynotes.data.isSessionFailure
import fr.veryslopnynotes.pronote.Client
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import fr.veryslopnynotes.pronote.PRONOTE_ERROR_MESSAGES
import fr.veryslopnynotes.pronote.PronoteAPIError
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets
import java.nio.file.Files

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

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
        val root = Files.createTempDirectory("vsn-session-repair").toFile()
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
        "files" -> {
            val slot = bench.slot(op)
            val names = slot.dir.listFiles()?.map { it.name }?.sorted() ?: emptyList()
            ok("files" to JVal.Arr(names.map { JVal.Str(it) }))
        }
        // La session en mémoire est posée : après la purge, elle doit être
        // abandonnée (plus de client = plus de lecture possible). Le client
        // est un FAUX client (aucun appel réseau : `Client` ne fait rien
        // tant qu'on ne l'initialise pas).
        "openSession" -> {
            PronoteSession.set(Client("https://etab.exemple/eleve", "eleve.a", "jeton-factice"))
            ok("client" to JVal.Bool(PronoteSession.client != null))
        }
        // Le REJET : c'est ce que fait un dépôt quand le jeton est tourné
        // (`DeviceAuth.reject()`). L'abonné branché est celui de l'app : la
        // purge de production (`SessionRepair.purge`).
        "reject" -> {
            val slot = bench.slot(op)
            var sessionCleared = false
            DeviceAuth.setOnRejected {
                SessionRepair.purge({ sessionCleared = true }, slot.store)
            }
            DeviceAuth.reject()
            ok(
                "sessionCleared" to JVal.Bool(sessionCleared),
                "client" to JVal.Bool(PronoteSession.client != null),
            )
        }
        // Un SECOND rejet (un autre dépôt échoue au même moment) : la purge
        // est idempotente, rien ne ressuscite, rien ne boucle.
        "rejectAgain" -> {
            val slot = bench.slot(op)
            var sessionCleared = false
            DeviceAuth.setOnRejected {
                SessionRepair.purge({ sessionCleared = true }, slot.store)
            }
            DeviceAuth.reject()
            ok(
                "sessionCleared" to JVal.Bool(sessionCleared),
                "client" to JVal.Bool(PronoteSession.client != null),
            )
        }
        // une LECTURE qui échoue — le chemin RÉEL d'un dépôt : la
        // décision de production (`isSessionFailure`) décide si le signal
        // « session morte » est levé, donc si le cache est purgé. La
        // décision tranche par TYPE et par code `G`, JAMAIS par un mot du
        // message : un `Titre` de l'établissement (« Confirmation de
        // connexion requise ») ne peut donc pas vider le cache de l'élève.
        "readFailure" -> {
            val slot = bench.slot(op)
            val cause: Exception = when (op.str("kind")) {
                // L'établissement refuse (G=3) : son message contient un mot
                // de session, mais ce n'est PAS une session morte.
                "establishment" -> PronoteAPIError(
                    "Unknown error from pronote: 3 | Confirmation de connexion requise",
                    3,
                    "Confirmation de connexion requise",
                )
                // G=10 : la VRAIE session morte (« Session has expired… »).
                "deadSession" -> PronoteAPIError(PRONOTE_ERROR_MESSAGES.getValue(10), 10, "session expirée")
                // HTTP 401 : le jeton n'est plus accepté — le STATUT le dit
                // (c'est un champ de l'erreur, pas un mot du message).
                "http401" -> PronoteAPIError("Bad request (http status: 401)", httpStatus = 401)
                else -> throw IllegalArgumentException("pilote: kind inconnu (${op.str("kind")})")
            }
            var sessionCleared = false
            DeviceAuth.setOnRejected {
                SessionRepair.purge({ sessionCleared = true }, slot.store)
            }
            val dead = isSessionFailure(cause)
            if (dead) DeviceAuth.reject()
            ok(
                "dead" to JVal.Bool(dead),
                "sessionCleared" to JVal.Bool(sessionCleared),
                "client" to JVal.Bool(PronoteSession.client != null),
            )
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
