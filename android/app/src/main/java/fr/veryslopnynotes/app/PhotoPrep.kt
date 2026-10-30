package fr.veryslopnynotes.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
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
     * Budget de PIXELS DÉCLARÉS par l'en-tête (~24 Mpx, soit ~96 Mo en
     * ARGB_8888) : refusé AVANT tout décodage, sinon une bombe de
     * décompression (20000×20000 annoncés dans un petit fichier) ferait
     * allouer l'image entière avant d'être rejetée. Un appareil photo de
     * téléphone reste largement sous ce plafond.
     */
    const val MAX_PIXELS = 24_000_000

    /**
     * Décode, redresse (EXIF), redimensionne et ré-encode en JPEG.
     *
     * `null` = image illisible, hors budget ou impossible à ramener sous
     * [MAX_BYTES]. `OutOfMemoryError` suit la MÊME issue : sans ce filet,
     * l'erreur remontait au pont en « Erreur native » au lieu de « photo
     * illisible ou trop lourde ». Les erreurs de PROGRAMMATION, elles, ne sont
     * pas avalées.
     *
     * Le fichier source n'est jamais supprimé ici : l'appelant le fait dans
     * un `finally`, même en cas d'échec.
     */
    fun prepare(file: File): ByteArray? {
        if (!file.isFile || file.length() <= 0L) return null
        return try {
            prepareImage(file)
        } catch (_: OutOfMemoryError) {
            null
        }
    }

    private fun prepareImage(file: File): ByteArray? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        if (!withinPixelBudget(bounds.outWidth, bounds.outHeight)) return null

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
        val opaque = flatten(scaled)
        if (opaque !== scaled) scaled.recycle()
        return try {
            encode(opaque, JPEG_QUALITY) ?: encode(opaque, FALLBACK_QUALITY)
        } finally {
            opaque.recycle()
        }
    }

    /**
     * Le budget se lit sur les dimensions DÉCLARÉES (`inJustDecodeBounds`) :
     * aucune allocation n'est faite pour un fichier refusé.
     */
    fun withinPixelBudget(width: Int, height: Int): Boolean =
        width > 0 && height > 0 && width.toLong() * height.toLong() <= MAX_PIXELS

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

    /**
     * Aplatit la transparence sur du BLANC avant le JPEG : le compresseur JPEG
     * n'a pas de canal alpha, donc un PNG/WebP transparent (capture d'écran,
     * schéma, texte clair sur fond transparent) sortait avec des pixels NOIRS,
     * illisibles. Mêmes dimensions, même orientation. Un bitmap déjà opaque
     * est rendu tel quel : aucune allocation inutile sur une photo de cours.
     */
    private fun flatten(bitmap: Bitmap): Bitmap {
        if (!bitmap.hasAlpha()) return bitmap
        val flat = try {
            Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
        } catch (_: Exception) {
            return bitmap
        }
        return try {
            Canvas(flat).apply {
                drawColor(Color.WHITE)
                drawBitmap(bitmap, 0f, 0f, null)
            }
            flat
        } catch (_: Exception) {
            flat.recycle()
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
