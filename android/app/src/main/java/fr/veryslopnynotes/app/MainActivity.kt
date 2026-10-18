package fr.veryslopnynotes.app

import android.os.Bundle
import android.content.Intent
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import fr.veryslopnynotes.ui.AppNav
import fr.veryslopnynotes.data.PeriodicSyncWorker

// Shell phase 4 (#13) + offline #14 + appairage local #206 + alertes #21.
// Navigation Material3 + routes "pairing" (QR+PIN, session chiffrée) et
// "alerts" (I6 : donnée jamais interprétée). Aucun appel réseau ici
// (seul `android/pronote/` parle réseau, I1) : on ne fournit que la GRAINE
// d'adresse (local.properties server.host ou env SERVER_HOST), que
// ServerStore/AppNav remplacent par l'adresse du scraper à l'exécution.
class MainActivity : ComponentActivity() {
    // Renseignée seulement quand BuildConfig.WEB_UI est vrai.
    private var webShell: NativeWebShell? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // #135 : la fenêtre occupe tout l'écran.
        // Avant : la fenêtre s'arrêtait sous la barre système, donc la bande de
        // statut restait du fond de fenêtre — un bandeau gris au-dessus de la
        // barre du haut. Les INSETS restent à la charge du `Scaffold` (barre du
        // haut + barre d'onglets consomment `windowInsets`), donc aucun
        // contenu ne passe dessous. ponytail: la fonction d'activity-compose
        // déjà présente (zéro dépendance ajoutée).
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
        val baseUrlSeed = fr.veryslopnynotes.core.ServerConfig.baseUrl(
            BuildConfig.SERVER_SCHEME,
            BuildConfig.SERVER_HOST,
        )
        // Toggle "fait" #75 : l'app n'envoie pas d'accountId (le dépôt local
        // résout sa session sur le téléphone) ; #82 exposera le profil pour un
        // multi-compte. Jamais un hôte tiers ici (I1), et l'écriture reste
        // une action utilisateur confirmée (I7).
        // #134 : plus de `MaterialTheme { }` ici. Ce thème extérieur sans
        // argument se posait AVANT celui d'AppNav, en light par défaut : il
        // écrasait le thème choisi dans les réglages et le forçait au clair.
        // Le thème est appliqué une seule fois, à la racine, par PapillonTheme.
        // #172 : plus de `loadAlerts` — l'écran Alertes lit le cache partagé
        // (`SyncedRepository`), donc ce chargement était mort depuis #144. La
        // session est relue du store chiffré à chaque démarrage (restauration
        // sans rescanner) : elle n'a rien à faire ici.
        // #333 : interface React locale derrière un drapeau de build. Le défaut
        // (WEB_UI=false) garde exactement le chemin Compose ci-dessous ; le
        // deep link debug est converti en route hash.
        if (BuildConfig.WEB_UI) {
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
            val shell = NativeWebShell(this)
            webShell = shell
            setContentView(shell.view)
            shell.open(routePath(intent))
            return
        }
        setContent { AppNav(baseUrlSeed = baseUrlSeed) }
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
        if (BuildConfig.WEB_UI) routePath(intent)?.let { webShell?.navigate(it) }
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
     *
     * ponytail: masquage sur la SEULE fenêtre de l'activité. Un dialogue ou une
     * bottom sheet ouvre la sienne, donc les barres y reviennent le temps qu'il
     * est ouvert — [onWindowFocusChanged] les re-masque au retour du focus.
     * Upgrade : les masquer aussi DANS ces fenêtres si le passage devient
     * gênant à l'usage.
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
