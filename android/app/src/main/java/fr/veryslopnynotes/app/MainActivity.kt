package fr.veryslopnynotes.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
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
    private var webContainer: FrameLayout? = null
    private var retryView: View? = null

    /** Route du dernier écran : elle survit à la mort du rendu (pas la WebView). */
    private var lastRoute: String = HOME_ROUTE
    private var resumed = false

    // Android 17 : joindre le serveur du réseau local demande une autorisation
    // d'exécution. Le résultat n'est pas lu ici : la prochaine requête dira
    // elle-même si elle passe, et un refus n'empêche pas l'app de démarrer.
    private val localNetworkPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Edge-to-edge : `enableEdgeToEdge` pose aussi le mode découpe (API 28+),
        // donc le fond occupe l'encoche et le contenu est décalé par l'inset.
        enableEdgeToEdge()
        hideSystemBars()
        requestLocalNetworkPermission()
        // Refus AVANT de construire la WebView : une version trop ancienne ne
        // doit pas planter au chargement, elle doit lire quoi faire.
        val support = webViewSupport(currentWebViewVersion())
        if (support is WebViewSupport.Unsupported) {
            showUnsupportedWebView(support.installedMajor)
            return
        }
        // La planification du sync de fond quitte le chemin critique du premier
        // frame ; un échec ici ne doit jamais faire rater un démarrage.
        Thread({
            try {
                PeriodicSyncWorker.schedule(applicationContext)
            } catch (_: Exception) {
            }
        }, "periodic-sync-schedule").apply { isDaemon = true; start() }

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        // La WebView vit dans un CONTENEUR, pas directement dans la fenêtre :
        // lui seul reçoit l'inset clavier, donc la zone visible s'arrête
        // au-dessus du clavier.
        val container = FrameLayout(this)
        webContainer = container
        setContentView(container)
        applyWindowInsets(container)
        // La route sauvée prime TOUJOURS sur le deep link : l'intention est
        // périmée (c'est elle qui renvoyait l'utilisateur sur l'ancien écran).
        mountShell(savedRoute(savedInstanceState) ?: routePath(intent))
    }

    /**
     * Monte une coquille NEUVE. Une WebView dont le rendu est mort ne se
     * réutilise jamais (Android tue le process), d'où la recréation complète.
     */
    private fun mountShell(path: String?) {
        val container = webContainer ?: return
        val shell = NativeWebShell(this) { gone -> onRendererGone(gone) }
        webShell = shell
        container.addView(
            shell.view,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        shell.open(path)
        // Mort du rendu en arrière-plan : `onResume` a déjà eu lieu et ne
        // reverra pas cette coquille. `pauseTimers` est global au process.
        if (resumed) shell.resume()
    }

    /**
     * Rendu mort : la coquille est détruite, la session (disque + pont) reste
     * intacte, et l'utilisateur décide du redémarrage. Aucun rechargement
     * automatique : un rendu qui meurt au chargement boucherait l'app.
     */
    private fun onRendererGone(shell: NativeWebShell) {
        if (webShell !== shell) return
        lastRoute = shell.route
        webShell = null
        shell.destroy()
        showRendererRetry()
    }

    /** Écran de reprise : un message et UNE action, rien d'autre à décider. */
    private fun showRendererRetry() {
        val container = webContainer ?: return
        retryView?.let(container::removeView)
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(24), dp(24), dp(24))
            addView(
                TextView(this@MainActivity).apply {
                    text = "L'interface s'est arrêtée."
                    textSize = 18f
                    gravity = Gravity.CENTER
                },
            )
            addView(
                Button(this@MainActivity).apply {
                    id = R.id.renderer_retry
                    text = "Réessayer"
                    setOnClickListener { retryRenderer() }
                },
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { topMargin = dp(16) },
            )
        }
        container.addView(
            panel,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        retryView = panel
    }

    private fun retryRenderer() {
        if (webShell != null) return
        val container = webContainer ?: return
        retryView?.let(container::removeView)
        retryView = null
        mountShell(lastRoute)
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    /**
     * L'état de la WebView peut être perdu (mort du processus) ; le CHEMIN de
     * route, lui, se relit et sert de repli.
     */
    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        val shell = webShell
        // Une URL sans hash = l'accueil : on l'écrit quand même, pour que la
        // route relue soit TOUJOURS une route (et jamais une intention).
        val route = routePathFromUrl(shell?.view?.url) ?: shell?.route ?: lastRoute
        outState.putString(ROUTE_STATE_KEY, route)
        // Rendu mort : aucun état de WebView à sauver, la route suffit.
        shell?.view?.saveState(outState)
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
     * Deux chemins distincts, sans double comptage :
     * — le clavier est une contrainte de LAYOUT : la fenêtre ne se redimensionne
     *   pas en edge-to-edge, donc l'inset IME devient le padding bas du
     *   conteneur (`Type.ime()` vaut 0 clavier fermé) ;
     * — découpe, barres visibles et gestes sont des zones de SÉCURITÉ : le natif
     *   les publie au CSS (`--native-safe-*`), qui les applique une seule fois.
     *   Padding natif + `env(safe-area-inset-*)` compteraient deux fois.
     */
    private fun applyWindowInsets(container: View) {
        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.updatePadding(bottom = ime.bottom)
            webShell?.publishSafeArea(safeArea(insets))
            insets
        }
        ViewCompat.requestApplyInsets(container)
    }

    /** Maximum par côté : une zone sûre ne s'additionne jamais à une autre. */
    private fun safeArea(insets: WindowInsetsCompat): SafeArea {
        val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
        val gestures = insets.getInsets(WindowInsetsCompat.Type.systemGestures())
        return SafeArea(
            left = maxOf(cutout.left, bars.left),
            top = maxOf(cutout.top, bars.top),
            right = maxOf(cutout.right, bars.right),
            // Le geste d'accueil occupe le bas même barres masquées.
            bottom = maxOf(cutout.bottom, bars.bottom, gestures.bottom),
        )
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
        routePath(intent)?.let { route ->
            lastRoute = route
            webShell?.navigate(route)
        }
    }

    // La WebView ne tourne pas en arrière-plan : ses timers JS sont coupés ici
    // et reprennent au retour. La recréation de configuration passe par la
    // même paire, donc aucun timer ne reste gelé après une rotation.
    override fun onPause() {
        resumed = false
        webShell?.pause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        webShell?.resume()
    }

    /** Niveau quelconque : le cache RAM est rechargeable, l'état de la page non. */
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        webShell?.trimMemory()
    }

    override fun onDestroy() {
        webShell?.destroy()
        webShell = null
        webContainer = null
        super.onDestroy()
    }

    /**
     * `ACCESS_LOCAL_NETWORK` n'existe qu'à partir d'Android 17 (API 37) : sur
     * une plateforme plus ancienne la demande serait un refus immédiat.
     */
    private fun requestLocalNetworkPermission() {
        if (Build.VERSION.SDK_INT < 37) return
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_LOCAL_NETWORK,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) localNetworkPermission.launch(Manifest.permission.ACCESS_LOCAL_NETWORK)
    }

    /** Une erreur de lecture du paquet WebView devient « version inconnue », pas un crash. */
    private fun currentWebViewVersion(): String? = try {
        WebView.getCurrentWebViewPackage()?.versionName
    } catch (_: Exception) {
        null
    }

    /** WebView trop ancienne : message natif plein écran, aucune coquille construite. */
    private fun showUnsupportedWebView(installedMajor: Int?) {
        val message = TextView(this).apply {
            text = unsupportedWebViewMessage(installedMajor)
            textSize = 16f
            setPadding(48, 48, 48, 48)
        }
        setContentView(ScrollView(this).apply { addView(message) })
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
