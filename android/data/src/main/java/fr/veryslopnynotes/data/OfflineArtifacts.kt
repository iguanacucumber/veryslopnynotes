package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.RevisionKv
import java.io.File

/**
 * Les écritures HORS CacheStore passent par la MÊME garde d'époque.
 *
 * Les fiches de révision (`revisions/`) et les préférences matière
 * (`subject_prefs.json`) écrivaient à côté du cache, sans la garde. La purge de
 * déconnexion effaçait bien le dossier, mais une écriture EN VOL recréait le
 * répertoire purgé et y laissait la donnée du compte déconnecté.
 *
 * L'époque est capturée AU DÉBUT de l'opération et revérifiée ici : soit
 * l'écriture précède la purge (qui l'efface), soit la purge précède (l'écriture
 * est REFUSÉE, sans ressusciter le répertoire).
 *
 * ponytail: stdlib `java.io` seule, pas de Room/DataStore, pas de journal.
 * Upgrade: un store unique (même dossier, une serrure, écriture atomique).
 */
object OfflineArtifacts {
    /**
     * Écrit un fichier texte sous la garde d'époque.
     *
     * `false` = écriture abandonnée (la session a changé depuis [epoch]) : le
     * fichier n'est pas créé et son dossier parent n'est PAS ressuscité.
     */
    fun writeText(file: File, content: String, epoch: Long): Boolean =
        SessionEpoch.writeIfCurrent(epoch) {
            file.parentFile?.let { if (!it.exists()) it.mkdirs() }
            file.writeText(content)
            true
        } ?: false

    /** Écrit un fichier binaire sous la garde d'époque (mêmes règles). */
    fun writeBytes(file: File, bytes: ByteArray, epoch: Long): Boolean =
        SessionEpoch.writeIfCurrent(epoch) {
            file.parentFile?.let { if (!it.exists()) it.mkdirs() }
            file.writeBytes(bytes)
            true
        } ?: false
}

/**
 * Fiches de révision sur disque : un fichier `.bin` par clé, dans
 * `filesDir/offline/revisions/`.
 *
 * L'écriture passe par la garde d'époque ([OfflineArtifacts]) : une fiche
 * générée pendant une déconnexion n'est PAS écrite. L'époque est capturée par
 * l'appelant AVANT l'appel LLM, qui dure plusieurs secondes.
 */
class FileRevisionStore(private val dir: File) : RevisionKv {
    override fun get(key: String): ByteArray? = try {
        fileFor(key).takeIf { it.isFile }?.readBytes()
    } catch (_: Exception) {
        null
    }

    override fun set(key: String, value: ByteArray, epoch: Long): Boolean =
        OfflineArtifacts.writeBytes(fileFor(key), value, epoch)

    private fun fileFor(key: String): File {
        val safe = key.map {
            if (it.isLetterOrDigit() || it == '-' || it == '_' || it == '.') it else '_'
        }.joinToString("").take(120).ifEmpty { "_" }
        return File(dir, "$safe.bin")
    }
}
