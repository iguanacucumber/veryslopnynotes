package fr.veryslopnynotes.app

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID

/**
 * Capture d'une photo de cours (#587) : appareil photo ou galerie.
 *
 * La photo est écrite dans `cacheDir/photos/` (privé, jamais sauvegardé) et
 * n'est jamais exposée au JS. L'appelant la lit, la ré-encode, puis la
 * supprime. Un fichier resté d'un crash est purgé au démarrage.
 *
 * Un seul capture en vol : deux appels simultanés retourneraient deux URIs
 * pour une seule activité de résultat.
 */
class PhotoCapture(private val activity: ComponentActivity) {
    sealed interface Result {
        data class Ok(val file: File) : Result
        data object Cancelled : Result
        data class Error(val message: String) : Result
    }

    private var pending: ((Result) -> Unit)? = null
    private var cameraFile: File? = null

    private val dir: File by lazy { File(activity.cacheDir, "photos").apply { mkdirs() } }

    private val takePicture = activity.registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val file = cameraFile
        cameraFile = null
        if (!ok || file == null) {
            file?.delete()
            finish(Result.Cancelled)
        } else {
            finish(Result.Ok(file))
        }
    }

    private val gallery = activity.registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) {
            finish(Result.Cancelled)
            return@registerForActivityResult
        }
        val copied = try {
            copyToCache(uri)
        } catch (_: Exception) {
            null
        }
        if (copied == null) {
            finish(Result.Error("Image illisible : choisis une autre photo."))
        } else {
            finish(Result.Ok(copied))
        }
    }

    private val permission = activity.registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            launchCamera()
        } else {
            finish(Result.Error("Appareil photo refusé : choisis une image dans la galerie."))
        }
    }

    init {
        purgeStale()
    }

    /** Ouvre la source demandée. Le callback arrive sur le thread principal. */
    fun capture(source: String, onDone: (Result) -> Unit) {
        if (pending != null) {
            onDone(Result.Error("Une photo est déjà en cours."))
            return
        }
        if (activity.isFinishing || activity.isDestroyed) {
            onDone(Result.Error("Photo indisponible : l'application se ferme."))
            return
        }
        pending = onDone
        try {
            activity.runOnUiThread {
                when (source) {
                    "gallery" -> openGallery()
                    else -> requestCamera()
                }
            }
        } catch (_: Exception) {
            finish(Result.Error("Photo indisponible : réessaie dans un instant."))
        }
    }

    /** Nettoie le fichier temporaire (appelé par le pont après lecture). */
    fun discard(file: File?) {
        try {
            file?.delete()
        } catch (_: Exception) {
            // best-effort
        }
    }

    /** Abandon explicite (fermeture de la WebView). */
    fun cancel() {
        cameraFile?.delete()
        cameraFile = null
        finish(Result.Cancelled)
    }

    private fun requestCamera() {
        val granted = ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) launchCamera() else permission.launch(Manifest.permission.CAMERA)
    }

    private fun launchCamera() {
        // La déconnexion purge `cacheDir/photos` ENTIÈREMENT (donnée du compte,
        // I4) : le `lazy` ne repasse jamais et son dossier a disparu. Sans ce
        // rappel, l'appareil photo échouerait en silence jusqu'au redémarrage.
        dir.mkdirs()
        val file = File(dir, "capture-" + UUID.randomUUID().toString().replace("-", "") + ".jpg")
        val uri = try {
            FileProvider.getUriForFile(activity, ATTACHMENT_PROVIDER_AUTHORITY, file)
        } catch (_: Exception) {
            finish(Result.Error("Appareil photo indisponible : choisis une image dans la galerie."))
            return
        }
        cameraFile = file
        try {
            takePicture.launch(uri)
        } catch (_: ActivityNotFoundException) {
            file.delete()
            cameraFile = null
            finish(Result.Error("Aucune application appareil photo : choisis une image dans la galerie."))
        } catch (_: Exception) {
            file.delete()
            cameraFile = null
            finish(Result.Error("Appareil photo indisponible : choisis une image dans la galerie."))
        }
    }

    private fun openGallery() {
        try {
            gallery.launch("image/*")
        } catch (_: Exception) {
            finish(Result.Error("Galerie indisponible : réessaie dans un instant."))
        }
    }

    /**
     * Copie bornée (10 Mo lus au maximum) : une URI peut venir d'un
     * fournisseur tiers.
     *
     * `finally` UNIQUE : tant que la cible n'est pas déclarée UTILISABLE
     * (exception, flux vide, resolver nul, dépassement), elle est supprimée.
     * L'original porte l'EXIF/GPS et ne doit pas survivre dans
     * `cacheDir/photos/` jusqu'à la prochaine création d'activité (I32).
     */
    private fun copyToCache(uri: Uri): File? {
        // Même raison que `launchCamera` : le dossier purge à la déconnexion.
        dir.mkdirs()
        val target = File(dir, "gallery-" + UUID.randomUUID().toString().replace("-", "") + ".jpg")
        var usable = false
        return try {
            val input = activity.contentResolver.openInputStream(uri) ?: return null
            input.use { stream ->
                target.outputStream().use { out ->
                    val buffer = ByteArray(16 * 1024)
                    var total = 0L
                    while (true) {
                        val read = stream.read(buffer)
                        if (read < 0) break
                        total += read
                        if (total > MAX_GALLERY_BYTES) return null
                        out.write(buffer, 0, read)
                    }
                }
            }
            usable = target.length() > 0
            if (usable) target else null
        } finally {
            if (!usable) target.delete()
        }
    }

    private fun finish(result: Result) {
        val callback = pending
        pending = null
        if (callback != null) callback(result) else {
            // Personne n'attend (activité recréée, appel annulé) : pas de fuite.
            if (result is Result.Ok) discard(result.file)
        }
    }

    private fun purgeStale() {
        try {
            dir.listFiles()?.forEach { it.delete() }
        } catch (_: Exception) {
            // Le cache est jetable.
        }
    }

    companion object {
        /** Lecture maximale depuis la galerie avant ré-encodage. */
        const val MAX_GALLERY_BYTES = 10L * 1024L * 1024L
    }
}
