package fr.veryslopnynotes.app

// Politique de compatibilité : Android 8.0 (API 26) embarque une WebView
// système mise à jour par le Play Store. Fichier PUR (aucun import Android) :
// le harnais de parité l'exécute, et l'activité ne fait que lui passer le nom
// de version du paquet WebView installé.

const val MIN_ANDROID_API = 26
const val MIN_WEBVIEW_MAJOR = 100

const val WEBVIEW_SUPPORT_STATEMENT =
    "VerySlopyNyNotes demande Android 8.0 (API 26) ou plus et une WebView " +
        "système Chromium $MIN_WEBVIEW_MAJOR ou plus récente."

sealed interface WebViewSupport {
    data object Supported : WebViewSupport
    data class Unsupported(val installedMajor: Int?) : WebViewSupport
}

/** Version majeure du premier nombre : « 120.0.6099.230 » et « M120 » -> 120. */
fun webViewMajor(versionName: String?): Int? =
    versionName?.let { Regex("""\d+""").find(it)?.value?.toIntOrNull() }

/** Une version absente ou illisible est refusée : mieux qu'un crash au chargement. */
fun webViewSupport(versionName: String?): WebViewSupport {
    val major = webViewMajor(versionName)
    return if (major != null && major >= MIN_WEBVIEW_MAJOR) {
        WebViewSupport.Supported
    } else {
        WebViewSupport.Unsupported(major)
    }
}

fun unsupportedWebViewMessage(installedMajor: Int?): String {
    val detected = installedMajor?.let { "Chromium $it" } ?: "version inconnue"
    return "$WEBVIEW_SUPPORT_STATEMENT Version détectée : $detected. " +
        "Mets à jour Android System WebView (ou Chrome) dans le Play Store, puis relance l'app."
}
