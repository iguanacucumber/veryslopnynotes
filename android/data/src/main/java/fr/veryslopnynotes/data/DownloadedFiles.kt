package fr.veryslopnynotes.data

import java.io.File

/**
 * Les pièces jointes téléchargées ne doivent ni se CHEVAUCHER ni s'ACCUMULER.
 *
 * Le nom porte l'IDENTIFIANT de la pièce (pas le seul libellé) : deux pièces
 * distinctes du même devoir ne peuvent pas viser le même chemin.
 *
 * Le cache des téléchargements est BORNÉ (les plus anciens partent) et PURGÉ
 * avec le cache du compte : un fichier téléchargé est la DONNÉE DU COMPTE.
 *
 * L'écriture passe par la garde d'époque : une pièce téléchargée pendant une
 * déconnexion n'est pas écrite.
 *
 * Fichier PUR (`java.io` seul) : le harnais de parité le rejoue
 * (`tests/unit/downloaded-files.test.ts`).
 */
object DownloadedFiles {
    const val ATTACHMENTS = "attachments"

    const val EXPORTS = "exports"

    const val MAX_CACHED_FILES = 24

    /** Borne d'ouverture : une pièce jointe ne dépasse pas quelques Mo. */
    const val MAX_BYTES = 10 * 1024 * 1024

    private const val ID_MAX = 32

    private const val LABEL_MAX = 32

    private const val EXT_MAX = 10

    /**
     * Nom de fichier d'une pièce : l'IDENTIFIANT d'abord, puis le libellé
     * (`42-consigne.pdf`). L'identifiant distingue deux pièces de même libellé.
     * Assaini (jamais de séparateur ni `..`), borné à ≤ 228 octets (sous la
     * borne de 255 du système de fichiers).
     */
    fun fileName(attachmentId: String, label: String): String {
        val id = clean(attachmentId, ID_MAX).ifEmpty { "piece" }
        val raw = label.trim().substringAfterLast('/').substringAfterLast('\\')
        val cut = raw.lastIndexOf('.')
        val ext = if (cut > 0) raw.substring(cut + 1).filter { it.isLetterOrDigit() }.take(EXT_MAX) else ""
        val stem = clean(if (cut > 0) raw.substring(0, cut) else raw, LABEL_MAX)
        return "$id-${stem.ifEmpty { "piece-jointe" }}" + if (ext.isEmpty()) "" else ".$ext"
    }

    /**
     * Dossier d'un devoir, assaini : le chemin reste sous la racine (I1).
     */
    fun dirFor(root: File, homeworkId: String): File =
        File(root, clean(homeworkId, 64).ifEmpty { "devoir" })

    /**
     * Fichier déjà téléchargé d'une pièce, ou `null`. Sert de cache au contexte
     * IA : une pièce déjà ouverte par le viewer n'est pas re-téléchargée.
     *
     * Deux noms possibles pour la même pièce : dérivé du libellé de payload ou
     * du nom serveur écrit par le viewer. Nom exact d'abord, puis l'unique
     * fichier du dossier préfixé par l'identifiant ; deux candidats = ambigu,
     * donc `null` (jamais deviné).
     */
    fun cachedFor(root: File, homeworkId: String, attachmentId: String, label: String): File? {
        val dir = dirFor(root, homeworkId)
        if (!dir.isDirectory) return null
        val exact = File(dir, fileName(attachmentId, label))
        if (exact.isFile && exact.length() in 1..MAX_BYTES.toLong()) return exact
        val id = clean(attachmentId, ID_MAX).ifEmpty { "piece" }
        val prefix = "$id-"
        val matches = dir.listFiles()?.filter { it.isFile && it.name.startsWith(prefix) }.orEmpty()
        val found = matches.singleOrNull() ?: return null
        return found.takeIf { it.length() in 1..MAX_BYTES.toLong() }
    }

    /**
     * Écrit un fichier téléchargé et renvoie le fichier écrit.
     *
     * `null` = la session a changé depuis [epoch] : rien n'est écrit, donc le
     * cache purgé ne ressuscite pas.
     */
    fun write(
        root: File,
        homeworkId: String,
        attachmentId: String,
        label: String,
        bytes: ByteArray,
        epoch: Long,
    ): File? {
        require(bytes.isNotEmpty() && bytes.size <= MAX_BYTES) { "pièce jointe hors borne" }
        val dir = dirFor(root, homeworkId)
        val file = File(dir, fileName(attachmentId, label))
        require(file.canonicalPath.startsWith(dir.canonicalPath + File.separator)) { "nom de pièce jointe refusé" }
        // Purge AVANT l'écriture : le fichier qu'on écrit est le plus récent, il
        // ne peut pas être effacé par la purge qui suit.
        prune(root, MAX_CACHED_FILES - 1)
        return SessionEpoch.writeIfCurrent(epoch) {
            dir.mkdirs()
            file.writeBytes(bytes)
            file
        }
    }

    fun prune(root: File, keep: Int): Int {
        val files = root.walkTopDown().filter { it.isFile }.sortedBy { it.lastModified() }.toList()
        var deleted = 0
        for (file in files.drop(keep)) if (file.delete()) deleted++
        return deleted
    }

    /**
     * Pièces jointes ET exports PDF : donnée du compte, purgée avec lui
     * (déconnexion, changement de compte, session morte).
     */
    fun purge(cacheRoot: File): Int {
        var deleted = 0
        for (name in listOf(ATTACHMENTS, EXPORTS)) {
            val dir = File(cacheRoot, name)
            deleted += dir.walkTopDown().count { it.isFile }
            dir.deleteRecursively()
        }
        return deleted
    }

    /**
     * Assainit un fragment de nom : ni séparateur, ni `..`, ni caractère
     * exotique ; accents conservés.
     */
    private fun clean(value: String, max: Int): String =
        value.trim()
            .map { if (it.isLetterOrDigit() || it == '-' || it == '_') it else '_' }
            .joinToString("")
            .trim('-', '_')
            .take(max)
}
