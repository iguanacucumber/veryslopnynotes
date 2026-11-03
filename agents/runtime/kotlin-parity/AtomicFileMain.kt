// AtomicFileMain.kt — pilote JSON de l'écriture durable (temp + fsync + rename).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-atomic-writes.test.ts`.
// Les pannes sont INJECTÉES dans le chemin réel de production : écriture
// partielle puis exception (crash avant le rename), ou rename refusé (crash
// entre la sauvegarde et le remplacement).
package fr.veryslopnynotes.offline

import fr.veryslopnynotes.data.DurableFile
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.File
import java.io.IOException
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets
import java.nio.file.Files

private fun JVal.Obj.atomicStr(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.atomicNum(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun atomicErr(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun atomicOk(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

/** Écrit la moitié du contenu puis échoue : la cible ne doit pas bouger. */
private class PartialWriteFailure : DurableFile.Io {
    private val real = DurableFile.PlatformIo

    override fun write(file: File, bytes: ByteArray) {
        file.writeBytes(bytes.copyOf(bytes.size / 2))
        throw IOException("panne simulee pendant l'ecriture")
    }

    override fun rename(source: File, target: File): Boolean = real.rename(source, target)

    override fun syncDirectory(dir: File) = real.syncDirectory(dir)
}

/** Refuse le remplacement de la cible : crash après la sauvegarde. */
private class RenameFailure(private val targetName: String) : DurableFile.Io {
    private val real = DurableFile.PlatformIo

    override fun write(file: File, bytes: ByteArray) = real.write(file, bytes)

    override fun rename(source: File, target: File): Boolean =
        if (target.name == targetName) false else real.rename(source, target)

    override fun syncDirectory(dir: File) = real.syncDirectory(dir)
}

private class AtomicBench {
    private val roots = mutableListOf<File>()
    private var nextId = 1

    fun newDir(): Pair<Int, File> {
        val root = Files.createTempDirectory("vsn-atomic").toFile()
        roots.add(root)
        return nextId++ to root
    }

    fun cleanup() {
        for (root in roots) root.deleteRecursively()
        roots.clear()
    }
}

private fun relativeFiles(dir: File): List<String> {
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

private class AtomicDriver {
    private val bench = AtomicBench()
    private val dirs = LinkedHashMap<Int, File>()

    fun run(op: JVal.Obj): JVal.Obj {
        if (op.atomicStr("op") == "newDir") {
            val (id, dir) = bench.newDir()
            dirs[id] = dir
            return atomicOk("sid" to JVal.Num(id.toDouble()))
        }
        if (op.atomicStr("op") == "cleanup") {
            bench.cleanup()
            dirs.clear()
            return atomicOk("ok" to JVal.Bool(true))
        }
        val id = (op.atomicNum("sid") ?: 0.0).toInt()
        val dir = dirs[id] ?: throw IllegalArgumentException("pilote: sid inconnu ($id)")
        val name = op.atomicStr("name") ?: ""
        val target = File(dir, name)
        return when (op.atomicStr("op")) {
            "write" -> {
                val content = op.atomicStr("content") ?: ""
                DurableFile.write(target, content.toByteArray(StandardCharsets.UTF_8))
                atomicOk("written" to JVal.Bool(true))
            }
            "crashWrite" -> {
                val content = op.atomicStr("content") ?: ""
                val failure = try {
                    DurableFile.write(
                        target,
                        content.toByteArray(StandardCharsets.UTF_8),
                        PartialWriteFailure(),
                    )
                    null
                } catch (e: Exception) {
                    e.javaClass.simpleName
                }
                atomicOk("failure" to JVal.Str(failure ?: ""))
            }
            "crashRename" -> {
                val content = op.atomicStr("content") ?: ""
                val failure = try {
                    DurableFile.write(
                        target,
                        content.toByteArray(StandardCharsets.UTF_8),
                        RenameFailure(target.name),
                    )
                    null
                } catch (e: Exception) {
                    e.javaClass.simpleName
                }
                atomicOk("failure" to JVal.Str(failure ?: ""))
            }
            "read" -> {
                val value = DurableFile.read(target) { raw ->
                    if (raw.startsWith("BAD")) null else raw
                }
                atomicOk("value" to (value?.let { JVal.Str(it) } ?: JVal.Null))
            }
            "raw" -> {
                val content = if (target.isFile) target.readText() else ""
                atomicOk("exists" to JVal.Bool(target.isFile), "content" to JVal.Str(content))
            }
            "files" -> atomicOk("files" to JVal.Arr(relativeFiles(dir).map { JVal.Str(it) }))
            "writeRaw" -> {
                val content = op.atomicStr("content") ?: ""
                target.parentFile?.mkdirs()
                target.writeText(content)
                atomicOk("written" to JVal.Bool(true))
            }
            else -> throw IllegalArgumentException("pilote: operation inconnue : ${op.atomicStr("op")}")
        }
    }
}

fun main() {
    val stdin = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    val stdout = PrintStream(System.out, true, StandardCharsets.UTF_8.name())
    val stderr = PrintStream(System.err, true, StandardCharsets.UTF_8.name())
    val driver = AtomicDriver()
    while (true) {
        val line = stdin.readLine() ?: break
        if (line.isBlank()) continue
        try {
            stdout.println(Json.stringify(driver.run(Json.parse(line) as JVal.Obj)))
        } catch (e: Exception) {
            val name = e.javaClass.simpleName
            stderr.println("port: $name: ${e.message}")
            stdout.println(Json.stringify(atomicErr(name, e.message)))
        }
    }
}
