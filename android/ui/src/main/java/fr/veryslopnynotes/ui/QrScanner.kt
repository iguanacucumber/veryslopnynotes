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
 */
@Composable
fun rememberQrScanner(onResult: (String?) -> Unit): () -> Unit {
    val launcher = rememberLauncherForActivityResult(ScanContract()) { result ->
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
