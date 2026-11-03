package fr.veryslopnynotes.app

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.util.TypedValue
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.IOException
import java.net.URLDecoder

// Coquille WebView locale (ADR-004) : l'UI React est embarquée dans
// `assets/web/`, servie sous une origine https interceptée (pas de `file://`).
// Aucun réseau : toute requête hors de cette origine est refusée (I1).

/** Origine servie par `shouldInterceptRequest` ; jamais résolue par le réseau. */
const val WEB_ASSET_HOST = "appassets.androidplatform.net"

/**
 * Zones sûres (px) que le web applique autour de son contenu. L'IME n'en fait
 * pas partie : il rétrécit le conteneur, pas la zone de sécurité.
 */
internal data class SafeArea(val left: Int, val top: Int, val right: Int, val bottom: Int)

private const val WEB_INDEX = "web/index.html"

// Le JS est seul juge du retour : dialogues, puis routes, puis accueil.
// Toute autre valeur que "true" (JS absent, page en cours de chargement) rend
// la main au système, qui termine l'activité sans piéger l'utilisateur.
private const val HARDWARE_BACK_JS = "(window.__vsnBack && window.__vsnBack()) === true"

// Les routes hash connues vivent dans `WebRouteState.kt` : un seul endroit de
// vérité, lu par la WebView, l'activité et les tests.

@SuppressLint("SetJavaScriptEnabled")
class NativeWebShell(
    private val activity: ComponentActivity,
    private val onRendererGone: (NativeWebShell) -> Unit = {},
) {

    private val splashColor: Int = windowBackground(activity)

    private var pageLoaded = false
    private var destroyed = false

    /** Dernière route CONNUE : la relire dans une WebView morte n'est pas garanti. */
    var route: String = HOME_ROUTE
        private set

    private var safeArea = SafeArea(0, 0, 0, 0)

    private val webView: WebView = WebView(activity).apply {
        // Identifiant STABLE (`res/values/ids.xml`) : l'état d'une vue est
        // indexé par son id, un id régénéré ne survivrait pas à la recréation.
        id = R.id.web_view
        setBackgroundColor(splashColor)
        alpha = 0f // fond natif (= splash) jusqu'au premier rendu
        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = false
            allowFileAccess = false
            allowContentAccess = false
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = false
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            loadsImagesAutomatically = true
            mediaPlaybackRequiresUserGesture = true
        }
        webViewClient = AssetClient(activity)
    }

    // Construit le pont APRÈS la WebView (il lui répond) et l'expose sous le
    // seul nom que le JS connaît. Aucune autre interface n'est ajoutée.
    private val bridge = VsnBridge(activity, webView, { setBackAvailable(it) }, ::applyTextZoom)

    // Désactivé par défaut : à l'accueil, le système garde la main et joue
    // l'animation prédictive. Le JS l'active dès qu'un dialogue ou une route
    // peut consommer la pression.
    private val backCallback = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() {
            webView.evaluateJavascript(HARDWARE_BACK_JS) { handled ->
                if (handled != "true") exitThroughSystemBack()
            }
        }
    }

    init {
        activity.window.setBackgroundDrawable(ColorDrawable(splashColor))
        webView.addJavascriptInterface(bridge, "VSN")
        activity.onBackPressedDispatcher.addCallback(activity, backCallback)
        // Avant `loadUrl` : le premier rendu a déjà la bonne taille de texte.
        applyTextZoom(bridge.textZoom())
    }

    val view: WebView get() = webView

    fun open(path: String?) {
        val safe = path?.takeIf { isServedRoute(it) } ?: HOME_ROUTE
        route = safe
        webView.loadUrl(urlFor(safe))
    }

    /** Deep link reçu APRÈS le chargement : simple changement de hash. */
    fun navigate(path: String) {
        if (!isServedRoute(path)) return
        route = path
        if (!pageLoaded) {
            open(path)
            return
        }
        val hash = if (path == "/") "#/" else "#$path"
        webView.evaluateJavascript(
            "location.hash = ${JSONObject.quote(hash)}",
            null,
        )
    }

    /** Le JS signale qu'une pression retour a une cible (dialogue ou route). */
    internal fun setBackAvailable(available: Boolean) {
        activity.runOnUiThread {
            if (backCallback.isEnabled != available) backCallback.isEnabled = available
        }
    }

    /**
     * Le web ne voit pas `WindowInsets` : le natif publie les zones sûres en
     * variables CSS. La dernière valeur est rejouée après chaque chargement,
     * sinon un rechargement (écran de secours) perdrait les encoches.
     */
    internal fun publishSafeArea(area: SafeArea) {
        safeArea = area
        if (pageLoaded) applySafeArea()
    }

    private fun applySafeArea() {
        // Valeurs entières d'insets, jamais du texte externe.
        val js = "(function(r){" +
            "r.style.setProperty('--native-safe-left','${safeArea.left}px');" +
            "r.style.setProperty('--native-safe-top','${safeArea.top}px');" +
            "r.style.setProperty('--native-safe-right','${safeArea.right}px');" +
            "r.style.setProperty('--native-safe-bottom','${safeArea.bottom}px');" +
            "})(document.documentElement)"
        webView.evaluateJavascript(js, null)
    }

    /** Applique le zoom textuel natif ; le web n'a aucun accès à ce réglage. */
    private fun applyTextZoom(zoom: Int) {
        activity.runOnUiThread {
            if (webView.settings.textZoom != zoom) webView.settings.textZoom = zoom
        }
    }

    /** Le JS n'a rien consommé : la pile système reprend la main et termine. */
    private fun exitThroughSystemBack() {
        backCallback.isEnabled = false
        activity.onBackPressedDispatcher.onBackPressed()
    }

    fun destroy() {
        if (destroyed) return
        destroyed = true
        pageLoaded = false
        backCallback.isEnabled = false
        backCallback.remove()
        bridge.close()
        webView.removeJavascriptInterface("VSN")
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.stopLoading()
        webView.destroy()
    }

    /**
     * L'activité quitte le premier plan : plus de rendu ni de timers JS.
     * `pauseTimers` est GLOBAL au process, d'où la paire stricte avec [resume].
     */
    fun pause() {
        webView.onPause()
        webView.pauseTimers()
    }

    /** Reprend après [pause], dans l'ordre inverse de la mise en pause. */
    fun resume() {
        webView.resumeTimers()
        webView.onResume()
    }

    /**
     * Pression mémoire : vide le cache RAM de la WebView. L'historique, les
     * formulaires et la page restent intacts ; seul le rechargeable part.
     */
    fun trimMemory() {
        webView.clearCache(false)
    }

    private fun urlFor(path: String): String {
        // Origine concaténée : le garde-fou I1 refuse un littéral d'hôte.
        val base = "https" + "://$WEB_ASSET_HOST/index.html"
        return if (path == "/") base else "$base#$path"
    }

    private fun onFirstPaint() {
        if (pageLoaded) return
        pageLoaded = true
        applySafeArea()
        webView.animate().alpha(1f).setDuration(180L).start()
        webView.evaluateJavascript("window.__vsnReady && window.__vsnReady()", null)
    }

    private inner class AssetClient(private val context: Context) : WebViewClient() {

        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest,
        ): WebResourceResponse? {
            val url = request.url ?: return denied()
            // data:/blob: restent locales à la WebView ; seules les requêtes
            // réseau sortantes sont refusées.
            if (url.scheme != "https" && url.scheme != "http") return null
            // Hors origine : refus net, jamais de repli réseau (CSP en plus).
            if (url.scheme != "https" || url.host != WEB_ASSET_HOST) return denied()
            val decoded = try {
                URLDecoder.decode(url.path ?: return notFound(), "UTF-8")
            } catch (_: Exception) {
                return notFound()
            }
            if (decoded.contains("..") || decoded.contains('\\') || decoded.contains("//")) {
                return notFound()
            }
            val asset = when {
                decoded == "/" || decoded == "/index.html" -> WEB_INDEX
                decoded.startsWith("/assets/") || decoded.startsWith("/fonts/") -> "web$decoded"
                else -> return notFound()
            }
            return try {
                val stream = context.assets.open(asset)
                WebResourceResponse(
                    mimeOfAsset(asset),
                    charsetOfAsset(asset),
                    200,
                    "OK",
                    mapOf("X-Content-Type-Options" to "nosniff"),
                    stream,
                )
            } catch (_: IOException) {
                notFound()
            }
        }

        // Le JS ne navigue jamais hors de l'origine locale ; tout le reste est
        // avalé (pas de navigateur externe, pas de tel:/intent:).
        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest,
        ): Boolean {
            val url = request.url ?: return true
            if (url.scheme != "https" || url.host != WEB_ASSET_HOST) return true
            val path = url.path ?: return true
            return !(path == "/" || path == "/index.html" ||
                path.startsWith("/assets/") || path.startsWith("/fonts/"))
        }

        override fun onPageFinished(view: WebView, url: String?) {
            super.onPageFinished(view, url)
            // Un rechargement repart d'un document neuf : les variables CSS du
            // natif n'y existent pas encore.
            applySafeArea()
            onFirstPaint()
        }

        /** Navigation par hash : `onPageFinished` ne rejoue pas, l'historique si. */
        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            super.doUpdateVisitedHistory(view, url, isReload)
            routePathFromUrl(url)?.let { route = it }
        }

        /**
         * Le rendu est mort : réutiliser cette WebView ferait planter le process.
         * On la détruit et on rend `true` (l'événement est traité). La recréation
         * est DIFFÉRÉE au clic « Réessayer » : recharger tout de suite
         * reproduirait la même mort en boucle.
         *
         * `onRenderProcessGone` existe depuis l'API 26, qui est le `minSdk` :
         * aucun repli de compatibilité n'est atteignable, donc aucun code mort.
         */
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            onRendererGone(this@NativeWebShell)
            return true
        }

        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceError,
        ) {
            if (!request.isForMainFrame) return
            // Assets absents (build Web non lancé) : message local, aucune
            // donnée, aucune URL affichée.
            val html = "<!doctype html><html lang=\"fr\"><meta charset=\"utf-8\">" +
                "<body style=\"font:16px sans-serif;padding:24px\">" +
                "<p>Interface web absente de cet APK.</p></body></html>"
            view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
            onFirstPaint()
        }
    }

    private fun notFound(): WebResourceResponse =
        WebResourceResponse(
            "text/plain",
            "UTF-8",
            404,
            "Not Found",
            mapOf("X-Content-Type-Options" to "nosniff"),
            ByteArrayInputStream("Not found".toByteArray(Charsets.UTF_8)),
        )

    private fun denied(): WebResourceResponse =
        WebResourceResponse(
            "text/plain",
            "UTF-8",
            403,
            "Forbidden",
            mapOf("X-Content-Type-Options" to "nosniff"),
            ByteArrayInputStream("Forbidden".toByteArray(Charsets.UTF_8)),
        )

    companion object {
        @Suppress("DEPRECATION")
        private fun windowBackground(context: Context): Int {
            val value = TypedValue()
            return if (context.theme.resolveAttribute(android.R.attr.colorBackground, value, true) &&
                value.type >= TypedValue.TYPE_FIRST_COLOR_INT &&
                value.type <= TypedValue.TYPE_LAST_COLOR_INT
            ) {
                value.data
            } else {
                Color.BLACK
            }
        }

        // Petite table : aucune dépendance MIME, aucune devinette réseau.
        private fun mimeOfAsset(path: String): String =
            when (path.substringAfterLast('.', "").lowercase()) {
                "html" -> "text/html"
                "js", "mjs" -> "application/javascript"
                "css" -> "text/css"
                "json" -> "application/json"
                "map" -> "application/json"
                "svg" -> "image/svg+xml"
                "png" -> "image/png"
                "jpg", "jpeg" -> "image/jpeg"
                "webp" -> "image/webp"
                "gif" -> "image/gif"
                "ico" -> "image/x-icon"
                "woff" -> "font/woff"
                "woff2" -> "font/woff2"
                "ttf" -> "font/ttf"
                "otf" -> "font/otf"
                "txt" -> "text/plain"
                else -> "application/octet-stream"
            }

        private fun charsetOfAsset(path: String): String? =
            when (path.substringAfterLast('.', "").lowercase()) {
                "html", "js", "mjs", "css", "json", "map", "svg", "txt" -> "UTF-8"
                else -> null
            }
    }
}
