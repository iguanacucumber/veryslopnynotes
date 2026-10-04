package fr.veryslopnynotes.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

/**
 * Scan du QR affiché par l'application de l'établissement (#127).
 *
 * zxing-android-embedded : le décodeur est DANS l'APK et l'activité de scan
 * demande elle-même la permission CAMERA. Donc ça marche partout — téléphone sans
 * Google Play Services, émulateur — ce que ne faisait PAS le Google Code Scanner
 * de #122 : son module est téléchargé à la demande par un service absent, et son
 * échec revenait en `null` sans rien afficher, donc un bouton inerte. Le champ de
 * collage, lui, ne dépend d'aucune caméra et n'a jamais disparu.
 *
 * `onResult(null)` = rien de lu : annulation, permission refusée, ou QR que le
 * décodeur n'a pas su lire. L'appelant ne remplace donc rien et affiche une
 * phrase actionnable, au lieu du silence.
 *
 * #145 : un QR lu VIBRE (le geste a réussi, hors du champ de vision : l'écran
 * était face au mur pendant le scan). Un échec ne vibre PAS comme une réussite —
 * Compose 1.6.8 n'a pas `HapticFeedbackType.Reject` (1.7.0) — donc c'est le
 * message d'erreur de l'appelant, en couleur d'erreur, qui fait la différence.
 */
@Composable
fun rememberQrScanner(onResult: (String?) -> Unit): () -> Unit {
    // Capturé ICI et non dans le callback : l'activité de scan rend plus tard, et
    // le retour physique a besoin du `LocalHapticFeedback` de la composition.
    val haptics = rememberPapHaptics()
    val launcher = rememberLauncherForActivityResult(ScanContract()) { result ->
        if (result.contents?.isNotBlank() == true) haptics.confirm()
        onResult(result.contents?.takeIf { it.isNotBlank() })
    }
    return remember(launcher) {
        {
            launcher.launch(
                ScanOptions()
                    // Le QR de l'établissement est un code texte (login + jeton),
                    // pas une carte de visite : on ne demande QUE ce format, ça
                    // réduit le travail du décodeur et le risque de capturer la
                    // mauvaise chose.
                    .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                    .setPrompt("QR de l'application de ton établissement")
                    .setBeepEnabled(false)
                    // Le QR est dense : on le lit en portrait, comme l'écran qui
                    // l'affiche. Verrouiller en paysage (défaut de la lib) le
                    // ferait pivoter sous le nez de l'utilisateur.
                    .setOrientationLocked(false),
            )
        }
    }
}
