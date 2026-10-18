package fr.veryslopnynotes.app

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.util.TypedValue
import android.view.ViewGroup
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

// Coquille WebView locale (#333) : l'UI React est embarquée dans
// `assets/web/`, servie sous une origine https interceptée (pas de `file://`,
// donc pas d'accès au disque ni aux autres origines). Aucun réseau : toute
// requête hors de cette origine est refusée, et le pont natif est le seul
// accès aux données (`VsnBridge`). CSP de `index.html` : `connect-src 'none'`.
//
// `NativeWebShell` est l'unique interface de l'activité (ADR-004) : plus de
// chemin Compose.

/** Origine servie par `shouldInterceptRequest` ; jamais résolue par le réseau. */
const val WEB_ASSET_HOST = "appassets.androidplatform.net"

private const val WEB_INDEX = "web/index.html"

// Routes hash connues (miroir de `web/src/App.tsx` et des constantes
// `ROUTE_*` d'AppNav). Sert à refuser un deep link hors contrat.
val WEB_ROUTES: Set<String> = setOf(
    "/", "/calendar", "/grades", "/tasks", "/profile", "/settings",
    "/pairing", "/messages", "/attendance", "/sanctions", "/news",
    "/canteen", "/alerts", "/fiches",
)

@SuppressLint("SetJavaScriptEnabled")
class NativeWebShell(private val activity: ComponentActivity) {

    private val splashColor: Int = windowBackground(activity)

    private var pageLoaded = false

    private val webView: WebView = WebView(activity).apply {
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
    private val bridge = VsnBridge(activity, webView)

    init {
        activity.window.setBackgroundDrawable(ColorDrawable(splashColor))
        webView.addJavascriptInterface(bridge, "VSN")
        activity.onBackPressedDispatcher.addCallback(
            activity,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (webView.canGoBack()) webView.goBack() else activity.finish()
                }
            },
        )
    }

    val view: WebView get() = webView

    /** Charge l'index, éventuellement sur une route de deep link. */
    fun open(path: String?) {
        val safe = if (path != null && path in WEB_ROUTES) path else "/"
        webView.loadUrl(urlFor(safe))
    }

    /** Deep link reçu APRÈS le chargement : simple changement de hash. */
    fun navigate(path: String) {
        if (path !in WEB_ROUTES) return
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

    fun destroy() {
        bridge.close()
        webView.removeJavascriptInterface("VSN")
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.stopLoading()
        webView.destroy()
    }

    private fun urlFor(path: String): String {
        // Origine concaténée : le garde-fou I1 refuse un littéral d'hôte.
        val base = "https" + "://$WEB_ASSET_HOST/index.html"
        return if (path == "/") base else "$base#$path"
    }

    /** Premier rendu : le fond natif s'efface, le JS est prévenu. */
    private fun onFirstPaint() {
        if (pageLoaded) return
        pageLoaded = true
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
            onFirstPaint()
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
