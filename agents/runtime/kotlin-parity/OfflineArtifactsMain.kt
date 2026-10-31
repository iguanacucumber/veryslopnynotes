// OfflineArtifactsMain.kt — pilote JSON des écritures HORS CacheStore.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-offline-artifacts.test.ts` (jamais Gradle, jamais l'APK).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.offline

import fr.veryslopnynotes.core.REVISION_TEMPLATE_VERSION
import fr.veryslopnynotes.core.RevisionKv
import fr.veryslopnynotes.core.RevisionSheet
import fr.veryslopnynotes.core.saveRevisionSheet
import fr.veryslopnynotes.data.CacheScope
import fr.veryslopnynotes.data.FileCacheStore
import fr.veryslopnynotes.data.FileRevisionStore
import fr.veryslopnynotes.data.OfflineArtifacts
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

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

/**
 * Le dossier `offline/` de l'app : le cache, les fiches (`revisions/`) et les
 * préférences (`subject_prefs.json`) y cohabitent. La purge de déconnexion
 * passe par le `CacheScope` (le MÊME chemin que le cache) : c'est donc la
 * vraie purge qui est rejouée ici.
 */
private class Slot(val id: Int, val offline: File) {
    /** Le store du cache : sa purge efface TOUT le dossier `offline/`. */
    val cache = FileCacheStore(offline)

    /** Les fiches de révision : un fichier `.bin` par clé. */
    val revisions = FileRevisionStore(File(offline, "revisions"))

    /** Les préférences matière : un fichier JSON. */
    val prefs = File(offline, "subject_prefs.json")
}

private class Bench {
    private val slots = LinkedHashMap<Int, Slot>()
    private val roots = mutableListOf<File>()
    private var nextId = 1

    fun newSlot(): Slot {
        val root = Files.createTempDirectory("vsn-offline").toFile()
        roots.add(root)
        val offline = File(root, "offline")
        offline.mkdirs()
        val slot = Slot(nextId++, offline)
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

/** Fiche de test : le contenu vient de l'opération (jamais de donnée réelle). */
private fun sheetFrom(op: JVal.Obj): RevisionSheet = RevisionSheet(
    id = op.str("id") ?: "fiche-devoir-1",
    examId = "devoir-1",
    subject = op.str("subject") ?: "Mathematiques",
    date = "2026-10-19",
    title = "Fiche de revision",
    body = op.str("body") ?: "Derivees de fonctions",
    sources = listOf("Devoir 1"),
    templateVersion = REVISION_TEMPLATE_VERSION,
    createdAt = "2026-10-19T08:00:00Z",
)

/** Les fichiers du dossier `offline/`, chemins relatifs, triés. */
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

/**
 * Store qui fait basculer l'époque AU MILIEU de l'enregistrement :
 * la première écriture (la fiche) passe, puis la déconnexion survient
 * (invalidation d'époque ET purge dans la MÊME section critique). Les
 * écritures suivantes — l'index, le journal — sont donc REFUSÉES par la
 * garde d'époque du VRAI store.
 */
private class DisconnectingStore(
    private val delegate: RevisionKv,
    private val cache: FileCacheStore,
) : RevisionKv {
    private var disconnected = false

    override fun get(key: String): ByteArray? = delegate.get(key)

    override fun set(key: String, value: ByteArray, epoch: Long): Boolean {
        val written = delegate.set(key, value, epoch)
        if (written && !disconnected) {
            disconnected = true
            CacheScope.purge(cache) // l'époque bascule ET le dossier est purgé
        }
        return written
    }
}

private class Driver {
    private val bench = Bench()

    fun run(op: JVal.Obj): JVal.Obj = when (op.str("op")) {
        "newStore" -> {
            val slot = bench.newSlot()
            ok("sid" to JVal.Num(slot.id.toDouble()))
        }
        "epoch" -> ok("epoch" to JVal.Num(SessionEpoch.current().toDouble()))
        // Écriture des préférences matière (hors CacheStore).
        "writePrefs" -> {
            val slot = bench.slot(op)
            val epoch = (op.num("epoch") ?: 0.0).toLong()
            val content = op.str("content") ?: "[]"
            val written = OfflineArtifacts.writeText(slot.prefs, content, epoch)
            ok("written" to JVal.Bool(written))
        }
        // Écriture d'une fiche de révision (hors CacheStore) : la VRAIE
        // fonction de production, avec son garde d'époque.
        "writeSheet" -> {
            val slot = bench.slot(op)
            val epoch = (op.num("epoch") ?: 0.0).toLong()
            val written = saveRevisionSheet(slot.revisions, sheetFrom(op), epoch)
            ok("written" to JVal.Bool(written))
        }
        // Enregistrement d'une fiche avec une DÉCONNEXION au milieu :
        // la coupure tombe ENTRE l'écriture de la fiche et celle de l'index.
        "writeSheetDisconnect" -> {
            val slot = bench.slot(op)
            val epoch = (op.num("epoch") ?: 0.0).toLong()
            val written = saveRevisionSheet(
                DisconnectingStore(slot.revisions, slot.cache),
                sheetFrom(op),
                epoch,
            )
            ok("written" to JVal.Bool(written))
        }
        // Déconnexion : la purge passe par le `CacheScope` (le même chemin que
        // le cache) — invalidation d'époque ET effacement du dossier.
        "logout" -> {
            val slot = bench.slot(op)
            CacheScope.purge(slot.cache)
            ok("epoch" to JVal.Num(SessionEpoch.current().toDouble()))
        }
        "files" -> {
            val slot = bench.slot(op)
            ok("files" to JVal.Arr(listFiles(slot.offline).map { JVal.Str(it) }))
        }
        "raw" -> {
            val slot = bench.slot(op)
            val name = op.str("name") ?: throw IllegalArgumentException("pilote: name absent")
            val file = File(slot.offline, name)
            val content = if (file.isFile) file.readText() else ""
            ok("exists" to JVal.Bool(file.isFile), "content" to JVal.Str(content))
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
