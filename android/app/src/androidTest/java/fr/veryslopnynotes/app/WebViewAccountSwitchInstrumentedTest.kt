package fr.veryslopnynotes.app

import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import fr.veryslopnynotes.data.WebViewAccountData
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Bascule de compte sur une VRAIE WebView (#894) : le DOM storage de l'ancien
 * compte (actualités lues, données quelconques, sessionStorage) et ses cookies
 * partent ; le thème et la palette restent. Le script et la purge de cookies
 * sont ceux de la production, pas des doubles.
 */
@RunWith(AndroidJUnit4::class)
class WebViewAccountSwitchInstrumentedTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private lateinit var webView: WebView
    private lateinit var pageLoaded: CountDownLatch

    /** Origine locale de la coquille : celle que la purge réelle atteint. */
    private val origin = "https" + "://" + WEB_ASSET_HOST + "/index.html"

    @Before
    fun setUp() {
        pageLoaded = CountDownLatch(1)
        instrumentation.runOnMainSync {
            webView = WebView(instrumentation.targetContext).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView?, url: String?) {
                        pageLoaded.countDown()
                    }
                }
                loadDataWithBaseURL(
                    origin,
                    "<!doctype html><html lang=\"fr\"><body>bascule</body></html>",
                    "text/html",
                    "UTF-8",
                    null,
                )
            }
        }
        assertTrue("page de test non chargée", pageLoaded.await(10, TimeUnit.SECONDS))
    }

    @After
    fun tearDown() {
        instrumentation.runOnMainSync { webView.destroy() }
        WebViewAccountData.clearAll()
        WebViewAccountData.clearCookies()
    }

    @Test
    fun bascule_ne_laisse_ni_lecture_ni_cookie_et_garde_le_theme() {
        seedOldAccount()

        // Ce que la purge de compte exécute pour les deux stores WebView.
        assertEquals("ok", evaluate(WebViewAccountStorage.clearScript())?.trim('"'))
        assertTrue(WebViewAccountData.clearCookies())

        assertEquals("DARK", evaluate("localStorage.getItem('vsn:theme')")?.trim('"'))
        assertEquals("aero", evaluate("localStorage.getItem('vsn:scheme')")?.trim('"'))
        assertNull(
            "les actualités lues du compte précédent survivent",
            evaluate("localStorage.getItem('vsn:news:read')")?.takeIf { it != "null" },
        )
        assertNull(
            "une donnée de compte non nommée survit",
            evaluate("localStorage.getItem('vsn:account:autre')")?.takeIf { it != "null" },
        )
        assertNull(
            "le sessionStorage survit",
            evaluate("sessionStorage.getItem('vsn:temp')")?.takeIf { it != "null" },
        )
        assertTrue("cookie du compte précédent encore lisible", waitForCookieCleared())

        // Le compte suivant relit un DOM storage vide, pas celui du précédent.
        assertEquals("0", evaluate("localStorage.getItem('vsn:news:read') === null ? '0' : '1'")?.trim('"'))
    }

    private fun seedOldAccount() {
        evaluate(
            "localStorage.setItem('vsn:theme','DARK');" +
                "localStorage.setItem('vsn:scheme','aero');" +
                "localStorage.setItem('vsn:news:read',JSON.stringify(['n1','n2']));" +
                "localStorage.setItem('vsn:account:autre','donnée');" +
                "sessionStorage.setItem('vsn:temp','en cours');" +
                "'ok'",
        )
        CookieManager.getInstance().setCookie(origin, "vsn_session=ancien; Path=/")
        CookieManager.getInstance().flush()
        assertTrue("cookie de test non posé", waitForCookie { !it.isNullOrEmpty() })
    }

    /** Évalue hors du fil UI puis attend le callback : jamais de deadlock. */
    private fun evaluate(js: String): String? {
        val done = CountDownLatch(1)
        var result: String? = null
        instrumentation.runOnMainSync {
            webView.evaluateJavascript(js) { value ->
                result = value
                done.countDown()
            }
        }
        assertTrue("JavaScript non rendu", done.await(5, TimeUnit.SECONDS))
        return result
    }

    private fun waitForCookieCleared(): Boolean = waitForCookie { it.isNullOrEmpty() }

    private fun waitForCookie(predicate: (String?) -> Boolean): Boolean {
        val deadline = System.currentTimeMillis() + 5_000
        while (System.currentTimeMillis() < deadline) {
            if (predicate(CookieManager.getInstance().getCookie(origin))) return true
            Thread.sleep(50)
        }
        return false
    }
}
