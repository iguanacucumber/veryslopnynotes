package fr.veryslopnynotes.app

import android.content.Context
import fr.veryslopnynotes.core.AssignmentAttachment
import java.io.File

// Pièces jointes de devoirs : lues sur le client local, écrites dans le cache
// privé puis servies au viewer externe via FileProvider (I1 : aucune URL
// d'établissement, aucun chemin hors cache).
//
// Ces helpers vivaient dans `android/ui/Assignments.kt` ; ils restent ici avec
// le pont WebView qui les appelle (`VsnBridge.attachmentsOpen`), seul
// utilisateur depuis la suppression de Compose.

/** Autorité FileProvider (manifeste app) : seul `cacheDir/attachments/` est partagé. */
const val ATTACHMENT_PROVIDER_AUTHORITY = "fr.veryslopnynotes.app.fileprovider"

// Borne d'ouverture : une PJ de devoir ne dépasse pas quelques Mo. Au-delà =
// refus (pas de OOM ni de cache qui explose), l'UI affiche son repli.
private const val ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

/**
 * Octets lus sur le client local -> fichier du cache servi au viewer externe
 * via FileProvider. Noms assainis (pas de `..`, pas de séparateur) : le chemin
 * reste sous `attachments/<devoir>/`, jamais d'écriture ailleurs (I1).
 */
fun writeAttachmentFile(context: Context, homeworkId: String, att: AssignmentAttachment, bytes: ByteArray): File {
    require(bytes.isNotEmpty() && bytes.size <= ATTACHMENT_MAX_BYTES) { "pièce jointe hors borne" }
    val safeId = homeworkId.trim().take(64).map { if (it.isLetterOrDigit() || it == '-' || it == '_') it else '_' }.joinToString("").ifEmpty { "devoir" }
    val rawName = att.label.trim().substringAfterLast('/').substringAfterLast('\\').take(200)
    val safeName = rawName.map { if (it.isLetterOrDigit() || it == '-' || it == '_' || it == '.') it else '_' }.joinToString("").trim('.', '_').ifEmpty { "piece-jointe" }
    val dir = File(File(context.cacheDir, "attachments"), safeId)
    dir.mkdirs()
    val file = File(dir, safeName)
    require(file.canonicalPath.startsWith(dir.canonicalPath + File.separator)) { "nom de pièce jointe refusé" }
    file.writeBytes(bytes)
    return file
}

/** Type MIME depuis l'extension, défaut binaire. */
fun mimeOf(name: String): String = when (name.trim().substringAfterLast('.', "").lowercase()) {
    "pdf" -> "application/pdf"
    "jpg", "jpeg" -> "image/jpeg"
    "png" -> "image/png"
    "gif" -> "image/gif"
    "webp" -> "image/webp"
    "txt" -> "text/plain"
    "html", "htm" -> "text/html"
    "mp4" -> "video/mp4"
    "mp3" -> "audio/mpeg"
    else -> "application/octet-stream"
}
