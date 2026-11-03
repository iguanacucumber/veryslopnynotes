package fr.veryslopnynotes.data

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption

/**
 * La donnée existe sur le disque mais ne se relit pas, et aucune sauvegarde
 * valide ne la remplace. L'appelant doit le DIRE : une liste vide ou un écran
 * vide affirmerait à tort que l'utilisateur n'a rien enregistré.
 */
class LocalDataUnreadable : Exception(MESSAGE) {
    companion object {
        const val MESSAGE =
            "Données locales illisibles : la donnée enregistrée sur cet appareil n'a pas pu être lue."
    }
}

/**
 * Écriture DURABLE d'un petit fichier : le contenu part dans un temporaire du
 * même dossier, est `fsync`é, puis remplacé par `rename` atomique. La cible
 * précédente reste dans `<nom>.bak` : une panne entre l'écriture et le
 * remplacement laisse l'ancienne version intacte, et la suivante peut la
 * relire.
 *
 * Un fichier illisible ou hors contrat est MIS EN QUARANTAINE
 * (`quarantine/<nom>.<horodatage>.corrupt`) au lieu d'être écrasé en silence,
 * puis la sauvegarde est relue et restaurée. Aucune donnée utilisateur ne
 * disparaît parce qu'un octet s'est corrompu.
 */
object DurableFile {
    internal interface Io {
        fun write(file: File, bytes: ByteArray)

        fun rename(source: File, target: File): Boolean

        fun syncDirectory(dir: File)

        fun delete(file: File): Boolean = file.delete()
    }

    internal object PlatformIo : Io {
        override fun write(file: File, bytes: ByteArray) {
            FileOutputStream(file).use { out ->
                out.write(bytes)
                out.flush()
                out.fd.sync()
            }
        }

        override fun rename(source: File, target: File): Boolean = try {
            Files.move(
                source.toPath(),
                target.toPath(),
                StandardCopyOption.REPLACE_EXISTING,
                StandardCopyOption.ATOMIC_MOVE,
            )
            true
        } catch (_: Exception) {
            source.renameTo(target)
        }

        override fun syncDirectory(dir: File) {
            try {
                FileChannel.open(dir.toPath(), StandardOpenOption.READ).use { it.force(true) }
            } catch (_: Exception) {
                // Certains systèmes de fichiers refusent le fsync de dossier :
                // le rename a déjà rendu le nouveau contenu visible.
            }
        }
    }

    fun write(target: File, bytes: ByteArray) = write(target, bytes, PlatformIo)

    internal fun write(target: File, bytes: ByteArray, io: Io) {
        val parent = target.parentFile ?: throw IOException("chemin sans dossier: ${target.name}")
        if (!parent.isDirectory && !parent.mkdirs() && !parent.isDirectory) {
            throw IOException("dossier inaccessible: ${parent.name}")
        }
        val tmp = File.createTempFile("tmp-", ".tmp", parent)
        try {
            io.write(tmp, bytes)
            retainBackup(target, io)
            if (!io.rename(tmp, target)) throw IOException("ecriture impossible: ${target.name}")
            io.syncDirectory(parent)
        } finally {
            tmp.delete()
        }
    }

    /**
     * Lit [target] et le remplace par [backup] s'il est illisible.
     *
     * `null` = ABSENT. Une cible présente mais illisible LÈVE
     * [LocalDataUnreadable] : l'appelant ne peut pas confondre « rien
     * enregistré » avec « donnée corrompue », ni réécrire par-dessus.
     */
    fun <T> read(target: File, parse: (String) -> T?): T? = read(target, parse, PlatformIo)

    internal fun <T> read(target: File, parse: (String) -> T?, io: Io): T? {
        if (!target.isFile) return null
        val raw = try {
            target.readText()
        } catch (_: Exception) {
            null
        }
        if (raw != null) {
            val parsed = try {
                parse(raw)
            } catch (_: Exception) {
                null
            }
            if (parsed != null) return parsed
        }
        quarantine(target, io)
        val backup = backupOf(target)
        if (!backup.isFile) throw LocalDataUnreadable()
        val recovered = try {
            parse(backup.readText())
        } catch (_: Exception) {
            null
        } ?: throw LocalDataUnreadable()
        try {
            write(target, backup.readBytes(), io)
        } catch (_: Exception) {
            // La sauvegarde reste lisible même si sa restauration échoue.
        }
        return recovered
    }

    /**
     * Efface la cible, sa sauvegarde et ses copies en quarantaine, puis VÉRIFIE
     * leur absence. `false` = au moins un fichier résiste : l'appelant ne doit
     * pas annoncer une suppression réussie.
     */
    fun delete(target: File): Boolean = delete(target, PlatformIo)

    internal fun delete(target: File, io: Io): Boolean {
        var ok = remove(target, io)
        val backup = backupOf(target)
        ok = remove(backup, io) && ok
        val dir = quarantineDir(target)
        if (dir != null && dir.exists()) {
            val copies = dir.listFiles { file -> file.name.startsWith("${target.name}.") }
            if (copies == null) {
                ok = false
            } else {
                for (copy in copies) ok = remove(copy, io) && ok
            }
        }
        return ok && !target.exists() && !backup.exists()
    }

    private fun remove(file: File, io: Io): Boolean {
        if (!file.exists()) return true
        io.delete(file)
        return !file.exists()
    }

    private fun retainBackup(target: File, io: Io) {
        if (!target.isFile) return
        val backup = backupOf(target)
        val tmp = File.createTempFile("bak-", ".tmp", target.parentFile)
        try {
            io.write(tmp, target.readBytes())
            if (!io.rename(tmp, backup)) throw IOException("sauvegarde impossible: ${target.name}")
        } finally {
            tmp.delete()
        }
    }

    private fun quarantine(target: File, io: Io) {
        if (!target.exists()) return
        val dir = quarantineDir(target) ?: return
        if (!dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) return
        val stamp = System.currentTimeMillis()
        var destination = File(dir, "${target.name}.$stamp.corrupt")
        var suffix = 0
        while (destination.exists()) {
            destination = File(dir, "${target.name}.$stamp-${++suffix}.corrupt")
        }
        if (!io.rename(target, destination)) {
            try {
                target.copyTo(destination, overwrite = true)
                target.delete()
            } catch (_: Exception) {
                return
            }
        }
        io.syncDirectory(dir)
    }

    private fun backupOf(target: File): File = File(target.parentFile, "${target.name}.bak")

    private fun quarantineDir(target: File): File? = target.parentFile?.let { File(it, "quarantine") }

    internal const val QUARANTINE_DIR = "quarantine"
}
