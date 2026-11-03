package fr.veryslopnynotes.data

import android.webkit.CookieManager
import android.webkit.WebStorage

/**
 * Les données de compte de la WebView : DOM storage (identifiants lus, l'état
 * de session React), cache HTTP et cookies. La coquille ne charge que des
 * assets locaux, donc le seul contenu de compte est le DOM storage ; cache et
 * cookies sont vidés aussi par prudence.
 *
 * Les lambdas existent pour que l'app efface SANS toucher au thème (deux clés
 * de la même origine vivent dans le même DOM storage) ; le job de fond, sans
 * instance de WebView, garde le balayage global.
 */
class WebViewAccountData(
    private val readState: () -> Boolean = { clearAll() },
    private val cache: () -> Boolean = { clearAll() },
) {
    /** `false` = le DOM storage est encore là : la purge de compte est incomplète. */
    fun clearReadState(): Boolean = try {
        readState()
    } catch (_: Exception) {
        false
    }

    /** Cache et formulaires de la WebView ; aucune donnée de compte servie ensuite. */
    fun clearCache(): Boolean = try {
        cache()
    } catch (_: Exception) {
        false
    }

    companion object {
        /** Cookies de l'origine locale : aucun identifiant de compte ne survit. */
        fun clearCookies(): Boolean = try {
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
            true
        } catch (_: Exception) {
            false
        }

        /** Balayage global : utilisé par le job de fond, sans instance de WebView. */
        fun clearAll(): Boolean {
            var cleared = true
            try {
                WebStorage.getInstance().deleteAllData()
            } catch (_: Exception) {
                cleared = false
            }
            if (!clearCookies()) cleared = false
            return cleared
        }
    }
}
