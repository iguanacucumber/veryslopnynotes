package fr.veryslopnynotes.data

import java.io.File

/**
 * #540 : les pièces jointes téléchargées ne doivent ni se CHEVAUCHER ni
 * s'ACCUMULER.
 *
 * CHEVAUCHER : le fichier était nommé d'après le seul LIBELLÉ (`consigne.pdf`),
 * donc deux pièces distinctes du même devoir visaient le MÊME chemin — la
 * seconde écrasait la première et le viewer ouvrait le mauvais document. Le
 * nom porte maintenant l'IDENTIFIANT de la pièce : deux pièces distinctes ne
 * peuvent pas cohabiter au même chemin.
 *
 * S'ACCUMULER : rien ne supprimait ces fichiers (jusqu'à 10 Mo pièce). Le
 * cache des téléchargements est donc BORNÉ (les plus anciens partent) et
 * PURGÉ avec le cache du compte (déconnexion, changement de compte, session
 * morte) : un fichier téléchargé est la DONNÉE DU COMPTE, comme le cache.
 *
 * L'écriture passe par la garde d'époque (#404) : une pièce téléchargée
 * pendant une déconnexion n'est PAS écrite, donc le cache purgé ne ressuscite
 * pas.
 *
 * Fichier PUR (`java.io` seul, aucun import Android) : le harnais de parité
 * le compile et le REJOUE (`tests/unit/downloaded-files.test.ts`).
 */
object DownloadedFiles {
    /** Sous-dossier du cache qui porte les pièces jointes des devoirs. */
    const val ATTACHMENTS = "attachments"

    /** Sous-dossier du cache qui porte les exports PDF des fiches. */
    const val EXPORTS = "exports"

    /** Nombre de fichiers conservés dans le cache des téléchargements. */
    const val MAX_CACHED_FILES = 24

    /** Borne d'ouverture : une pièce jointe ne dépasse pas quelques Mo. */
    const val MAX_BYTES = 10 * 1024 * 1024

    /** Longueur max de l'identifiant dans le nom de fichier. */
    private const val ID_MAX = 32

    /** Longueur max du libellé (sans extension) dans le nom de fichier. */
    private const val LABEL_MAX = 32

    /** Longueur max de l'extension conservée. */
    private const val EXT_MAX = 10

    /**
     * Nom de fichier d'une pièce jointe : l'IDENTIFIANT d'abord, puis le
     * libellé (`42-consigne.pdf`).
     *
     * L'identifiant est ce qui distingue deux PIÈCES : deux pièces du même
     * devoir qui portent le MÊME libellé n'ont pas le même identifiant, donc
     * pas le même fichier. Il est assaini comme le libellé (jamais de
     * séparateur, jamais de `..`) et le nom total est borné (≤ 76 caractères,
     * donc ≤ 228 octets : sous la borne de 255 du système de fichiers).
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
     * Dossier d'un devoir : `<racine>/<devoir>/`. Le dossier est ASSAINI (jamais
     * de séparateur) : le chemin reste sous la racine (I1).
     */
    fun dirFor(root: File, homeworkId: String): File =
        File(root, clean(homeworkId, 64).ifEmpty { "devoir" })

    /**
     * Fichier DÉJÀ téléchargé d'une pièce jointe, ou `null`. Sert de cache au
     * contexte IA (#631) : une pièce déjà ouverte par le viewer n'est pas
     * re-téléchargée.
     *
     * Deux noms sont possibles pour la MÊME pièce : celui dérivé de son
     * libellé de payload, et celui dérivé du nom SERVEUR écrit par le viewer.
     * On essaie le nom exact, puis on accepte l'unique fichier du dossier dont
     * le préfixe est l'identifiant de la pièce ; deux candidats = ambigu, donc
     * `null` (le fichier sera re-téléchargé sous le nom exact, jamais deviné).
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
     * `null` = écriture REFUSÉE : la session a changé depuis [epoch] (une
     * déconnexion pendant le téléchargement), donc le cache purgé ne
     * ressuscite pas.
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
        // Le cache des téléchargements est BORNÉ : les fichiers les plus anciens
        // partent AVANT l'écriture (le fichier qu'on écrit est le plus récent,
        // il ne peut pas être effacé par la purge qui suit).
        prune(root, MAX_CACHED_FILES - 1)
        return SessionEpoch.writeIfCurrent(epoch) {
            dir.mkdirs()
            file.writeBytes(bytes)
            file
        }
    }

    /**
     * Ne garde que les [keep] fichiers les plus récents : les plus anciens
     * partent. Le cache des téléchargements ne grossit donc pas sans borne.
     */
    fun prune(root: File, keep: Int): Int {
        val files = root.walkTopDown().filter { it.isFile }.sortedBy { it.lastModified() }.toList()
        var deleted = 0
        for (file in files.drop(keep)) if (file.delete()) deleted++
        return deleted
    }

    /**
     * Purge les fichiers téléchargés (pièces jointes ET exports PDF) : ils
     * sont la donnée du compte, ils partent avec lui (déconnexion, changement
     * de compte, session morte).
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
     * exotique. Les lettres accentuées sont conservées (le nom reste lisible) ;
     * le point et les séparateurs ne le sont pas.
     */
    private fun clean(value: String, max: Int): String =
        value.trim()
            .map { if (it.isLetterOrDigit() || it == '-' || it == '_') it else '_' }
            .joinToString("")
            .trim('-', '_')
            .take(max)
}
