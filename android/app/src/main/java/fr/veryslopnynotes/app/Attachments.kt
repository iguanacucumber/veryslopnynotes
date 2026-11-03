package fr.veryslopnynotes.app

import android.content.Context
import fr.veryslopnynotes.core.AssignmentAttachment
import fr.veryslopnynotes.data.AttachmentData
import fr.veryslopnynotes.data.DownloadedFiles
import java.io.File

// Pièces jointes : lues sur le client local, écrites dans le cache privé, servies
// au viewer externe via FileProvider (I1 : aucune URL d'établissement, aucun
// chemin hors cache). Le type MIME (AttachmentMime.kt) découle d'un nom fourni
// par le serveur : il ne peut pas être exécutable (I6). Le nom et la purge vivent
// dans `data/DownloadedFiles.kt`.

/**
 * [epoch] est l'époque de session capturée AVANT le téléchargement : une pièce
 * jointe téléchargée pendant une déconnexion n'est pas écrite.
 *
 * Le flux est déjà sur disque ([AttachmentData.file]) : `adopt` le déplace
 * sous la garde d'époque sans le relire en mémoire, et le temporaire part
 * dans tous les cas.
 */
fun writeAttachmentFile(
    context: Context,
    homeworkId: String,
    att: AssignmentAttachment,
    data: AttachmentData,
    epoch: Long,
): File? = try {
    DownloadedFiles.adopt(
        File(context.cacheDir, DownloadedFiles.ATTACHMENTS),
        homeworkId,
        att.id,
        att.label,
        data.file,
        epoch,
    )
} finally {
    data.file.delete()
}
