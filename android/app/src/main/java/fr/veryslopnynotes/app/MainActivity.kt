package fr.veryslopnynotes.app

import android.content.Intent
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import fr.veryslopnynotes.data.PeriodicSyncWorker

// Hôte natif de l'interface React (ADR-004) : `NativeWebShell` sert les assets
// locaux de `web/` dans la WebView et le pont `VsnBridge` est le seul accès aux
// données. Aucun appel réseau ici (seul `android/pronote/` parle réseau, I1) ;
// l'interface ne rappelle jamais un hôte tiers (CSP `connect-src 'none'`).
class MainActivity : ComponentActivity() {
    private var webShell: NativeWebShell? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // #135 : la fenêtre occupe tout l'écran, y compris sous les barres.
        enableEdgeToEdge()
        // #303 : plein écran immersif — les DEUX barres système disparaissent
        // (statut en haut, navigation en bas) au profit du contenu.
        hideSystemBars()
        // #249 : la planification du sync de fond quitte le chemin critique
        // du premier frame (WorkManager.getInstance + enqueue = IPC/DB).
        // KEEP = une seule planification, jamais deux : l'ordre avec le
        // premier frame n'a aucune importance, seul le créneau 6 h compte.
        // Contexte applicatif (pas l'activité), thread daemon, best-effort :
        // un échec ici ne doit jamais faire rater un démarrage.
        Thread({
            try {
                PeriodicSyncWorker.schedule(applicationContext)
            } catch (_: Exception) {
            }
        }, "periodic-sync-schedule").apply { isDaemon = true; start() }

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val shell = NativeWebShell(this)
        webShell = shell
        setContentView(shell.view)
        shell.open(routePath(intent))
    }

    /**
     * Deep link debug `veryslopnynotes://<route>` → route hash de l'UI web.
     * Release : aucun intent-filter, donc rien n'arrive ici. Une route
     * inconnue est ignorée (accueil).
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
     * #303 : masque les barres système de la fenêtre de l'activité.
     *
     * `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE` : un geste de bord fait
     * réapparaître les barres EN TRANSITOIRE, puis elles se re-masquent seules.
     * Sans ce réglage, une barre révélée restait affichée pour de bon.
     *
     * `WindowCompat` et non `window.insetsController` (API 30) : minSdk 26, et
     * androidx.core est déjà une dépendance déclarée de l'app.
     */
    private fun hideSystemBars() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    /**
     * #303 : re-masquage à chaque REPRISE DE FOCUS de la fenêtre.
     *
     * Le masquage posé une fois dans [onCreate] ne survit pas à tout : la
     * plateforme le réinitialise quand la fenêtre reprend le focus après une
     * autre activité (scan du QR) ou la fermeture d'un dialogue. Masquer ici
     * plutôt qu'au démarrage seul, c'est le même appel sur le seul chemin que
     * la plateforme emprunte TOUJOURS.
     */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }
}
