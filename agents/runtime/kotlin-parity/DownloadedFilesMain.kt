// DownloadedFilesMain.kt — pilote JSON des pièces jointes téléchargées (#540).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/downloaded-files.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile les VRAIES classes de
// production `fr.veryslopnynotes.data.DownloadedFiles` et
// `fr.veryslopnynotes.data.LocalDataStore` (logique pure : `java.io` seul,
// aucun import Android) et les pilote ici : les assertions portent donc sur du
// code EXÉCUTÉ, pas sur un miroir TS.
//
// Scénarios rejoués : deux pièces distinctes du MÊME devoir portant le MÊME
// libellé produisent DEUX fichiers distincts ; le cache des téléchargements est
// borné ; une écriture pendant une déconnexion est refusée ; la purge de
// déconnexion et le changement de compte effacent les pièces jointes.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout, comme les autres pilotes de `agents/runtime/kotlin-parity/`. Les
// erreurs du PILOTE (op inconnue, sid absent) sont préfixées `pilote: ` et
// refusées par le test.
package fr.veryslopnynotes.downloads

import fr.veryslopnynotes.data.AccountIdentity
import fr.veryslopnynotes.data.CacheScope
import fr.veryslopnynotes.data.DownloadedFiles
import fr.veryslopnynotes.data.FileCacheStore
import fr.veryslopnynotes.data.LocalDataStore
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

/**
 * Un « poste » de test : le cache (`filesDir/offline/`) et le cache des
 * téléchargements (`cacheDir/`), comme l'app.
 */
private class Slot(val id: Int, val root: File) {
    /** Le cache : `filesDir/offline/`. */
    val offline = File(root, "offline")

    /** Le CACHE des téléchargements : `cacheDir/` (pièces jointes, exports). */
    val cacheRoot = File(root, "cache")

    /** Le store de l'app : le cache ET les téléchargements (#540). */
    val store = LocalDataStore(FileCacheStore(offline), cacheRoot)

    /** La racine des pièces jointes : `cacheDir/attachments/`. */
    val attachments = File(cacheRoot, DownloadedFiles.ATTACHMENTS)
}

private class Bench {
    private val slots = LinkedHashMap<Int, Slot>()
    private val roots = mutableListOf<File>()
    private var nextId = 1

    fun newSlot(): Slot {
        val root = Files.createTempDirectory("vsn-downloads").toFile()
        roots.add(root)
        val slot = Slot(nextId++, root)
        slot.offline.mkdirs()
        slot.cacheRoot.mkdirs()
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

/** Les fichiers du dossier, chemins relatifs, triés. */
private fun listFiles(dir: File): List<String> {
    val out = mutableListOf<String>()
    fun walk(current: File, prefix: String) {
        val children = current.listFiles()?.sortedBy { it.name } ?: return
        for (child in children) {
            val name = if (prefix.isEmpty()) child.name else "$prefix/${child.name}"
            if (child.isDirectory) walk(child, name) else out.add(name)
        }
    }
    walk(dir, "")
    return out
}

/** Identité d'un compte : endpoint + login (fournis par le test). */
private fun identityOf(raw: JVal.Obj?): AccountIdentity? {
    if (raw == null) return null
    return AccountIdentity.of(raw.str("endpoint") ?: "", raw.str("username") ?: "")
}

private class Driver {
    private val bench = Bench()

    fun run(op: JVal.Obj): JVal.Obj = when (op.str("op")) {
        "newStore" -> {
            val slot = bench.newSlot()
            ok("sid" to JVal.Num(slot.id.toDouble()))
        }
        "epoch" -> ok("epoch" to JVal.Num(SessionEpoch.current().toDouble()))
        // Écriture d'une pièce jointe : le VRAI code de production.
        "write" -> {
            val slot = bench.slot(op)
            val epoch = (op.num("epoch") ?: SessionEpoch.current().toDouble()).toLong()
            val content = op.str("content") ?: "contenu"
            val file = DownloadedFiles.write(
                slot.attachments,
                op.str("homework") ?: "devoir-1",
                op.str("id") ?: "1",
                op.str("label") ?: "piece.pdf",
                content.toByteArray(Charsets.UTF_8),
                epoch,
            )
            if (file == null) {
                ok("ok" to JVal.Bool(false), "name" to JVal.Str(""))
            } else {
                ok(
                    "ok" to JVal.Bool(true),
                    "name" to JVal.Str(file.name),
                    "path" to JVal.Str(file.absolutePath),
                )
            }
        }
        "files" -> {
            val slot = bench.slot(op)
            ok("files" to JVal.Arr(listFiles(slot.cacheRoot).map { JVal.Str(it) }))
        }
        "content" -> {
            val slot = bench.slot(op)
            val name = op.str("name") ?: throw IllegalArgumentException("pilote: name absent")
            val file = File(slot.cacheRoot, name)
            ok(
                "exists" to JVal.Bool(file.isFile),
                "content" to JVal.Str(if (file.isFile) file.readText() else ""),
            )
        }
        // Cache borné : les fichiers les plus anciens partent.
        "prune" -> {
            val slot = bench.slot(op)
            val keep = (op.num("keep") ?: 1.0).toInt()
            val deleted = DownloadedFiles.prune(slot.attachments, keep)
            ok("deleted" to JVal.Num(deleted.toDouble()))
        }
        // Purge directe du cache des téléchargements.
        "purge" -> {
            val slot = bench.slot(op)
            val deleted = DownloadedFiles.purge(slot.cacheRoot)
            ok("deleted" to JVal.Num(deleted.toDouble()))
        }
        // Déconnexion : la purge passe par le `CacheScope` (le MÊME chemin que
        // le cache) — le store englobe les téléchargements (#540).
        "logout" -> {
            val slot = bench.slot(op)
            CacheScope.purge(slot.store)
            ok("epoch" to JVal.Num(SessionEpoch.current().toDouble()))
        }
        // Changement de compte : même purge, par le même chemin.
        "pair" -> {
            val slot = bench.slot(op)
            val purged = CacheScope.onAccountPaired(
                slot.store,
                identityOf(op.obj("previous")),
                identityOf(op.obj("current")),
            )
            ok("purged" to JVal.Bool(purged))
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
