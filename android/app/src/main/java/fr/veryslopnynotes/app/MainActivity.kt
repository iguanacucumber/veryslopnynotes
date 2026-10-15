package fr.veryslopnynotes.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import fr.veryslopnynotes.ui.AppNav
import fr.veryslopnynotes.data.PeriodicSyncWorker

// Shell phase 4 (#13) + offline #14 + appairage local #206 + alertes #21.
// Navigation Material3 + routes "pairing" (QR+PIN, session chiffrée) et
// "alerts" (I6 : donnée jamais interprétée). Aucun appel réseau ici
// (seul `android/pronote/` parle réseau, I1) : on ne fournit que la GRAINE
// d'adresse (local.properties server.host ou env SERVER_HOST), que
// ServerStore/AppNav remplacent par l'adresse du scraper à l'exécution.
class MainActivity : ComponentActivity() {
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
        setContent { AppNav(baseUrlSeed = baseUrlSeed) }
    }
}
