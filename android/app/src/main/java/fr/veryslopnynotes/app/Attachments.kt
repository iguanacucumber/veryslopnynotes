package fr.veryslopnynotes.app

import android.content.Context
import fr.veryslopnynotes.core.AssignmentAttachment
import fr.veryslopnynotes.data.DownloadedFiles
import java.io.File

// Pièces jointes de devoirs : lues sur le client local, écrites dans le cache
// privé puis servies au viewer externe via FileProvider (I1 : aucune URL
// d'établissement, aucun chemin hors cache).
//
// Ces helpers vivaient dans `android/ui/Assignments.kt` ; ils restent ici avec
// le pont WebView qui les appelle (`VsnBridge.attachmentsOpen`), seul
// utilisateur depuis la suppression de Compose.
//
// Le TYPE MIME de la pièce jointe vit dans `AttachmentMime.kt` : le nom du
// fichier vient du serveur, donc le type qui en découle ne peut pas être
// exécutable (I6).
//
// Le NOM du fichier et la PURGE vivent dans `data/DownloadedFiles.kt` (#540) :
// le nom porte l'IDENTIFIANT de la pièce (deux pièces du même devoir portant
// le même libellé ne s'écrasent plus) et les fichiers téléchargés sont
// purgés avec le cache du compte.

/** Autorité FileProvider (manifeste app) : seul `cacheDir/attachments/` est partagé. */
const val ATTACHMENT_PROVIDER_AUTHORITY = "fr.veryslopnynotes.app.fileprovider"

/**
 * Octets lus sur le client local -> fichier du cache servi au viewer externe
 * via FileProvider.
 *
 * [epoch] est l'époque de session capturée AVANT le téléchargement : une
 * pièce jointe téléchargée pendant une déconnexion n'est pas écrite (le cache
 * purgé ne ressuscite pas). `null` = écriture refusée (session changée).
 */
fun writeAttachmentFile(
    context: Context,
    homeworkId: String,
    att: AssignmentAttachment,
    bytes: ByteArray,
    epoch: Long,
): File? = DownloadedFiles.write(
    File(context.cacheDir, DownloadedFiles.ATTACHMENTS),
    homeworkId,
    att.id,
    att.label,
    bytes,
    epoch,
)
