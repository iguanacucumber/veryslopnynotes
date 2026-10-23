package fr.veryslopnynotes.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Prépare une photo pour le fournisseur vision (#587).
 *
 * Le ré-encodage est la barrière de sécurité : il SUPPRIME les métadonnées
 * (GPS, appareil, date) et ne laisse qu'un JPEG borné. Une photo refusée
 * (illisible, trop lourde) ne part jamais.
 *
 * Toutes les bornes sont des constantes : le test de source les vérifie, et
 * le fournisseur ne peut pas recevoir une image hors budget.
 */
object PhotoPrep {
    const val MAX_DIMENSION = 1600
    const val MAX_BYTES = 2_000_000
    const val JPEG_QUALITY = 80
    const val FALLBACK_QUALITY = 60

    /**
     * Décode, redresse (EXIF), redimensionne et ré-encode en JPEG.
     *
     * `null` = image illisible ou impossible à ramener sous [MAX_BYTES].
     * Le fichier source n'est jamais supprimé ici : l'appelant le fait dans
     * un `finally`, même en cas d'échec.
     */
    fun prepare(file: File): ByteArray? {
        if (!file.isFile || file.length() <= 0L) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        val options = BitmapFactory.Options().apply {
            inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight)
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val decoded = try {
            BitmapFactory.decodeFile(file.absolutePath, options)
        } catch (_: Exception) {
            null
        } ?: return null
        if (decoded.width <= 0 || decoded.height <= 0) {
            decoded.recycle()
            return null
        }

        val rotated = try {
            rotate(decoded, orientationOf(file))
        } catch (_: Exception) {
            decoded
        }
        if (rotated !== decoded) decoded.recycle()
        val scaled = scaleDown(rotated, MAX_DIMENSION)
        if (scaled !== rotated) rotated.recycle()
        return try {
            encode(scaled, JPEG_QUALITY) ?: encode(scaled, FALLBACK_QUALITY)
        } finally {
            scaled.recycle()
        }
    }

    /** Facteur d'échantillonnage puissance de deux : jamais un bitmap inutilement énorme. */
    fun sampleSize(width: Int, height: Int): Int {
        var sample = 1
        var w = width
        var h = height
        while (w / 2 >= MAX_DIMENSION || h / 2 >= MAX_DIMENSION) {
            w /= 2
            h /= 2
            sample *= 2
        }
        return sample
    }

    private fun orientationOf(file: File): Int = try {
        ExifInterface(file.absolutePath).getAttributeInt(
            ExifInterface.TAG_ORIENTATION,
            ExifInterface.ORIENTATION_NORMAL,
        )
    } catch (_: Exception) {
        ExifInterface.ORIENTATION_NORMAL
    }

    private fun rotate(bitmap: Bitmap, orientation: Int): Bitmap {
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.postRotate(90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.postRotate(270f)
                matrix.postScale(-1f, 1f)
            }
            else -> return bitmap
        }
        return try {
            Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        } catch (_: Exception) {
            bitmap
        }
    }

    private fun scaleDown(bitmap: Bitmap, max: Int): Bitmap {
        val longest = maxOf(bitmap.width, bitmap.height)
        if (longest <= max) return bitmap
        val ratio = max.toFloat() / longest.toFloat()
        val width = (bitmap.width * ratio).toInt().coerceAtLeast(1)
        val height = (bitmap.height * ratio).toInt().coerceAtLeast(1)
        return try {
            Bitmap.createScaledBitmap(bitmap, width, height, true)
        } catch (_: Exception) {
            bitmap
        }
    }

    private fun encode(bitmap: Bitmap, quality: Int): ByteArray? {
        val out = ByteArrayOutputStream()
        return try {
            if (!bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)) return null
            val bytes = out.toByteArray()
            if (bytes.isEmpty() || bytes.size > MAX_BYTES) null else bytes
        } catch (_: Exception) {
            null
        } finally {
            out.close()
        }
    }
}
