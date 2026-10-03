package fr.veryslopnynotes.ui

import android.content.Context
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/**
 * Scan du QR affiché par l'application de l'établissement (#122).
 *
 * Google Code Scanner : le module de scan est fourni par Play Services, donc
 * AUCUNE permission caméra à déclarer au manifeste et aucun aperçu à maintenir
 * (l'écart avec CameraX + aperçu : ~120 lignes et une permission de plus pour le
 * même résultat). Le champ de collage reste le repli : un téléphone sans Play
 * Services, un refus, ou un module pas encore téléchargé ne bloque personne.
 *
 * `onResult(null)` = rien de scanné (annulation, échec, QR non lisible par le
 * service). L'appelant ne fait alors rien d'autre : l'utilisateur est toujours
 * au même endroit, avec son collage.
 */
fun scanQrCode(
    context: Context,
    onResult: (String?) -> Unit,
) {
    val options = GmsBarcodeScannerOptions.Builder()
        // Le QR de l'établissement est un code texte (login + jeton), pas une
        // carte de visite : on ne demande QUE ce format, ça réduit les chances
        // de capturer la mauvaise chose et le travail du service.
        .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
        .enableAutoZoom()
        .build()
    GmsBarcodeScanning.getClient(context, options)
        .startScan()
        .addOnSuccessListener { barcode -> onResult(barcode.rawValue?.takeIf { it.isNotBlank() }) }
        .addOnCanceledListener { onResult(null) }
        .addOnFailureListener { onResult(null) }
}