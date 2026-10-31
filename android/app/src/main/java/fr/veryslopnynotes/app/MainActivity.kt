package fr.veryslopnynotes.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.updatePadding
import fr.veryslopnynotes.data.PeriodicSyncWorker

// Hôte natif de l'interface React (ADR-004) : `NativeWebShell` sert les assets
// locaux de `web/`. Aucun appel réseau ici (I1) et aucun hôte tiers (CSP).
class MainActivity : ComponentActivity() {
    private var webShell: NativeWebShell? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        hideSystemBars()
        // La planification du sync de fond quitte le chemin critique du premier
        // frame ; un échec ici ne doit jamais faire rater un démarrage.
        Thread({
            try {
                PeriodicSyncWorker.schedule(applicationContext)
            } catch (_: Exception) {
            }
        }, "periodic-sync-schedule").apply { isDaemon = true; start() }

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val shell = NativeWebShell(this)
        webShell = shell
        // La WebView vit dans un CONTENEUR, pas directement dans la fenêtre :
        // lui seul reçoit l'inset clavier, donc la zone visible s'arrête
        // au-dessus du clavier.
        val container = FrameLayout(this).apply {
            addView(
                shell.view,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                ),
            )
        }
        setContentView(container)
        applyImeInsets(container)
        // La route sauvée prime TOUJOURS sur le deep link : l'intention est
        // périmée (c'est elle qui renvoyait l'utilisateur sur l'ancien écran).
        shell.open(savedRoute(savedInstanceState) ?: routePath(intent))
    }

    /**
     * L'état de la WebView peut être perdu (mort du processus) ; le CHEMIN de
     * route, lui, se relit et sert de repli.
     */
    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        val view = webShell?.view ?: return
        // Une URL sans hash = l'accueil : on l'écrit quand même, pour que la
        // route relue soit TOUJOURS une route (et jamais une intention).
        outState.putString(ROUTE_STATE_KEY, routePathFromUrl(view.url) ?: HOME_ROUTE)
        view.saveState(outState)
    }

    /**
     * `restoreState` renvoie `null` quand l'état n'a pas pu être restauré : on
     * rouvre sur la route SAUVEGARDÉE, jamais sur l'accueil.
     */
    override fun onRestoreInstanceState(savedInstanceState: Bundle) {
        super.onRestoreInstanceState(savedInstanceState)
        val view = webShell?.view ?: return
        val restored = view.restoreState(savedInstanceState)
        if (restored == null) {
            webShell?.open(savedRoute(savedInstanceState))
        }
    }

    /** Un chemin hors contrat est refusé : l'accueil, pas une route inventée. */
    private fun savedRoute(savedInstanceState: Bundle?): String? =
        routePathFromState(savedInstanceState?.getString(ROUTE_STATE_KEY))

    /**
     * L'activité est edge-to-edge et immersive : la fenêtre ne se redimensionne
     * PAS quand le clavier s'ouvre, d'où l'inset IME en padding bas.
     * `Type.ime()` et non `systemBars()` : l'inset clavier vaut 0 clavier fermé.
     */
    private fun applyImeInsets(container: View) {
        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.updatePadding(bottom = ime.bottom)
            insets
        }
        ViewCompat.requestApplyInsets(container)
    }

    /**
     * Deep link debug `veryslopnynotes://<route>` : en release, aucun
     * intent-filter, donc rien n'arrive ici. Une route inconnue est ignorée.
     */
    private fun routePath(intent: Intent?): String? {
        val data = intent?.data ?: return null
        if (data.scheme != "veryslopnynotes") return null
        val path = when (val host = data.host) {
            null -> return null
            "index" -> "/"
            else -> "/$host"
        }
        return path.takeIf { it in WEB_ROUTES }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        routePath(intent)?.let { webShell?.navigate(it) }
    }

    override fun onDestroy() {
        webShell?.destroy()
        webShell = null
        super.onDestroy()
    }

    /**
     * `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE` : un geste de bord fait réapparaître
     * les barres EN TRANSITOIRE ; sans ce réglage, une barre révélée restait là.
     * `WindowCompat` et non `insetsController` : minSdk 26.
     */
    private fun hideSystemBars() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    /**
     * La plateforme réinitialise le masquage quand la fenêtre reprend le focus
     * (retour d'une autre activité, fermeture d'un dialogue).
     */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }
}
