package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.RevisionKv
import java.io.File

/**
 * #404 : les écritures HORS CacheStore passent par la MÊME garde d'époque.
 *
 * Le cache n'était pas le seul à écrire dans `filesDir/offline/` : les fiches
 * de révision (`revisions/`) et les préférences matière
 * (`subject_prefs.json`) y écrivaient À CÔTÉ, sans la garde d'époque. La
 * purge de déconnexion effaçait bien le dossier (elle est récursive), mais
 * une écriture EN VOL — une fiche générée pendant la déconnexion, une
 * préférence enregistrée — recréait le répertoire purgé et y laissait de la
 * donnée du compte déconnecté (le contenu scolaire d'une fiche, les
 * préférences de matières).
 *
 * L'époque est capturée AU DÉBUT de l'opération (une fiche passe par un
 * appel LLM de plusieurs secondes) et revérifiée ici : la purge et l'écriture
 * sont alors ORDONNÉES — soit l'écriture précède la purge (et la purge
 * l'efface), soit la purge précède (et l'écriture est REFUSÉE, sans même
 * ressusciter le répertoire).
 *
 * ponytail: stdlib `java.io` seule, pas de Room/DataStore, pas de journal.
 * Upgrade: un store unique (toutes les écritures dans le même dossier, une
 * seule serrure, une écriture atomique comme le cache).
 */
object OfflineArtifacts {
    /**
     * Écrit un fichier texte sous la garde d'époque.
     *
     * Renvoie `false` si l'écriture est abandonnée (la session a changé
     * depuis [epoch]) : le fichier n'est pas créé et son dossier parent n'est
     * PAS ressuscité.
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
 * #404 : l'écriture passe par la garde d'époque ([OfflineArtifacts]) — une
 * fiche générée pendant une déconnexion n'est PAS écrite, donc le répertoire
 * purgé ne ressuscite pas. L'époque est celle de l'opération (capturée par
 * l'appelant AVANT l'appel LLM, qui dure plusieurs secondes).
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
